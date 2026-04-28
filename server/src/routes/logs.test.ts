import express from "express";
import request from "supertest";
import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const logMocks = vi.hoisted(() => ({
  createTradeLog: vi.fn(),
  listTradeLogs: vi.fn(),
  cleanupTradeLogs: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/trade-log-store", () => ({
  createTradeLog: logMocks.createTradeLog,
  listTradeLogs: logMocks.listTradeLogs,
  cleanupTradeLogs: logMocks.cleanupTradeLogs,
}));

import logsRouter from "./logs";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/", logsRouter);
  return app;
}

function createAppWithBody(body: unknown) {
  const app = express();
  app.use((req, _res, next) => {
    req.body = body;
    next();
  });
  app.use("/", logsRouter);
  return app;
}

function createAppWithoutBody() {
  const app = express();
  app.use((req, _res, next) => {
    req.body = undefined;
    next();
  });
  app.use("/", logsRouter);
  return app;
}

beforeEach(() => {
  logMocks.createTradeLog.mockReset();
  logMocks.listTradeLogs.mockReset();
  logMocks.cleanupTradeLogs.mockReset();
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

  logMocks.listTradeLogs.mockRejectedValueOnce("string failure");
  const stringFailure = await request(app).get("/");
  assert.equal(stringFailure.status, 500);
  assert.deepEqual(stringFailure.body, {
    success: false,
    error: "Unknown error",
  });
});

test("logs route creates records, validates required fields, and handles failures", async () => {
  logMocks.createTradeLog
    .mockResolvedValueOnce({ id: 1, type: "executor", action: "buy" })
    .mockResolvedValueOnce({ id: 15, type: "executor", action: "warn" })
    .mockRejectedValueOnce(new Error("write failed"));

  const app = createApp();

  const invalid = await request(app).post("/").send({ type: "executor" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, {
    success: false,
    error: "type and action are required",
  });

  const invalidNoBody = await request(createAppWithoutBody()).post("/");
  assert.equal(invalidNoBody.status, 400);
  assert.deepEqual(invalidNoBody.body, {
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

  const stringErrorSuccess = await request(app).post("/").send({
    type: "executor",
    action: "warn",
    error: "explicit error",
  });
  assert.equal(stringErrorSuccess.status, 201);
  assert.equal(
    logMocks.createTradeLog.mock.calls[1]?.[0]?.error,
    "explicit error",
  );

  const failure = await request(app).post("/").send({
    type: "executor",
    action: "sell",
  });
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.body, {
    success: false,
    error: "write failed",
  });

  logMocks.createTradeLog.mockResolvedValueOnce({ id: 2 });
  const dateApp = createAppWithBody({
    type: "executor",
    action: "date-test",
    accountId: "acc-date",
    processId: "proc-date",
    symbol: 123,
    details: { raw: true },
    result: ["x"],
    error: 99,
    createdAt,
  });
  const dateSuccess = await request(dateApp).post("/");
  assert.equal(dateSuccess.status, 201);
  assert.equal(
    logMocks.createTradeLog.mock.calls.some(
      (call) => call[0]?.createdAt === createdAt,
    ),
    true,
  );

  logMocks.createTradeLog.mockRejectedValueOnce("string write failure");
  const stringFailure = await request(app).post("/").send({
    type: "executor",
    action: "sell",
  });
  assert.equal(stringFailure.status, 500);
  assert.deepEqual(stringFailure.body, {
    success: false,
    error: "Unknown error",
  });
});

test("logs cleanup route deletes noisy logs, validates keepDays, and handles failures", async () => {
  logMocks.cleanupTradeLogs
    .mockResolvedValueOnce({
      mode: "noisy-json",
      scannedCount: 10,
      deletedCount: 4,
      remainingCount: 6,
      deletedFileCount: 2,
      deletedMongoCount: 2,
    })
    .mockResolvedValueOnce({
      mode: "retention",
      keepDays: 3,
      scannedCount: 10,
      deletedCount: 7,
      remainingCount: 3,
      deletedFileCount: 5,
      deletedMongoCount: 2,
    })
    .mockRejectedValueOnce(new Error("cleanup failed"));

  const app = createApp();

  const noisy = await request(app).post("/cleanup").send({});
  assert.equal(noisy.status, 200);
  assert.deepEqual(logMocks.cleanupTradeLogs.mock.calls[0]?.[0], {
    mode: "noisy-json",
    keepDays: undefined,
  });
  assert.equal(noisy.body.success, true);

  const invalid = await request(app).post("/cleanup").send({
    mode: "retention",
    keepDays: 0,
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, {
    success: false,
    error: "keepDays must be a number greater than or equal to 1",
  });

  const retention = await request(app).post("/cleanup").send({
    mode: "retention",
    keepDays: "3",
  });
  assert.equal(retention.status, 200);
  assert.deepEqual(logMocks.cleanupTradeLogs.mock.calls[1]?.[0], {
    mode: "retention",
    keepDays: 3,
  });

  const failure = await request(app).post("/cleanup").send({
    mode: "retention",
    keepDays: 5,
  });
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.body, {
    success: false,
    error: "cleanup failed",
  });

  logMocks.cleanupTradeLogs.mockRejectedValueOnce("string cleanup failure");
  const stringFailure = await request(app).post("/cleanup").send({
    mode: "retention",
    keepDays: 2,
  });
  assert.equal(stringFailure.status, 500);
  assert.deepEqual(stringFailure.body, {
    success: false,
    error: "Unknown error",
  });
});
