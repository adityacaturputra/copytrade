import {
  Router,
  Request,
  Response,
  type Router as ExpressRouter,
} from "express";
import { runSignalCheck } from "@copytrade/shared/lib/executor/index";
import { runTpslMonitor } from "@copytrade/shared/lib/monitor/tp-sl";
import { connectDB } from "@copytrade/shared/lib/database/index";
import {
  tryStart,
  updateProgress,
  finishCron,
  getCronStatus,
  getAllCronStatus,
} from "@copytrade/shared/lib/cron/status";
import { createTradeLog } from "@copytrade/shared/lib/trade-log/store";
import { runPositionMonitorAgent } from "../lib/agent/position-monitor-agent";
import { runOrphanCleanupMonitor } from "../lib/orphan-cleanup-monitor";

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

    await createTradeLog({
      type: "cron",
      action: "signal_check_start",
      details: "Starting Discord signal check cron job",
      level: "debug",
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
    await createTradeLog({
      type: "cron",
      action: "signal_check_end",
      details: `Checked: ${result.checked}, Signals: ${result.newSignals}, Executed: ${result.executed}, Errors: ${result.errors.length}`,
      level: "debug",
      result: result.errors.length > 0 ? "partial" : "success",
    });

    finishCron(
      SIGNAL_CHECK_NAME,
      result.errors.length > 0 ? "error" : "success",
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Cron] Signal check error:", errMsg);
    updateProgress(SIGNAL_CHECK_NAME, `Error: ${errMsg}`, "error");

    try {
      await connectDB();
      await createTradeLog({
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

    await createTradeLog({
      type: "cron",
      action: "position_monitor_start",
      details: "Starting position monitor cron job",
      level: "debug",
      result: "started",
    });

    updateProgress(POSITION_MONITOR_NAME, "Running position monitor...");
    const result = await runPositionMonitorAgent();

    updateProgress(
      POSITION_MONITOR_NAME,
      `Done — checked: ${result.checked}, syncedClosed: ${result.syncedClosed}, actions: ${result.actions}, errors: ${result.errors.length}`,
      result.errors.length > 0 ? "warning" : "success",
    );

    console.log(
      `[Cron] Position monitor finished: checked=${result.checked}, syncedClosed=${result.syncedClosed}, actions=${result.actions}, errors=${result.errors.length}${result.errors.length > 0 ? ` [${result.errors.join(", ")}]` : ""}`,
    );

    await connectDB();
    await createTradeLog({
      type: "cron",
      action: "position_monitor_end",
      details: `Checked: ${result.checked}, SyncedClosed: ${result.syncedClosed}, Actions: ${result.actions}, Errors: ${result.errors.length}${result.errors.length > 0 ? ` — ${result.errors.join("; ")}` : ""}`,
      level: "debug",
      result: result.errors.length > 0 ? "partial" : "success",
    });

    finishCron(
      POSITION_MONITOR_NAME,
      result.errors.length > 0 ? "error" : "success",
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Cron] Position monitor error:", errMsg);
    updateProgress(POSITION_MONITOR_NAME, `Error: ${errMsg}`, "error");

    try {
      await connectDB();
      await createTradeLog({
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

    await createTradeLog({
      type: "cron",
      action: "tpsl_monitor_start",
      details: "Starting TP/SL monitor cron job",
      level: "debug",
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
    await createTradeLog({
      type: "cron",
      action: "tpsl_monitor_end",
      details: `Checked: ${result.checked}, Promoted: ${result.promoted}, TP/SL placed: ${result.tpslPlaced}, Errors: ${result.errors.length}`,
      level: "debug",
      result: result.errors.length > 0 ? "partial" : "success",
    });

    finishCron(
      TP_SL_MONITOR_NAME,
      result.errors.length > 0 ? "error" : "success",
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Cron] TP/SL Monitor error:", errMsg);
    updateProgress(TP_SL_MONITOR_NAME, `Error: ${errMsg}`, "error");

    try {
      await connectDB();
      await createTradeLog({
        type: "cron",
        action: "tpsl_monitor_error",
        error: errMsg,
      });
    } catch {}

    finishCron(TP_SL_MONITOR_NAME, "error", errMsg);
  }
}

// ─── Orphan Cleanup ───────────────────────────────────────────────────────────

const ORPHAN_CLEANUP_NAME = "orphan-cleanup";

async function handleOrphanCleanup(req: Request, res: Response) {
  // Block if already running
  if (!tryStart(ORPHAN_CLEANUP_NAME)) {
    const status = getCronStatus(ORPHAN_CLEANUP_NAME);
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
    message: "Orphan cleanup monitor started",
    timestamp: new Date().toISOString(),
  });

  // Fire-and-forget in background
  runOrphanCleanupWork().catch(console.error);
}

async function runOrphanCleanupWork() {
  try {
    console.log(
      "[Cron] Orphan cleanup monitor started at",
      new Date().toISOString(),
    );

    await connectDB();
    updateProgress(ORPHAN_CLEANUP_NAME, "Connected to database");

    await createTradeLog({
      type: "cron",
      action: "orphan_cleanup_start",
      details: "Starting orphan cleanup cron job",
      level: "debug",
      result: "started",
    });

    updateProgress(ORPHAN_CLEANUP_NAME, "Running orphan cleanup monitor...");
    const result = await runOrphanCleanupMonitor();

    updateProgress(
      ORPHAN_CLEANUP_NAME,
      `Checked ${result.accountsChecked} account(s) and ${result.algoOrdersChecked} algo order(s)`,
      "info",
    );

    if (result.symbolsCleaned.length > 0) {
      updateProgress(
        ORPHAN_CLEANUP_NAME,
        `Cleaned orphan protection on: ${result.symbolsCleaned.join(", ")}`,
        "success",
      );
    } else {
      updateProgress(
        ORPHAN_CLEANUP_NAME,
        `No orphan protection orders found across ${result.accountsChecked} account(s)`,
        "info",
      );
    }

    if (result.cancelledOrderIds.length > 0) {
      updateProgress(
        ORPHAN_CLEANUP_NAME,
        `Cancelled order IDs: ${result.cancelledOrderIds.join(", ")}`,
        "success",
      );
    }

    for (const error of result.errors) {
      updateProgress(ORPHAN_CLEANUP_NAME, error, "warning");
    }

    updateProgress(
      ORPHAN_CLEANUP_NAME,
      `Done — accounts: ${result.accountsChecked}, checked: ${result.algoOrdersChecked}, cancelled: ${result.orphansCancelled}${result.symbolsCleaned.length ? `, symbols: ${result.symbolsCleaned.join(", ")}` : ""}`,
      result.errors.length > 0 ? "warning" : "success",
    );

    console.log(
      `[Cron] Orphan cleanup finished: accounts=${result.accountsChecked}, algoChecked=${result.algoOrdersChecked}, cancelled=${result.orphansCancelled}${result.symbolsCleaned.length ? `, symbols=${result.symbolsCleaned.join(", ")}` : ""}${result.cancelledOrderIds.length ? `, orderIds=[${result.cancelledOrderIds.join(", ")}]` : ""}${result.errors.length ? `, errors=${result.errors.length}` : ""}`,
    );

    await connectDB();
    await createTradeLog({
      type: "cron",
      action: "orphan_cleanup_end",
      details: `Accounts: ${result.accountsChecked}, Algo Checked: ${result.algoOrdersChecked}, Cancelled: ${result.orphansCancelled}, Symbols: ${result.symbolsCleaned.join(", ") || "-"}, Order IDs: [${result.cancelledOrderIds.join(", ") || "-"}], Errors: ${result.errors.length}`,
      level: "debug",
      result: result.errors.length > 0 ? "partial" : "success",
    });

    finishCron(
      ORPHAN_CLEANUP_NAME,
      result.errors.length > 0 ? "error" : "success",
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Cron] Orphan cleanup monitor error:", errMsg);
    updateProgress(ORPHAN_CLEANUP_NAME, `Error: ${errMsg}`, "error");

    try {
      await connectDB();
      await createTradeLog({
        type: "cron",
        action: "orphan_cleanup_error",
        error: errMsg,
      });
    } catch {}

    finishCron(ORPHAN_CLEANUP_NAME, "error", errMsg);
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

// GET /api/cron/orphan-cleanup
router.get("/orphan-cleanup", handleOrphanCleanup);
router.post("/orphan-cleanup", handleOrphanCleanup);

// GET /api/cron/status
router.get("/status", (req: Request, res: Response) => {
  res.json({
    success: true,
    cronStatus: getAllCronStatus(),
  });
});

export default router;
