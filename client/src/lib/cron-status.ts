/**
 * Cron Status — in-memory progress tracking & request deduplication.
 *
 * Since serverless functions can run on different instances,
 * this is best-effort (per-instance) deduplication. For true
 * distributed locking you'd need Redis — but this covers the
 * common case of rapid double-clicks or overlapping Vercel cron calls.
 */

export interface CronRunStatus {
  running: boolean;
  startedAt: string | null;
  progress: string;
  steps: CronStep[];
  result: "success" | "error" | null;
  error: string | null;
  completedAt: string | null;
}

export interface CronStep {
  message: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "error";
}

const initialStatus = (): CronRunStatus => ({
  running: false,
  startedAt: null,
  progress: "",
  steps: [],
  result: null,
  error: null,
  completedAt: null,
});

// In-memory store — keyed by cron name
const store: Record<string, CronRunStatus> = {};

export function getCronStatus(name: string): CronRunStatus {
  if (!store[name]) {
    store[name] = initialStatus();
  }
  return { ...store[name], steps: [...store[name].steps] };
}

export function getAllCronStatus(): Record<string, CronRunStatus> {
  return {
    "signal-check": getCronStatus("signal-check"),
    "position-monitor": getCronStatus("position-monitor"),
    "tp-sl-monitor": getCronStatus("tp-sl-monitor"),
  };
}

/** Try to acquire the "lock" for a cron. Returns false if already running. */
export function tryStart(name: string): boolean {
  if (!store[name]) {
    store[name] = initialStatus();
  }
  if (store[name].running) {
    return false;
  }
  store[name] = {
    running: true,
    startedAt: new Date().toISOString(),
    progress: "Starting...",
    steps: [
      {
        message: "Job started",
        timestamp: new Date().toISOString(),
        type: "info",
      },
    ],
    result: null,
    error: null,
    completedAt: null,
  };
  return true;
}

export function updateProgress(
  name: string,
  progress: string,
  type: CronStep["type"] = "info",
) {
  if (!store[name]) return;
  store[name].progress = progress;
  store[name].steps.push({
    message: progress,
    timestamp: new Date().toISOString(),
    type,
  });
}

export function finishCron(
  name: string,
  result: "success" | "error",
  error?: string,
) {
  if (!store[name]) return;
  store[name].running = false;
  store[name].result = result;
  store[name].error = error || null;
  store[name].completedAt = new Date().toISOString();
  store[name].progress =
    result === "success" ? "Completed" : `Failed: ${error}`;
  store[name].steps.push({
    message: result === "success" ? "✅ Completed" : `❌ Failed: ${error}`,
    timestamp: new Date().toISOString(),
    type: result === "success" ? "success" : "error",
  });
}
