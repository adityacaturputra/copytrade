import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const logMocks = vi.hoisted(() => ({
  createTradeLog: vi.fn(async (payload) => payload),
  randomUUID: vi.fn(() => "12345678-1234-5678-1234-567812345678"),
}));

vi.mock("./trade-log-store", () => ({
  createTradeLog: logMocks.createTradeLog,
}));

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: logMocks.randomUUID,
  };
});

import {
  createTradeProcessId,
  logExecutorError,
  logExecutorInfo,
  logExecutorWarn,
  logProcessStep,
  serializeProcessLogDetails,
} from "./process-log";

beforeEach(() => {
  logMocks.createTradeLog.mockClear();
  logMocks.randomUUID.mockClear();
  vi.restoreAllMocks();
});

test("process-log serializes details and generates stable process ids", () => {
  vi.spyOn(Date, "now").mockReturnValue(999);
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assert.equal(createTradeProcessId("draft"), "draft_999_123456781234");
  assert.equal(serializeProcessLogDetails(undefined), undefined);
  assert.equal(serializeProcessLogDetails("text"), "text");
  assert.equal(serializeProcessLogDetails({ ok: true }), "{\"ok\":true}");
  assert.equal(serializeProcessLogDetails(circular), "[object Object]");
});

test("logProcessStep maps nullish fields before writing the trade log", async () => {
  const result = await logProcessStep({
    type: "executor",
    action: "buy",
    details: { symbol: "BTCUSDT" },
  });

  assert.deepEqual(logMocks.createTradeLog.mock.calls[0][0], {
    accountId: null,
    processId: null,
    type: "executor",
    action: "buy",
    symbol: null,
    details: "{\"symbol\":\"BTCUSDT\"}",
    result: null,
    error: null,
  });
  assert.equal((result as { action: string }).action, "buy");
});

test("executor console helpers log to console and persist normalized process logs", async () => {
  const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  await logExecutorInfo("info message");
  await logExecutorWarn("warn message", {
    processId: "p1",
    symbol: "BTCUSDT",
  });
  await logExecutorError("error message", {
    accountId: "acc1",
    action: "custom_error",
    result: "fatal",
  });

  assert.equal(infoSpy.mock.calls[0][0], "info message");
  assert.equal(warnSpy.mock.calls[0][0], "warn message");
  assert.equal(errorSpy.mock.calls[0][0], "error message");

  assert.deepEqual(logMocks.createTradeLog.mock.calls[0][0], {
    accountId: null,
    processId: null,
    type: "executor_console",
    action: "console_info",
    symbol: null,
    details: "info message",
    result: "info",
    error: null,
  });
  assert.deepEqual(logMocks.createTradeLog.mock.calls[1][0], {
    accountId: null,
    processId: "p1",
    type: "draft_process",
    action: "console_warn",
    symbol: "BTCUSDT",
    details: "warn message",
    result: "warning",
    error: null,
  });
  assert.deepEqual(logMocks.createTradeLog.mock.calls[2][0], {
    accountId: "acc1",
    processId: null,
    type: "executor_console",
    action: "custom_error",
    symbol: null,
    details: "error message",
    result: "fatal",
    error: "error message",
  });
});

test("logExecutorError uses default error action and result when context omits them", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  await logExecutorError("default error");

  assert.equal(errorSpy.mock.calls[0][0], "default error");
  assert.deepEqual(logMocks.createTradeLog.mock.calls[0][0], {
    accountId: null,
    processId: null,
    type: "executor_console",
    action: "console_error",
    symbol: null,
    details: "default error",
    result: "error",
    error: "default error",
  });
});
