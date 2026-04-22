import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const storeMocks = vi.hoisted(() => {
  const mkdir = vi.fn();
  const appendFile = vi.fn();
  const readFile = vi.fn();
  const stat = vi.fn();
  const randomUUID = vi.fn(() => "12345678-1234-5678-1234-567812345678");
  const mongooseConnection = { readyState: 0 };
  const tradeLogCreate = vi.fn();
  const tradeLogFind = vi.fn();
  const fetchMock = vi.fn();

  return {
    mkdir,
    appendFile,
    readFile,
    stat,
    randomUUID,
    mongooseConnection,
    tradeLogCreate,
    tradeLogFind,
    fetchMock,
  };
});

vi.mock("fs/promises", () => ({
  mkdir: storeMocks.mkdir,
  appendFile: storeMocks.appendFile,
  readFile: storeMocks.readFile,
  stat: storeMocks.stat,
}));

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: storeMocks.randomUUID,
  };
});

vi.mock("mongoose", () => ({
  default: {
    connection: storeMocks.mongooseConnection,
  },
}));

vi.mock("./database", () => ({
  TradeLog: {
    create: storeMocks.tradeLogCreate,
    find: storeMocks.tradeLogFind,
  },
}));

import {
  countTradeLogs,
  createTradeLog,
  getProcessTradeLogs,
  getRecentTradeLogs,
  listTradeLogs,
} from "./trade-log-store";

const originalEnv = { ...process.env };

function setEnv(entries: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createMongoQuery(results: unknown[] | Error) {
  const sort = vi.fn();
  const limit = vi.fn();
  const lean = vi.fn();
  const exec = vi.fn();
  const query = {
    sort,
    limit,
    lean,
    exec,
  };

  sort.mockReturnValue(query);
  limit.mockReturnValue(query);
  lean.mockReturnValue(query);

  if (results instanceof Error) {
    exec.mockRejectedValue(results);
  } else {
    exec.mockResolvedValue(results);
  }

  return query;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.BACKEND_URL;
  delete process.env.NEXT_PUBLIC_BACKEND_URL;
  delete process.env.NEXT_RUNTIME;
  delete process.env.VERCEL;
  delete process.env.COPYTRADE_RUNTIME;
  delete process.env.PROCESS_LOG_STORAGE;
  delete process.env.PROCESS_LOG_DIR;
  delete process.env.PROCESS_LOG_INCLUDE_MONGO_LEGACY;

  storeMocks.mkdir.mockReset();
  storeMocks.appendFile.mockReset();
  storeMocks.readFile.mockReset();
  storeMocks.stat.mockReset();
  storeMocks.randomUUID.mockClear();
  storeMocks.tradeLogCreate.mockReset();
  storeMocks.tradeLogFind.mockReset();
  storeMocks.fetchMock.mockReset();
  storeMocks.mongooseConnection.readyState = 0;

  vi.restoreAllMocks();
  vi.stubGlobal("fetch", storeMocks.fetchMock);
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

test("createTradeLog writes normalized records to local files", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1700);
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-logs",
  });

  const createdAt = "2026-01-02T03:04:05.000Z";
  const record = await createTradeLog({
    accountId: undefined,
    processId: "proc/1",
    type: "executor",
    action: "BUY",
    symbol: "BTCUSDT",
    details: undefined,
    result: "ok",
    error: undefined,
    createdAt,
  });

  assert.equal(record._id, "tlog_1700_123456781234");
  assert.deepEqual(record, {
    _id: "tlog_1700_123456781234",
    accountId: null,
    processId: "proc/1",
    type: "executor",
    action: "BUY",
    symbol: "BTCUSDT",
    details: null,
    result: "ok",
    error: null,
    createdAt,
  });

  assert.deepEqual(storeMocks.mkdir.mock.calls, [
    ["/tmp/copytrade-logs", { recursive: true }],
    [path.join("/tmp/copytrade-logs", "processes"), { recursive: true }],
  ]);
  assert.equal(storeMocks.appendFile.mock.calls.length, 2);
  assert.equal(storeMocks.appendFile.mock.calls[0][0], "/tmp/copytrade-logs/all.jsonl");
  assert.equal(
    storeMocks.appendFile.mock.calls[1][0],
    path.join("/tmp/copytrade-logs", "processes", "proc_1.jsonl"),
  );
  assert.match(String(storeMocks.appendFile.mock.calls[0][1]), /"action":"BUY"/);
});

test("createTradeLog writes to mongo mode when the connection is ready", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "mongo",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.tradeLogCreate.mockResolvedValue({ _id: "mongo-record" });

  const record = await createTradeLog({
    accountId: "acc-1",
    processId: "proc-1",
    type: "draft_process",
    action: "manual_accept_completed",
    createdAt: "2026-01-03T00:00:00.000Z",
  });

  assert.equal(record.accountId, "acc-1");
  assert.equal(storeMocks.appendFile.mock.calls.length, 0);
  assert.deepEqual(storeMocks.tradeLogCreate.mock.calls[0][0], {
    accountId: "acc-1",
    processId: "proc-1",
    type: "draft_process",
    action: "manual_accept_completed",
    symbol: null,
    details: null,
    result: null,
    error: null,
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
  });
});

test("createTradeLog warns in dual mode when mongo is unavailable but file writes succeed", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "dual",
    PROCESS_LOG_DIR: "/tmp/copytrade-dual",
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const record = await createTradeLog({
    processId: "proc-2",
    type: "executor",
    action: "SELL",
  });

  assert.equal(record.processId, "proc-2");
  assert.equal(storeMocks.appendFile.mock.calls.length, 2);
  assert.equal(storeMocks.tradeLogCreate.mock.calls.length, 0);
  assert.match(String(warnSpy.mock.calls[0][0]), /Mongo log write failed/);
});

