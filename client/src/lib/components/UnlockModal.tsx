"use client";

import React, { useState } from "react";
import { useActionAuth } from "../action-auth-context";

export function UnlockModal() {
  const {
    isUnlocked,
    isVerifying,
    error,
    unlock,
    lock,
    unlockRequested,
    consumeUnlockRequest,
  } = useActionAuth();
  const [password, setPassword] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  // Auto-open when unlock is requested (e.g. 403 received)
  React.useEffect(() => {
    if (unlockRequested) {
      setIsOpen(true);
      consumeUnlockRequest();
    }
  }, [unlockRequested, consumeUnlockRequest]);

  const handleUnlock = async () => {
    const success = await unlock(password);
    if (success) {
      setPassword("");
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
          isUnlocked
            ? "bg-emerald-900/30 text-emerald-400 border border-emerald-700/50"
            : "bg-slate-800 text-slate-400 border border-slate-700"
        }`}
        title={isUnlocked ? "Actions unlocked" : "Unlock actions"}
      >
        ⋯
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl z-50">
          {isUnlocked ? (
            <>
              <p className="mb-2 text-xs text-emerald-400">
                🔓 Actions unlocked
              </p>
              <button
                onClick={() => {
                  lock();
                  setIsOpen(false);
                }}
                className="w-full rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700"
              >
                Lock Actions
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    await handleUnlock();
                  }
                }}
                placeholder="Action password"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-primary-500"
                autoFocus
              />
              <button
                onClick={handleUnlock}
                disabled={isVerifying || !password}
                className="mt-2 w-full rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {isVerifying ? "..." : "Unlock"}
              </button>
              {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
