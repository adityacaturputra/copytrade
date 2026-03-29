import { NextRequest, NextResponse } from "next/server";
import { runPositionMonitor } from "@/lib/monitor";
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

    console.log("[Cron] Position monitor started at", new Date().toISOString());

    await connectDB();
    await TradeLog.create({
      type: "cron",
      action: "position_monitor_start",
      details: "Starting position monitor cron job",
      result: "started",
    });

    const result = await runPositionMonitor();

    await TradeLog.create({
      type: "cron",
      action: "position_monitor_end",
      details: `Checked: ${result.checked}, Actions: ${result.actions}, Errors: ${result.errors.length}`,
      result: result.errors.length > 0 ? "partial" : "success",
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("[Cron] Position monitor error:", error);

    try {
      await connectDB();
      await TradeLog.create({
        type: "cron",
        action: "position_monitor_error",
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

export async function POST(request: NextRequest) {
  return GET(request);
}
