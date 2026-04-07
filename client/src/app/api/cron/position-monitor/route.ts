import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runPositionMonitor } from "@/lib/monitor";
import { TradeLog, connectDB } from "@/lib/database";
import {
  tryStart,
  updateProgress,
  finishCron,
  getCronStatus,
} from "@/lib/cron-status";

const CRON_NAME = "position-monitor";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Verify cron secret if configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const providedSecret = authHeader?.replace("Bearer ", "");
    if (providedSecret !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Block if already running
  if (!tryStart(CRON_NAME)) {
    const status = getCronStatus(CRON_NAME);
    return NextResponse.json(
      {
        success: false,
        error: "Already running",
        status,
      },
      { status: 409 },
    );
  }

  // Return immediately — work continues in background via waitUntil
  const work = async () => {
    try {
      console.log(
        "[Cron] Position monitor started at",
        new Date().toISOString(),
      );

      await connectDB();
      updateProgress(CRON_NAME, "Connected to database");

      await TradeLog.create({
        type: "cron",
        action: "position_monitor_start",
        details: "Starting position monitor cron job",
        result: "started",
      });

      updateProgress(CRON_NAME, "Running position monitor...");
      const result = await runPositionMonitor();

      updateProgress(
        CRON_NAME,
        `Done — checked: ${result.checked}, actions: ${result.actions}`,
        "success",
      );

      await connectDB();
      await TradeLog.create({
        type: "cron",
        action: "position_monitor_end",
        details: `Checked: ${result.checked}, Actions: ${result.actions}, Errors: ${result.errors.length}`,
        result: result.errors.length > 0 ? "partial" : "success",
      });

      finishCron(CRON_NAME, result.errors.length > 0 ? "error" : "success");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[Cron] Position monitor error:", errMsg);
      updateProgress(CRON_NAME, `Error: ${errMsg}`, "error");

      try {
        await connectDB();
        await TradeLog.create({
          type: "cron",
          action: "position_monitor_error",
          error: errMsg,
        });
      } catch {}

      finishCron(CRON_NAME, "error", errMsg);
    }
  };

  // Fire-and-forget in background
  waitUntil(work());

  // Immediate response
  return NextResponse.json({
    success: true,
    message: "Position monitor started",
    timestamp: new Date().toISOString(),
  });
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
