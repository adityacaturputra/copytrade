/**
 * Client-side action authentication utility.
 *
 * Stores the action password in localStorage so it persists across page reloads.
 * Provides helpers to attach the password to mutation requests via the
 * `x-action-password` header.
 */

const STORAGE_KEY = "copytrade_action_password";

/** Get the stored action password (or null if not set). */
export function getStoredActionPassword(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Store the action password in localStorage. */
export function setStoredActionPassword(password: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, password);
  } catch {
    // Ignore storage errors
  }
}

/** Remove the stored action password from localStorage. */
export function clearStoredActionPassword(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

/** Check if there is a stored action password. */
export function hasStoredActionPassword(): boolean {
  return getStoredActionPassword() !== null;
}

/**
 * Build fetch headers that include the action password if available.
 * Merge these with your other headers.
 */
export function getActionAuthHeaders(): Record<string, string> {
  const password = getStoredActionPassword();
  if (!password) return {};
  return { "x-action-password": password };
}

/**
 * Enhanced fetch wrapper that automatically attaches the action password
 * header for mutation requests (POST, PUT, DELETE, PATCH).
 */
export async function actionFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const isMutation = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  if (!isMutation) {
    return fetch(url, init);
  }

  const headers = new Headers(init.headers);
  const password = getStoredActionPassword();
  if (password) {
    headers.set("x-action-password", password);
  }

  return fetch(url, { ...init, headers });
}
