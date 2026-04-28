import { NextRequest, NextResponse } from "next/server";
import { cleanupTradeLogs } from "@copytrade/shared/lib/trade-log-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === "retention" ? "retention" : "noisy-json";
    const keepDays =
      typeof body?.keepDays === "number"
        ? body.keepDays
        : Number.parseInt(String(body?.keepDays || ""), 10);

    if (mode === "retention" && (!Number.isFinite(keepDays) || keepDays < 1)) {
      return NextResponse.json(
        {
          success: false,
          error: "keepDays must be a number greater than or equal to 1",
        },
        { status: 400 },
      );
    }

    const result = await cleanupTradeLogs({
      mode,
      keepDays: mode === "retention" ? Math.floor(keepDays) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
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
