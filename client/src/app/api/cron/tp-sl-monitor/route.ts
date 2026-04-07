import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runTpslMonitor } from "@/lib/tp-sl-monitor";
import { TradeLog, connectDB } from "@/lib/database";
import {
  tryStart,
  updateProgress,
  finishCron,
  getCronStatus,
} from "@/lib/cron-status";

const CRON_NAME = "tp-sl-monitor";

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
      console.log("[Cron] TP/SL Monitor started at", new Date().toISOString());

      await connectDB();
      updateProgress(CRON_NAME, "Connected to database");

      await TradeLog.create({
        type: "cron",
        action: "tpsl_monitor_start",
        details: "Starting TP/SL monitor cron job",
        result: "started",
      });

      updateProgress(CRON_NAME, "Running TP/SL monitor...");
      const result = await runTpslMonitor();

      updateProgress(
        CRON_NAME,
        `Done — checked: ${result.checked}, promoted: ${result.promoted}, TP/SL placed: ${result.tpslPlaced}, errors: ${result.errors.length}`,
        result.errors.length > 0 ? "warning" : "success",
      );

      await connectDB();
      await TradeLog.create({
        type: "cron",
        action: "tpsl_monitor_end",
        details: `Checked: ${result.checked}, Promoted: ${result.promoted}, TP/SL placed: ${result.tpslPlaced}, Errors: ${result.errors.length}`,
        result: result.errors.length > 0 ? "partial" : "success",
      });

      finishCron(CRON_NAME, result.errors.length > 0 ? "error" : "success");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[Cron] TP/SL Monitor error:", errMsg);
      updateProgress(CRON_NAME, `Error: ${errMsg}`, "error");

      try {
        await connectDB();
        await TradeLog.create({
          type: "cron",
          action: "tpsl_monitor_error",
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
    message: "TP/SL Monitor started",
    timestamp: new Date().toISOString(),
  });
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