test("getProcessTradeLogs merges file and mongo logs, normalizes mongo records, dedupes, and sorts", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "dual",
    PROCESS_LOG_DIR: "/tmp/copytrade-read",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.stat.mockResolvedValue({});
  storeMocks.readFile.mockResolvedValue(
    [
      JSON.stringify({
        _id: "file-2",
        accountId: "acc-1",
        processId: "proc-merged",
        type: "executor",
        action: "BUY",
        symbol: "BTCUSDT",
        details: "dupe",
        result: "ok",
        error: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
      JSON.stringify({
        _id: "file-3",
        accountId: "acc-1",
        processId: "proc-merged",
        type: "executor",
        action: "TP",
        symbol: "BTCUSDT",
        details: "latest",
        result: "ok",
        error: null,
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
    ].join("\n"),
  );
  storeMocks.tradeLogFind.mockReturnValue(
    createMongoQuery([
      {
        _id: { toString: () => "mongo-1" },
        accountId: 101,
        processId: "proc-merged",
        type: "executor",
        action: "SL",
        symbol: "ETHUSDT",
        details: "earliest",
        result: "warning",
        error: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        _id: "mongo-dupe",
        accountId: "acc-1",
        processId: "proc-merged",
        type: "executor",
        action: "BUY",
        symbol: "BTCUSDT",
        details: "dupe",
        result: "ok",
        error: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]),
  );

  const logs = await getProcessTradeLogs({
    processId: "proc-merged",
    order: "asc",
    limit: 2,
  });

  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map((item) => item._id), ["mongo-1", "file-2"]);
  assert.equal(logs[0]?.accountId, "101");
  assert.deepEqual(storeMocks.tradeLogFind.mock.calls[0][0], {
    processId: "proc-merged",
  });
});

test("listTradeLogs filters file logs, hides cron noise, and paginates descending results", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-list",
  });
  storeMocks.readFile.mockResolvedValue(
    [
      JSON.stringify({
        _id: "cron-1",
        accountId: "acc-1",
        processId: "proc-1",
        type: "cron",
        action: "signal_check_start",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      JSON.stringify({
        _id: "keep-1",
        accountId: "acc-1",
        processId: "proc-1",
        type: "executor",
        action: "BUY",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
      "{bad json}",
      JSON.stringify({
        _id: "keep-2",
        accountId: "acc-1",
        processId: "proc-2",
        type: "executor",
        action: "SELL",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
      JSON.stringify({
        _id: "drop-1",
        accountId: "acc-2",
        processId: "proc-1",
        type: "executor",
        action: "BUY",
        createdAt: "2026-01-04T00:00:00.000Z",
      }),
    ].join("\n"),
  );

  const result = await listTradeLogs({
    page: 2,
    limit: 1,
    accountId: "acc-1",
    hideCronNoise: true,
    order: "desc",
  });

  assert.equal(result.totalCount, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.page, 2);
  assert.equal(result.limit, 1);
  assert.equal(result.logs[0]?._id, "keep-1");
});

test("remote backend mode proxies create, list, count, and recent-log requests", async () => {
  setEnv({
    BACKEND_URL: "https://backend.example.com/",
    NEXT_RUNTIME: "edge",
  });

  storeMocks.fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { _id: "remote-1", type: "executor", action: "BUY" },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          logs: [{ _id: "remote-log-1" }],
          totalCount: 9,
          page: 1,
          limit: 500,
          totalPages: 1,
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          logs: [{ _id: "remote-log-2" }],
          totalCount: 7,
          page: 1,
          limit: 1,
          totalPages: 7,
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          logs: [{ _id: "remote-log-3" }, { _id: "remote-log-4" }],
          totalCount: 2,
          page: 1,
          limit: 2,
          totalPages: 1,
        },
      }),
    });

  const created = await createTradeLog({
    type: "executor",
    action: "BUY",
  });
  const listed = await listTradeLogs({
    page: 0,
    limit: 999,
    hideCronNoise: false,
    accountId: "acc-remote",
    processId: "proc-remote",
    order: "asc",
  });
  const counted = await countTradeLogs();
  const recent = await getRecentTradeLogs(2);

  assert.equal(created._id, "remote-1");
  assert.equal(
    storeMocks.fetchMock.mock.calls[0][0],
    "https://backend.example.com/api/logs",
  );
  assert.equal(
    storeMocks.fetchMock.mock.calls[1][0],
    "https://backend.example.com/api/logs?page=1&limit=500&hideCronNoise=false&order=asc&accountId=acc-remote&processId=proc-remote",
  );
  assert.equal(
    storeMocks.fetchMock.mock.calls[2][0],
    "https://backend.example.com/api/logs?page=1&limit=1&hideCronNoise=false&order=desc",
  );
  assert.equal(
    storeMocks.fetchMock.mock.calls[3][0],
    "https://backend.example.com/api/logs?page=1&limit=2&hideCronNoise=false&order=desc",
  );
  assert.equal(listed.totalCount, 9);
  assert.equal(counted, 7);
  assert.deepEqual(recent, [{ _id: "remote-log-3" }, { _id: "remote-log-4" }]);
});

test("remote backend mode surfaces request failures", async () => {
  setEnv({
    NEXT_RUNTIME: "nodejs",
    NEXT_PUBLIC_BACKEND_URL: "https://backend.example.com",
  });
  storeMocks.fetchMock.mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({
      success: false,
      error: "backend unavailable",
    }),
  });

  await assert.rejects(
    () =>
      listTradeLogs({
        page: 1,
      }),
    /backend unavailable/,
  );
});
