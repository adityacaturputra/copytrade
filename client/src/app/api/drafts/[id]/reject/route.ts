import { NextRequest, NextResponse } from "next/server";
import { proxyToBackend } from "../../../_lib/backend-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return proxyToBackend(request, `/api/drafts/${id}/reject`, {
      method: "POST",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Draft reject proxy failed",
      },
      { status: 500 },
    );
  }
}
