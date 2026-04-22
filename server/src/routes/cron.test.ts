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
