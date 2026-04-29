import express from "express";
import request from "supertest";
import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const cronMocks = vi.hoisted(() => ({
  runSignalCheck: vi.fn(),
  runPositionMonitor: vi.fn(),
  runTpslMonitor: vi.fn(),
  connectDB: vi.fn(),
  tryStart: vi.fn(),
  updateProgress: vi.fn(),
  finishCron: vi.fn(),
  getCronStatus: vi.fn(),
  getAllCronStatus: vi.fn(),
  createTradeLog: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/executor", () => ({
  runSignalCheck: cronMocks.runSignalCheck,
}));
vi.mock("@copytrade/shared/lib/monitor", () => ({
  runPositionMonitor: cronMocks.runPositionMonitor,
}));
vi.mock("@copytrade/shared/lib/tp-sl-monitor", () => ({
  runTpslMonitor: cronMocks.runTpslMonitor,
}));
vi.mock("@copytrade/shared/lib/database", () => ({
  connectDB: cronMocks.connectDB,
}));
vi.mock("@copytrade/shared/lib/cron-status", () => ({
  tryStart: cronMocks.tryStart,
  updateProgress: cronMocks.updateProgress,
  finishCron: cronMocks.finishCron,
  getCronStatus: cronMocks.getCronStatus,
  getAllCronStatus: cronMocks.getAllCronStatus,
}));
vi.mock("@copytrade/shared/lib/trade-log-store", () => ({
  createTradeLog: cronMocks.createTradeLog,
}));

import cronRouter from "./cron";

function createApp() {
  const app = express();
  app.use("/", cronRouter);
  return app;
}

beforeEach(() => {
  delete process.env.CRON_SECRET;
  cronMocks.runSignalCheck.mockReset();
  cronMocks.runPositionMonitor.mockReset();
  cronMocks.runTpslMonitor.mockReset();
  cronMocks.connectDB.mockReset();
  cronMocks.tryStart.mockReset();
  cronMocks.updateProgress.mockReset();
  cronMocks.finishCron.mockReset();
  cronMocks.getCronStatus.mockReset();
  cronMocks.getAllCronStatus.mockReset();
  cronMocks.createTradeLog.mockReset();
  vi.restoreAllMocks();
});

test("cron route rejects unauthorized requests when CRON_SECRET is configured", async () => {
  process.env.CRON_SECRET = " secret ";
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const res = await request(createApp()).get("/signal-check");

  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: "Unauthorized" });
  assert.equal(warnSpy.mock.calls.length, 1);

  warnSpy.mockRestore();
});

test("cron route accepts authorized requests when CRON_SECRET matches", async () => {
  process.env.CRON_SECRET = "secret";
  cronMocks.tryStart.mockReturnValue(true);
  cronMocks.runSignalCheck.mockResolvedValue({
    checked: 1,
    newSignals: 0,
    executed: 0,
    errors: [],
  });

  const res = await request(createApp())
    .post("/signal-check")
    .set("authorization", "Bearer secret");

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  await Promise.resolve();
  await Promise.resolve();
});

test("cron route returns conflict when a job is already running and reports status", async () => {
  cronMocks.tryStart.mockReturnValue(false);
  cronMocks.getCronStatus.mockReturnValue({ running: true, progress: "busy" });
  cronMocks.getAllCronStatus.mockReturnValue({ foo: { running: false } });

  const app = createApp();
  const conflict = await request(app).post("/position-monitor");
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.success, false);
  assert.equal(conflict.body.error, "Already running");
  assert.deepEqual(conflict.body.status, { running: true, progress: "busy" });

  const status = await request(app).get("/status");
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, {
    success: true,
    cronStatus: { foo: { running: false } },
  });
});

test("cron route returns conflict for signal-check and records error flows when background work fails", async () => {
  const app = createApp();
  cronMocks.tryStart.mockReturnValueOnce(false);
  cronMocks.getCronStatus.mockReturnValueOnce({
    running: true,
    progress: "signal busy",
  });

  const conflict = await request(app).get("/signal-check");
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body, {
    success: false,
    error: "Already running",
    status: { running: true, progress: "signal busy" },
  });

  cronMocks.tryStart.mockReturnValueOnce(true);
  cronMocks.connectDB.mockResolvedValueOnce(undefined);
  cronMocks.runSignalCheck.mockRejectedValueOnce(new Error("signal crashed"));
  cronMocks.connectDB.mockRejectedValueOnce(new Error("db offline"));

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await request(app).post("/signal-check");

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(cronMocks.updateProgress.mock.calls.at(-1), [
    "signal-check",
    "Error: signal crashed",
    "error",
  ]);
  assert.deepEqual(cronMocks.finishCron.mock.calls.at(-1), [
    "signal-check",
    "error",
    "signal crashed",
  ]);
  assert.equal(cronMocks.createTradeLog.mock.calls.length, 1);
  assert.deepEqual(cronMocks.createTradeLog.mock.calls[0], [
    {
      type: "cron",
      action: "signal_check_start",
      details: "Starting Discord signal check cron job",
      level: "debug",
      result: "started",
    },
  ]);
  assert.equal(errorSpy.mock.calls.some((call) => call.includes("[Cron] Signal check error:")), true);
  errorSpy.mockRestore();
});

