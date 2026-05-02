import type { Request, Response, NextFunction } from "express";

/**
 * Action authentication for protecting mutating endpoints and agent mutating tools.
 *
 * Uses the ACTION_PASSWORD env variable. If not configured (empty/missing),
 * all requests pass through (development mode).
 *
 * Clients send the password via the `x-action-password` header.
 */

function getActionPassword(): string | null {
  const value = process.env.ACTION_PASSWORD?.trim();
  return value && value.length > 0 ? value : null;
}

export function isActionPasswordConfigured(): boolean {
  return getActionPassword() !== null;
}

export function verifyActionPassword(password: string | undefined): boolean {
  const configured = getActionPassword();
  if (!configured) return true; // No password configured = open mode
  if (!password) return false;
  return password === configured;
}

/**
 * Extract the action password from request headers.
 */
export function getActionPasswordHeader(req: Request): string | undefined {
  const value = req.header("x-action-password");
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Express middleware that requires x-action-password header for mutating requests.
 * Passes through if ACTION_PASSWORD is not configured.
 */
export function requireActionAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isActionPasswordConfigured()) {
    next();
    return;
  }

  const password = req.header("x-action-password");
  if (verifyActionPassword(password)) {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error:
      "Action locked. Provide the correct action password via x-action-password header.",
  });
}
