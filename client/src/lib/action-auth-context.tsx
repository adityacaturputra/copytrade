"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getStoredActionPassword,
  setStoredActionPassword,
  clearStoredActionPassword,
  hasStoredActionPassword,
} from "./action-auth";

interface ActionAuthState {
  /** Whether the user has unlocked actions (password stored in localStorage) */
  isUnlocked: boolean;
  /** Whether we're currently verifying the password */
  isVerifying: boolean;
  /** Error message from last unlock attempt */
  error: string | null;
  /** Attempt to unlock with the given password */
  unlock: (password: string) => Promise<boolean>;
  /** Lock actions (clear stored password) */
  lock: () => void;
}

const ActionAuthContext = createContext<ActionAuthState>({
  isUnlocked: false,
  isVerifying: false,
  error: null,
  unlock: async () => false,
  lock: () => {},
});

export function ActionAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check localStorage on mount
  useEffect(() => {
    setIsUnlocked(hasStoredActionPassword());
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    setIsVerifying(true);
    setError(null);

    try {
      // Verify against our own API endpoint
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-action-password": password,
        },
        body: JSON.stringify({}), // Empty body - just checking auth
      });

      // If we get past the action auth middleware, password is correct
      // (even if the actual request validation fails, the auth passed)
      if (res.status === 403) {
        setError("Password salah. Coba lagi.");
        setIsUnlocked(false);
        return false;
      }

      // Password is correct (or no password configured)
      setStoredActionPassword(password);
      setIsUnlocked(true);
      setError(null);
      return true;
    } catch {
      setError("Gagal verifikasi password.");
      return false;
    } finally {
      setIsVerifying(false);
    }
  }, []);

  const lock = useCallback(() => {
    clearStoredActionPassword();
    setIsUnlocked(false);
    setError(null);
  }, []);

  return (
    <ActionAuthContext.Provider
      value={{ isUnlocked, isVerifying, error, unlock, lock }}
    >
      {children}
    </ActionAuthContext.Provider>
  );
}

export function useActionAuth() {
  return useContext(ActionAuthContext);
}