test("cron route persists signal-check error logs when catch-path logging succeeds", async () => {
  const app = createApp();
  cronMocks.tryStart.mockReturnValueOnce(true);
  cronMocks.connectDB.mockResolvedValue(undefined);
  cronMocks.runSignalCheck.mockRejectedValueOnce(new Error("signal catch path"));

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await request(app).get("/signal-check");

  assert.equal(res.status, 200);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(cronMocks.createTradeLog.mock.calls, [
    [
      {
        type: "cron",
        action: "signal_check_start",
        details: "Starting Discord signal check cron job",
        level: "debug",
        result: "started",
      },
    ],
    [
      {
        type: "cron",
        action: "signal_check_error",
        error: "signal catch path",
      },
    ],
  ]);
  assert.deepEqual(cronMocks.finishCron.mock.calls.at(-1), [
    "signal-check",
    "error",
    "signal catch path",
  ]);
  errorSpy.mockRestore();
});

test("cron route starts jobs and runs success and error background flows", async () => {
  cronMocks.tryStart.mockReturnValue(true);
  cronMocks.runSignalCheck.mockResolvedValue({
    checked: 3,
    newSignals: 1,
    executed: 1,
    errors: [],
  });
  cronMocks.runTpslMonitor.mockRejectedValue(new Error("tpsl failed"));

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp();

  const signal = await request(app).get("/signal-check");
  assert.equal(signal.status, 200);
  assert.equal(signal.body.success, true);
  assert.equal(signal.body.message, "Signal check started");

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(cronMocks.runSignalCheck.mock.calls.length, 1);
  assert.deepEqual(cronMocks.finishCron.mock.calls[0], [
    "signal-check",
    "success",
  ]);

  const tpsl = await request(app).post("/tp-sl-monitor");
  assert.equal(tpsl.status, 200);
  assert.equal(tpsl.body.success, true);
  assert.equal(tpsl.body.message, "TP/SL Monitor started");

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(cronMocks.runTpslMonitor.mock.calls.length, 1);
  assert.deepEqual(cronMocks.finishCron.mock.calls.at(-1), [
    "tp-sl-monitor",
    "error",
    "tpsl failed",
  ]);
  assert.equal(errorSpy.mock.calls.length > 0, true);

  errorSpy.mockRestore();
});

test("cron route records partial-success signal and TP/SL runs, and position monitor failures", async () => {
  cronMocks.tryStart.mockReturnValue(true);
  cronMocks.runSignalCheck.mockResolvedValue({
    checked: 5,
    newSignals: 2,
    executed: 1,
    errors: ["minor"],
  });
  cronMocks.runPositionMonitor.mockRejectedValue(new Error("monitor blew up"));
  cronMocks.runTpslMonitor.mockResolvedValue({
    checked: 4,
    promoted: 1,
    tpslPlaced: 1,
    errors: ["partial"],
  });

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp();

  const signal = await request(app).post("/signal-check");
  assert.equal(signal.status, 200);

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(cronMocks.finishCron.mock.calls[0], [
    "signal-check",
    "error",
  ]);
  assert.deepEqual(cronMocks.updateProgress.mock.calls[1], [
    "signal-check",
    "Running signal check...",
  ]);
  assert.deepEqual(cronMocks.createTradeLog.mock.calls[0], [
    {
      type: "cron",
      action: "signal_check_start",
      details: "Starting Discord signal check cron job",
      level: "debug",
      result: "started",
    },
  ]);

  const position = await request(app).get("/position-monitor");
  assert.equal(position.status, 200);

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(cronMocks.finishCron.mock.calls[1], [
    "position-monitor",
    "error",
    "monitor blew up",
  ]);

  const tpsl = await request(app).get("/tp-sl-monitor");
  assert.equal(tpsl.status, 200);

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(cronMocks.updateProgress.mock.calls.at(-1), [
    "tp-sl-monitor",
    "Done — checked: 4, promoted: 1, TP/SL placed: 1, errors: 1",
    "warning",
  ]);
  assert.deepEqual(cronMocks.finishCron.mock.calls.at(-1), [
    "tp-sl-monitor",
    "error",
  ]);
  assert.equal(errorSpy.mock.calls.length >= 1, true);
  errorSpy.mockRestore();
});

test("cron route handles position-monitor success and tp/sl conflict responses", async () => {
  const app = createApp();

  cronMocks.tryStart.mockReturnValueOnce(true);
  cronMocks.runPositionMonitor.mockResolvedValue({
    checked: 6,
    actions: 2,
    errors: [],
  });

  const position = await request(app).post("/position-monitor");
  assert.equal(position.status, 200);
  assert.equal(position.body.success, true);
  assert.equal(position.body.message, "Position monitor started");

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(cronMocks.updateProgress.mock.calls[1], [
    "position-monitor",
    "Running position monitor...",
  ]);
  assert.deepEqual(cronMocks.updateProgress.mock.calls[2], [
    "position-monitor",
    "Done — checked: 6, actions: 2",
    "success",
  ]);
  assert.deepEqual(cronMocks.finishCron.mock.calls[0], [
    "position-monitor",
    "success",
  ]);
  assert.deepEqual(cronMocks.createTradeLog.mock.calls[1], [
    {
      type: "cron",
      action: "position_monitor_end",
      details: "Checked: 6, Actions: 2, Errors: 0",
      level: "debug",
      result: "success",
    },
  ]);

  cronMocks.tryStart.mockReturnValueOnce(false);
  cronMocks.getCronStatus.mockReturnValue({ running: true, progress: "busy tpsl" });

  const conflict = await request(app).get("/tp-sl-monitor");
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body, {
    success: false,
    error: "Already running",
    status: { running: true, progress: "busy tpsl" },
  });
});
