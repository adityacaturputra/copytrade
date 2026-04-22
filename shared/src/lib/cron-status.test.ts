import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import {
  finishCron,
  getAllCronStatus,
  getCronStatus,
  tryStart,
  updateProgress,
} from "./cron-status";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-21T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

test("cron-status initializes default entries and returns defensive copies", () => {
  const status = getCronStatus("custom-job");
  assert.deepEqual(status, {
    running: false,
    startedAt: null,
    progress: "",
    steps: [],
    result: null,
    error: null,
    completedAt: null,
  });

  status.steps.push({
    message: "mutated",
    timestamp: "x",
    type: "info",
  });

  assert.equal(getCronStatus("custom-job").steps.length, 0);
  const all = getAllCronStatus();
  assert.deepEqual(Object.keys(all), [
    "signal-check",
    "position-monitor",
    "tp-sl-monitor",
  ]);
});

test("cron-status start, progress, finish, and duplicate-start behavior", () => {
  assert.equal(tryStart("signal-check"), true);
  const started = getCronStatus("signal-check");
  assert.equal(started.running, true);
  assert.equal(started.progress, "Starting...");
  assert.equal(started.steps[0].message, "Job started");

  assert.equal(tryStart("signal-check"), false);

  vi.setSystemTime(new Date("2026-04-21T00:01:00.000Z"));
  updateProgress("signal-check", "Halfway", "warning");
  const progressed = getCronStatus("signal-check");
  assert.equal(progressed.progress, "Halfway");
  assert.equal(progressed.steps.at(-1)?.type, "warning");

  finishCron("signal-check", "success");
  const finishedSuccess = getCronStatus("signal-check");
  assert.equal(finishedSuccess.running, false);
  assert.equal(finishedSuccess.result, "success");
  assert.equal(finishedSuccess.progress, "Completed");
  assert.match(finishedSuccess.steps.at(-1)?.message || "", /Completed/);

  assert.equal(tryStart("signal-check"), true);
  finishCron("signal-check", "error", "boom");
  const finishedError = getCronStatus("signal-check");
  assert.equal(finishedError.result, "error");
  assert.equal(finishedError.error, "boom");
  assert.equal(finishedError.progress, "Failed: boom");
  assert.match(finishedError.steps.at(-1)?.message || "", /Failed: boom/);
});

test("cron-status no-ops for unknown jobs on progress or finish", () => {
  updateProgress("missing", "ignored");
  finishCron("missing", "success");
  assert.equal(getCronStatus("missing").steps.length, 0);
});
