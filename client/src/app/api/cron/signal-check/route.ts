import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runSignalCheck } from "@/lib/executor";
import { TradeLog, connectDB } from "@/lib/database";
import {
  tryStart,
  updateProgress,
  finishCron,
  getCronStatus,
} from "@/lib/cron-status";

const CRON_NAME = "signal-check";

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
      console.log("[Cron] Signal check started at", new Date().toISOString());

      await connectDB();
      updateProgress(CRON_NAME, "Connected to database");

      await TradeLog.create({
        type: "cron",
        action: "signal_check_start",
        details: "Starting Discord signal check cron job",
        result: "started",
      });

      updateProgress(CRON_NAME, "Running signal check...");
      const result = await runSignalCheck();

      updateProgress(
        CRON_NAME,
        `Done — checked: ${result.checked}, signals: ${result.newSignals}, executed: ${result.executed}`,
        "success",
      );

      await connectDB();
      await TradeLog.create({
        type: "cron",
        action: "signal_check_end",
        details: `Checked: ${result.checked}, Signals: ${result.newSignals}, Executed: ${result.executed}, Errors: ${result.errors.length}`,
        result: result.errors.length > 0 ? "partial" : "success",
      });

      finishCron(CRON_NAME, result.errors.length > 0 ? "error" : "success");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[Cron] Signal check error:", errMsg);
      updateProgress(CRON_NAME, `Error: ${errMsg}`, "error");

      try {
        await connectDB();
        await TradeLog.create({
          type: "cron",
          action: "signal_check_error",
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
    message: "Signal check started",
    timestamp: new Date().toISOString(),
  });
}

// GET /api/cron/signal-check/status — poll progress
export async function HEAD() {
  const status = getCronStatus(CRON_NAME);
  return NextResponse.json({ success: true, status });
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
