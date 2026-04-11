import { Router, Request, Response, type Router as ExpressRouter } from "express";
import { runSignalCheck } from "../lib/executor";
import { runPositionMonitor } from "../lib/monitor";
import { runTpslMonitor } from "../lib/tp-sl-monitor";
import { TradeLog, connectDB } from "../lib/database";
import {
  tryStart,
  updateProgress,
  finishCron,
  getCronStatus,
  getAllCronStatus,
} from "../lib/cron-status";

const router: ExpressRouter = Router();
let loggedCronAuthMode = false;

// ─── Middleware ───────────────────────────────────────────────────────────────

/** Verify cron secret if configured */
function verifyCronSecret(req: Request, res: Response, next: () => void) {
  const rawCronSecret = process.env.CRON_SECRET;
  const cronSecret = rawCronSecret?.trim() || "";

  if (!loggedCronAuthMode) {
    console.log(
      `[CronAuth] Mode: ${cronSecret ? "enabled" : "disabled"}${cronSecret ? "" : " (CRON_SECRET not set)"}`,
    );
    loggedCronAuthMode = true;
  }

  if (cronSecret) {
    const authHeader = req.headers.authorization;
    const providedSecret = authHeader?.replace("Bearer ", "").trim();
    if (providedSecret !== cronSecret) {
      console.warn(
        `[CronAuth] Unauthorized ${req.method} ${req.path} (hasAuthorizationHeader=${authHeader ? "yes" : "no"})`,
      );
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }
  next();
}

// ─── Signal Check ─────────────────────────────────────────────────────────────

const SIGNAL_CHECK_NAME = "signal-check";

async function handleSignalCheck(req: Request, res: Response) {
  // Block if already running
  if (!tryStart(SIGNAL_CHECK_NAME)) {
    const status = getCronStatus(SIGNAL_CHECK_NAME);
    res.status(409).json({
      success: false,
      error: "Already running",
      status,
    });
    return;
  }

  // Return immediately — work continues in background
  res.json({
    success: true,
    message: "Signal check started",
    timestamp: new Date().toISOString(),
  });

  // Fire-and-forget in background
  runSignalCheckWork().catch(console.error);
}

async function runSignalCheckWork() {
  try {
    console.log("[Cron] Signal check started at", new Date().toISOString());

    await connectDB();
    updateProgress(SIGNAL_CHECK_NAME, "Connected to database");

    await TradeLog.create({
      type: "cron",
      action: "signal_check_start",
      details: "Starting Discord signal check cron job",
      result: "started",
    });

    updateProgress(SIGNAL_CHECK_NAME, "Running signal check...");
    const result = await runSignalCheck();

    updateProgress(
      SIGNAL_CHECK_NAME,
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

    finishCron(SIGNAL_CHECK_NAME, result.errors.length > 0 ? "error" : "success");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Cron] Signal check error:", errMsg);
    updateProgress(SIGNAL_CHECK_NAME, `Error: ${errMsg}`, "error");

    try {
      await connectDB();
      await TradeLog.create({
        type: "cron",
        action: "signal_check_error",
        error: errMsg,
      });
    } catch {}

    finishCron(SIGNAL_CHECK_NAME, "error", errMsg);
  }
}

// ─── Position Monitor ─────────────────────────────────────────────────────────

const POSITION_MONITOR_NAME = "position-monitor";

async function handlePositionMonitor(req: Request, res: Response) {
  // Block if already running
  if (!tryStart(POSITION_MONITOR_NAME)) {
    const status = getCronStatus(POSITION_MONITOR_NAME);
    res.status(409).json({
      success: false,
      error: "Already running",
      status,
    });
    return;
  }

  // Return immediately — work continues in background
  res.json({
    success: true,
    message: "Position monitor started",
    timestamp: new Date().toISOString(),
  });

  // Fire-and-forget in background
  runPositionMonitorWork().catch(console.error);
}

async function runPositionMonitorWork() {
  try {
    console.log("[Cron] Position monitor started at", new Date().toISOString());

    await connectDB();
    updateProgress(POSITION_MONITOR_NAME, "Connected to database");

    await TradeLog.create({
      type: "cron",
      action: "position_monitor_start",
      details: "Starting position monitor cron job",
      result: "started",
    });

    updateProgress(POSITION_MONITOR_NAME, "Running position monitor...");
    const result = await runPositionMonitor();

    updateProgress(
      POSITION_MONITOR_NAME,
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

    finishCron(POSITION_MONITOR_NAME, result.errors.length > 0 ? "error" : "success");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Cron] Position monitor error:", errMsg);
    updateProgress(POSITION_MONITOR_NAME, `Error: ${errMsg}`, "error");

    try {
      await connectDB();
      await TradeLog.create({
        type: "cron",
        action: "position_monitor_error",
        error: errMsg,
      });
    } catch {}

    finishCron(POSITION_MONITOR_NAME, "error", errMsg);
  }
}

// ─── TP/SL Monitor ────────────────────────────────────────────────────────────

const TP_SL_MONITOR_NAME = "tp-sl-monitor";

async function handleTpSlMonitor(req: Request, res: Response) {
  // Block if already running
  if (!tryStart(TP_SL_MONITOR_NAME)) {
    const status = getCronStatus(TP_SL_MONITOR_NAME);
    res.status(409).json({
      success: false,
      error: "Already running",
      status,
    });
    return;
  }

  // Return immediately — work continues in background
  res.json({
    success: true,
    message: "TP/SL Monitor started",
    timestamp: new Date().toISOString(),
  });

  // Fire-and-forget in background
  runTpSlMonitorWork().catch(console.error);
}

async function runTpSlMonitorWork() {
  try {
    console.log("[Cron] TP/SL Monitor started at", new Date().toISOString());

    await connectDB();
    updateProgress(TP_SL_MONITOR_NAME, "Connected to database");

    await TradeLog.create({
      type: "cron",
      action: "tpsl_monitor_start",
      details: "Starting TP/SL monitor cron job",
      result: "started",
    });

    updateProgress(TP_SL_MONITOR_NAME, "Running TP/SL monitor...");
    const result = await runTpslMonitor();

    updateProgress(
      TP_SL_MONITOR_NAME,
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

    finishCron(TP_SL_MONITOR_NAME, result.errors.length > 0 ? "error" : "success");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Cron] TP/SL Monitor error:", errMsg);
    updateProgress(TP_SL_MONITOR_NAME, `Error: ${errMsg}`, "error");

    try {
      await connectDB();
      await TradeLog.create({
        type: "cron",
        action: "tpsl_monitor_error",
        error: errMsg,
      });
    } catch {}

    finishCron(TP_SL_MONITOR_NAME, "error", errMsg);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Apply cron secret verification to all cron routes
router.use(verifyCronSecret);

// GET /api/cron/signal-check
router.get("/signal-check", handleSignalCheck);
router.post("/signal-check", handleSignalCheck);

// GET /api/cron/position-monitor
router.get("/position-monitor", handlePositionMonitor);
router.post("/position-monitor", handlePositionMonitor);

// GET /api/cron/tp-sl-monitor
router.get("/tp-sl-monitor", handleTpSlMonitor);
router.post("/tp-sl-monitor", handleTpSlMonitor);

// GET /api/cron/status
router.get("/status", (req: Request, res: Response) => {
  res.json({
    success: true,
    cronStatus: getAllCronStatus(),
  });
});

export default router;
