import express from "express";
import request from "supertest";
import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const logMocks = vi.hoisted(() => ({
  createTradeLog: vi.fn(),
  listTradeLogs: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/trade-log-store", () => ({
  createTradeLog: logMocks.createTradeLog,
  listTradeLogs: logMocks.listTradeLogs,
}));

import logsRouter from "./logs";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/", logsRouter);
  return app;
}

beforeEach(() => {
  logMocks.createTradeLog.mockReset();
  logMocks.listTradeLogs.mockReset();
});

test("logs route lists logs with normalized query params and handles failures", async () => {
  logMocks.listTradeLogs.mockResolvedValueOnce({
    logs: [{ id: 1 }],
    page: 2,
    limit: 100,
    totalCount: 1,
    totalPages: 1,
  });
  logMocks.listTradeLogs.mockRejectedValueOnce(new Error("db failed"));

  const app = createApp();
  const success = await request(app).get(
    "/?page=0&limit=999&hideCronNoise=false&accountId=acc1&processId=proc1&order=asc",
  );

  assert.equal(success.status, 200);
  assert.deepEqual(logMocks.listTradeLogs.mock.calls[0][0], {
    page: 1,
    limit: 100,
    hideCronNoise: false,
    accountId: "acc1",
    processId: "proc1",
    order: "asc",
  });
  assert.equal(success.body.success, true);

  const failure = await request(app).get("/");
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.body, {
    success: false,
    error: "db failed",
  });
});

test("logs route creates records, validates required fields, and handles failures", async () => {
  logMocks.createTradeLog
    .mockResolvedValueOnce({ id: 1, type: "executor", action: "buy" })
    .mockRejectedValueOnce(new Error("write failed"));

  const app = createApp();

  const invalid = await request(app).post("/").send({ type: "executor" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, {
    success: false,
    error: "type and action are required",
  });

  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const success = await request(app).post("/").send({
    accountId: 123,
    processId: null,
    type: "executor",
    action: "buy",
    symbol: "BTCUSDT",
    details: "placed",
    result: "ok",
    error: null,
    createdAt,
  });
  assert.equal(success.status, 201);
  assert.deepEqual(logMocks.createTradeLog.mock.calls[0][0], {
    accountId: 123,
    processId: null,
    type: "executor",
    action: "buy",
    symbol: "BTCUSDT",
    details: "placed",
    result: "ok",
    error: null,
    createdAt: createdAt.toISOString(),
  });

  const failure = await request(app).post("/").send({
    type: "executor",
    action: "sell",
  });
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.body, {
    success: false,
    error: "write failed",
  });
});
