import { NextRequest, NextResponse } from "next/server";
import { proxyToBackend } from "../_lib/backend-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    return proxyToBackend(request, "/api/drafts", { method: "GET" });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
