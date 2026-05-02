import { NextRequest, NextResponse } from "next/server";
import { proxyToBackend } from "../../_lib/backend-proxy";
import { verifyActionAuth } from "../../_lib/action-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = verifyActionAuth(request);
  if (authError) return authError;

  return proxyToBackend(request, "/api/logs/cleanup", { method: "POST" });
}
