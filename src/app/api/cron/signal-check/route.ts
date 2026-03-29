import { NextRequest, NextResponse } from "next/server";
import { runSignalCheck } from "@/lib/executor";
import { TradeLog, connectDB } from "@/lib/database";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret if configured
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      const providedSecret = authHeader?.replace("Bearer ", "");
      if (providedSecret !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    console.log("[Cron] Signal check started at", new Date().toISOString());

    await connectDB();
    await TradeLog.create({
      type: "cron",
      action: "signal_check_start",
      details: "Starting Discord signal check cron job",
      result: "started",
    });

    const result = await runSignalCheck();

    await TradeLog.create({
      type: "cron",
      action: "signal_check_end",
      details: `Checked: ${result.checked}, Signals: ${result.newSignals}, Executed: ${result.executed}, Errors: ${result.errors.length}`,
      result: result.errors.length > 0 ? "partial" : "success",
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("[Cron] Signal check error:", error);

    try {
      await connectDB();
      await TradeLog.create({
        type: "cron",
        action: "signal_check_error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } catch {}

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
