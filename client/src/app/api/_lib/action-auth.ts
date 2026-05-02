import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side action auth verification for Next.js API route handlers.
 *
 * Uses the ACTION_PASSWORD env variable (shared with backend).
 * If not configured (empty/missing), all requests pass through.
 */

function getActionPassword(): string | null {
  const value = process.env.ACTION_PASSWORD?.trim();
  return value && value.length > 0 ? value : null;
}

export function isActionPasswordConfigured(): boolean {
  return getActionPassword() !== null;
}

/**
 * Verifies the action password from the request headers.
 * Returns null if auth passes, or a NextResponse error if it fails.
 */
export function verifyActionAuth(request: NextRequest): NextResponse | null {
  const configured = getActionPassword();
  if (!configured) return null; // No password configured = open mode

  const password = request.headers.get("x-action-password");
  if (password === configured) return null; // Auth passes

  return NextResponse.json(
    {
      success: false,
      error:
        "Action locked. Provide the correct action password via x-action-password header.",
    },
    { status: 403 },
  );
}
