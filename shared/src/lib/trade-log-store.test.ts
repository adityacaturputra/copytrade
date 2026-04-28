import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

const storeMocks = vi.hoisted(() => {
  const mkdir = vi.fn();
  const appendFile = vi.fn();
  const readFile = vi.fn();
  const stat = vi.fn();
  const writeFile = vi.fn();
  const rm = vi.fn();
  const randomUUID = vi.fn(() => "12345678-1234-5678-1234-567812345678");
  const mongooseConnection = { readyState: 0 };
  const tradeLogCreate = vi.fn();
  const tradeLogFind = vi.fn();
  const tradeLogDeleteMany = vi.fn();
  const fetchMock = vi.fn();

  return {
    mkdir,
    appendFile,
    readFile,
    stat,
    writeFile,
    rm,
    randomUUID,
    mongooseConnection,
    tradeLogCreate,
    tradeLogFind,
    tradeLogDeleteMany,
    fetchMock,
  };
});

vi.mock("fs/promises", () => ({
  mkdir: storeMocks.mkdir,
  appendFile: storeMocks.appendFile,
  readFile: storeMocks.readFile,
  stat: storeMocks.stat,
  writeFile: storeMocks.writeFile,
  rm: storeMocks.rm,
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
    deleteMany: storeMocks.tradeLogDeleteMany,
  },
}));

import {
  cleanupTradeLogs,
  countTradeLogs,
  createTradeLog,
  getProcessTradeLogs,
  isNoisyTradeLog,
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

function createMongoQuery(results: unknown[] | Error | string) {
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

  if (results instanceof Error || typeof results === "string") {
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
  storeMocks.writeFile.mockReset();
  storeMocks.rm.mockReset();
  storeMocks.randomUUID.mockClear();
  storeMocks.tradeLogCreate.mockReset();
  storeMocks.tradeLogFind.mockReset();
  storeMocks.tradeLogDeleteMany.mockReset();
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

test("createTradeLog stores null processId in mongo when the input processId is empty", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "mongo",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.tradeLogCreate.mockResolvedValue({ _id: "mongo-record-null-process" });

  await createTradeLog({
    accountId: "acc-2",
    processId: "",
    type: "executor",
    action: "BUY",
  });

  assert.equal(storeMocks.tradeLogCreate.mock.calls.at(-1)?.[0]?.processId, null);
});

test("createTradeLog normalizes Date and invalid createdAt inputs", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-08T12:00:00.000Z"));
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-created-at",
  });

  const dated = await createTradeLog({
    processId: "proc-date",
    type: "executor",
    action: "BUY",
    createdAt: new Date("2026-01-07T00:00:00.000Z"),
  });
  const invalid = await createTradeLog({
    processId: "proc-invalid-date",
    type: "executor",
    action: "SELL",
    createdAt: "not-a-date",
  });

  assert.equal(dated.createdAt, "2026-01-07T00:00:00.000Z");
  assert.equal(invalid.createdAt, "2026-01-08T12:00:00.000Z");
  vi.useRealTimers();
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

test("createTradeLog throws for file-only failures, mongo-only failures, and dual-write failures", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-fail",
  });
  storeMocks.appendFile.mockRejectedValueOnce(new Error("disk full"));
  await assert.rejects(
    () =>
      createTradeLog({
        processId: "file-only",
        type: "executor",
        action: "BUY",
      }),
    /disk full/,
  );

  setEnv({
    PROCESS_LOG_STORAGE: "mongo",
  });
  await assert.rejects(
    () =>
      createTradeLog({
        processId: "mongo-only",
        type: "executor",
        action: "SELL",
      }),
    /MongoDB connection is not ready/,
  );

  setEnv({
    PROCESS_LOG_STORAGE: "dual",
    PROCESS_LOG_DIR: "/tmp/copytrade-dual-fail",
  });
  storeMocks.appendFile.mockRejectedValueOnce(new Error("append failed"));
  await assert.rejects(
    () =>
      createTradeLog({
        processId: "dual-both",
        type: "executor",
        action: "TP",
      }),
    /append failed/,
  );
});

test("createTradeLog warns when file writes fail but mongo writes succeed in dual mode", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "dual",
    PROCESS_LOG_DIR: "/tmp/copytrade-dual-warn",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.appendFile.mockRejectedValue(new Error("readonly fs"));
  storeMocks.tradeLogCreate.mockResolvedValue({ _id: "mongo-ok" });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const record = await createTradeLog({
    processId: "proc-dual-warn",
    type: "executor",
    action: "SL",
  });

  assert.equal(record.processId, "proc-dual-warn");
  assert.equal(storeMocks.tradeLogCreate.mock.calls.length, 1);
  assert.match(String(warnSpy.mock.calls[0][0]), /File log write failed: readonly fs/);
});

test("createTradeLog stringifies non-Error file write failures", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-file-string-fail",
  });
  storeMocks.appendFile.mockRejectedValueOnce("disk exploded");

  await assert.rejects(
    () =>
      createTradeLog({
        processId: "file-string-fail",
        type: "executor",
        action: "BUY",
      }),
    /disk exploded/,
  );
});

test("createTradeLog throws mongo create errors when mongo-only writes fail after connection is ready", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "mongo",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.tradeLogCreate.mockRejectedValueOnce(new Error("mongo create failed"));

  await assert.rejects(
    () =>
      createTradeLog({
        processId: "mongo-create-fail",
        type: "executor",
        action: "SELL",
      }),
    /mongo create failed/,
  );
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

test("getProcessTradeLogs warns and falls back to files when mongo process reads fail", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "dual",
    PROCESS_LOG_DIR: "/tmp/copytrade-read-fallback",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.stat.mockResolvedValue({});
  storeMocks.readFile.mockResolvedValue(
    JSON.stringify({
      _id: "file-proc-only",
      accountId: "acc-1",
      processId: "proc-fallback",
      type: "executor",
      action: "BUY",
      createdAt: "2026-01-02T00:00:00.000Z",
    }),
  );
  storeMocks.tradeLogFind.mockReturnValue(createMongoQuery(new Error("mongo process read failed")));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const logs = await getProcessTradeLogs({
    processId: "proc-fallback",
    order: "asc",
  });

  assert.deepEqual(logs.map((log) => log._id), ["file-proc-only"]);
  assert.match(
    String(warnSpy.mock.calls[0]?.[0]),
    /Failed to read Mongo process logs for proc-fallback: mongo process read failed/,
  );
});

test("getProcessTradeLogs stringifies non-Error mongo process read failures and supports descending mongo sort", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_INCLUDE_MONGO_LEGACY: "true",
    PROCESS_LOG_DIR: "/tmp/copytrade-read-non-error",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.stat.mockResolvedValue({});
  storeMocks.readFile.mockResolvedValue(
    JSON.stringify({
      _id: "file-proc-desc",
      accountId: "acc-1",
      processId: "proc-non-error",
      type: "executor",
      action: "BUY",
      createdAt: "2026-01-02T00:00:00.000Z",
    }),
  );
  const sortQuery = createMongoQuery([
    {
      _id: "mongo-latest",
      accountId: "acc-1",
      processId: "proc-sort-desc",
      type: "executor",
      action: "SELL",
      createdAt: "2026-01-03T00:00:00.000Z",
    },
  ]);
  storeMocks.tradeLogFind.mockReturnValueOnce(sortQuery);

  const sortedLogs = await getProcessTradeLogs({
    processId: "proc-sort-desc",
    order: "desc",
  });

  assert.deepEqual(sortedLogs.map((log) => log._id), [
    "mongo-latest",
    "file-proc-desc",
  ]);
  assert.deepEqual(sortQuery.sort.mock.calls[0][0], { createdAt: -1 });

  storeMocks.tradeLogFind.mockReturnValueOnce(createMongoQuery("mongo process string failure"));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const fallbackLogs = await getProcessTradeLogs({
    processId: "proc-non-error",
  });

  assert.deepEqual(fallbackLogs.map((log) => log._id), ["file-proc-desc"]);
  assert.match(
    String(warnSpy.mock.calls[0]?.[0]),
    /Failed to read Mongo process logs for proc-non-error: mongo process string failure/,
  );
});

test("getProcessTradeLogs skips legacy mongo reads when mongo is not ready", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_INCLUDE_MONGO_LEGACY: "true",
    PROCESS_LOG_DIR: "/tmp/copytrade-read-not-ready",
  });
  storeMocks.stat.mockResolvedValue({});
  storeMocks.readFile.mockResolvedValue(
    JSON.stringify({
      _id: "file-no-mongo-ready",
      accountId: "acc-1",
      processId: "proc-no-mongo-ready",
      type: "executor",
      action: "BUY",
      createdAt: "2026-01-02T00:00:00.000Z",
    }),
  );

  const logs = await getProcessTradeLogs({
    processId: "proc-no-mongo-ready",
  });

  assert.deepEqual(logs.map((log) => log._id), ["file-no-mongo-ready"]);
  assert.equal(storeMocks.tradeLogFind.mock.calls.length, 0);
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

test("listTradeLogs filters by processId without dropping accountId=all records", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-list-process",
  });
  storeMocks.readFile.mockResolvedValue(
    [
      JSON.stringify({
        _id: "keep-proc",
        accountId: "acc-1",
        processId: "proc-keep",
        type: "executor",
        action: "BUY",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
      JSON.stringify({
        _id: "drop-proc",
        accountId: "acc-2",
        processId: "proc-drop",
        type: "executor",
        action: "SELL",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
    ].join("\n"),
  );

  const result = await listTradeLogs({
    accountId: "all",
    processId: "proc-keep",
    hideCronNoise: false,
  });

  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.logs.map((log) => log._id), ["keep-proc"]);
});

test("listTradeLogs warns and falls back to file logs when reading all mongo logs fails", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "dual",
    PROCESS_LOG_DIR: "/tmp/copytrade-list-mongo-fallback",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.readFile.mockResolvedValue(
    JSON.stringify({
      _id: "file-global-only",
      accountId: "acc-1",
      processId: "proc-1",
      type: "executor",
      action: "SELL",
      createdAt: "2026-01-04T00:00:00.000Z",
    }),
  );
  storeMocks.tradeLogFind.mockReturnValue(createMongoQuery(new Error("mongo list failed")));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const result = await listTradeLogs({
    hideCronNoise: false,
  });

  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.logs.map((log) => log._id), ["file-global-only"]);
  assert.match(
    String(warnSpy.mock.calls[0]?.[0]),
    /Failed to read Mongo logs: mongo list failed/,
  );
});

test("listTradeLogs stringifies non-Error mongo list read failures", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_INCLUDE_MONGO_LEGACY: "true",
    PROCESS_LOG_DIR: "/tmp/copytrade-list-mongo-string",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.readFile.mockResolvedValue(
    JSON.stringify({
      _id: "file-global-string",
      accountId: "acc-1",
      processId: "proc-1",
      type: "executor",
      action: "SELL",
      createdAt: "2026-01-04T00:00:00.000Z",
    }),
  );
  storeMocks.tradeLogFind.mockReturnValue(createMongoQuery("mongo list string failure"));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const result = await listTradeLogs({
    hideCronNoise: false,
  });

  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.logs.map((log) => log._id), ["file-global-string"]);
  assert.match(
    String(warnSpy.mock.calls[0]?.[0]),
    /Failed to read Mongo logs: mongo list string failure/,
  );
});

test("listTradeLogs normalizes mongo ids and createdAt variants on successful global reads", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "mongo",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.readFile.mockResolvedValue("");
  storeMocks.tradeLogFind.mockReturnValue(
    createMongoQuery([
      {
        _id: { toString: () => "mongo-date" },
        accountId: 1,
        processId: 2,
        type: "executor",
        action: "BUY",
        error: "already-string",
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
      },
      {
        _id: null,
        accountId: null,
        processId: null,
        type: undefined,
        action: undefined,
        symbol: 42,
        details: { nested: true },
        result: false,
        error: 500,
      },
    ]),
  );

  const result = await listTradeLogs({
    hideCronNoise: false,
    order: "asc",
  });

  assert.equal(result.totalCount, 2);
  assert.equal(result.logs[0]?._id, "mongo-date");
  assert.equal(result.logs[0]?.createdAt, "2026-01-05T00:00:00.000Z");
  assert.equal(result.logs[0]?.error, "already-string");
  assert.match(String(result.logs[1]?._id), /^mongo_12345678123456781234567812345678$/);
  assert.equal(result.logs[1]?.type, "");
  assert.equal(result.logs[1]?.action, "");
  assert.equal(result.logs[1]?.symbol, "42");
  assert.equal(result.logs[1]?.details, "[object Object]");
  assert.equal(result.logs[1]?.result, "false");
  assert.equal(result.logs[1]?.error, "500");
  assert.ok(Date.parse(String(result.logs[1]?.createdAt)));
});

test("listTradeLogs skips mongo reads when file mode disables legacy mongo access", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_INCLUDE_MONGO_LEGACY: "false",
    PROCESS_LOG_DIR: "/tmp/copytrade-list-no-mongo",
  });
  storeMocks.readFile.mockResolvedValue(
    JSON.stringify({
      _id: "file-only-1",
      accountId: "acc-1",
      processId: "proc-1",
      type: "executor",
      action: "BUY",
      createdAt: "2026-01-06T00:00:00.000Z",
    }),
  );

  const result = await listTradeLogs({
    hideCronNoise: false,
  });

  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.logs.map((log) => log._id), ["file-only-1"]);
  assert.equal(storeMocks.tradeLogFind.mock.calls.length, 0);
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

test("getProcessTradeLogs supports remote proxy mode and local file-only mode without mongo reads", async () => {
  setEnv({
    BACKEND_URL: "https://backend.example.com",
    NEXT_RUNTIME: "nodejs",
  });
  storeMocks.fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        logs: [{ _id: "remote-proc-1" }],
        totalCount: 1,
        page: 1,
        limit: 3,
        totalPages: 1,
      },
    }),
  });

  const remoteLogs = await getProcessTradeLogs({
    processId: "proc-remote",
    limit: 3,
    order: "desc",
  });

  assert.deepEqual(remoteLogs, [{ _id: "remote-proc-1" }]);
  assert.equal(
    storeMocks.fetchMock.mock.calls[0][0],
    "https://backend.example.com/api/logs?processId=proc-remote&hideCronNoise=false&order=desc&limit=3",
  );

  setEnv({
    BACKEND_URL: undefined,
    NEXT_RUNTIME: undefined,
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_INCLUDE_MONGO_LEGACY: "false",
    PROCESS_LOG_DIR: "/tmp/copytrade-process-local",
  });
  storeMocks.stat.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));

  const localLogs = await getProcessTradeLogs({
    processId: "proc-local",
  });

  assert.deepEqual(localLogs, []);
  assert.equal(storeMocks.tradeLogFind.mock.calls.length, 0);

  storeMocks.stat.mockRejectedValueOnce(
    Object.assign(new Error("permission denied"), { code: "EACCES" }),
  );
  await assert.rejects(
    () =>
      getProcessTradeLogs({
        processId: "proc-local-error",
      }),
    /permission denied/,
  );
});

test("getProcessTradeLogs defaults to ascending order for remote and legacy-mongo reads", async () => {
  setEnv({
    BACKEND_URL: "https://backend.example.com",
    NEXT_RUNTIME: "nodejs",
  });
  storeMocks.fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        logs: [{ _id: "remote-default-order" }],
        totalCount: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      },
    }),
  });

  const remoteLogs = await getProcessTradeLogs({
    processId: "proc-remote-default",
  });

  assert.deepEqual(remoteLogs, [{ _id: "remote-default-order" }]);
  assert.equal(
    storeMocks.fetchMock.mock.calls[0][0],
    "https://backend.example.com/api/logs?processId=proc-remote-default&hideCronNoise=false&order=asc",
  );

  setEnv({
    BACKEND_URL: undefined,
    NEXT_RUNTIME: undefined,
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_INCLUDE_MONGO_LEGACY: "true",
    PROCESS_LOG_DIR: "/tmp/copytrade-process-legacy-default",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.stat.mockResolvedValue({});
  storeMocks.readFile.mockResolvedValue(
    JSON.stringify({
      _id: "file-middle",
      accountId: "acc-1",
      processId: "proc-legacy-default",
      type: "executor",
      action: "BUY",
      createdAt: "2026-01-02T00:00:00.000Z",
    }),
  );
  const mongoQuery = createMongoQuery([
    {
      _id: "mongo-earliest",
      accountId: "acc-1",
      processId: "proc-legacy-default",
      type: "executor",
      action: "INIT",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  storeMocks.tradeLogFind.mockReturnValueOnce(mongoQuery);

  const localLogs = await getProcessTradeLogs({
    processId: "proc-legacy-default",
  });

  assert.deepEqual(
    localLogs.map((log) => log._id),
    ["mongo-earliest", "file-middle"],
  );
  assert.deepEqual(mongoQuery.sort.mock.calls[0][0], { createdAt: 1 });
  assert.equal(mongoQuery.limit.mock.calls[0][0], 1000);
});

test("countTradeLogs and getRecentTradeLogs use local list mode when no remote backend is active", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-count-local",
  });
  storeMocks.readFile.mockResolvedValue(
    [
      JSON.stringify({
        _id: "local-1",
        accountId: "acc-1",
        processId: "proc-1",
        type: "executor",
        action: "BUY",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      JSON.stringify({
        _id: "local-2",
        accountId: "acc-1",
        processId: "proc-2",
        type: "executor",
        action: "SELL",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    ].join("\n"),
  );

  const total = await countTradeLogs();
  const recent = await getRecentTradeLogs(1);

  assert.equal(total, 2);
  assert.deepEqual(recent.map((log) => log._id), ["local-2"]);
});

test("listTradeLogs falls back to file mode for invalid storage config and surfaces non-ENOENT file errors", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "weird-mode",
    PROCESS_LOG_DIR: "/tmp/copytrade-invalid-storage",
  });
  storeMocks.appendFile.mockResolvedValue(undefined);

  const created = await createTradeLog({
    type: "executor",
    action: "BUY",
  });
  assert.equal(created.type, "executor");

  storeMocks.readFile.mockRejectedValueOnce(
    Object.assign(new Error("read exploded"), { code: "EIO" }),
  );

  await assert.rejects(
    () =>
      listTradeLogs({
        hideCronNoise: false,
      }),
    /read exploded/,
  );

  storeMocks.readFile.mockRejectedValueOnce(
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  const empty = await listTradeLogs({
    hideCronNoise: false,
  });
  assert.equal(empty.totalCount, 0);
});

test("isNoisyTradeLog detects cron noise and structured JSON payloads", () => {
  assert.equal(
    isNoisyTradeLog({
      _id: "cron-noise",
      type: "cron",
      action: "signal_check_start",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    isNoisyTradeLog({
      _id: "json-noise",
      type: "executor",
      action: "BUY",
      details: '{"foo":"bar"}',
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    isNoisyTradeLog({
      _id: "clean",
      type: "executor",
      action: "BUY",
      details: "simple text",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    isNoisyTradeLog({
      _id: "json-array",
      type: "executor",
      action: "TRACE",
      result: '[{"status":"ok"}]',
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    isNoisyTradeLog({
      _id: "invalid-json",
      type: "executor",
      action: "BUY",
      details: "{broken}",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    false,
  );
});

test("cleanupTradeLogs removes noisy logs and rewrites file storage", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-cleanup",
  });
  storeMocks.readFile.mockResolvedValue(
    [
      JSON.stringify({
        _id: "keep-1",
        type: "executor",
        action: "BUY",
        details: "plain text",
        createdAt: "2026-01-04T00:00:00.000Z",
      }),
      JSON.stringify({
        _id: "drop-1",
        type: "cron",
        action: "signal_check_start",
        createdAt: "2026-01-04T00:05:00.000Z",
      }),
      JSON.stringify({
        _id: "drop-2",
        processId: "proc-json",
        type: "executor",
        action: "TRACE",
        details: '{"nested":true}',
        createdAt: "2026-01-04T00:10:00.000Z",
      }),
    ].join("\n"),
  );

  const result = await cleanupTradeLogs({
    mode: "noisy-json",
  });

  assert.deepEqual(result, {
    mode: "noisy-json",
    keepDays: undefined,
    scannedCount: 3,
    deletedCount: 2,
    remainingCount: 1,
    deletedFileCount: 2,
    deletedMongoCount: 0,
  });
  assert.equal(storeMocks.writeFile.mock.calls.length, 1);
  assert.equal(storeMocks.writeFile.mock.calls[0]?.[0], "/tmp/copytrade-cleanup/all.jsonl");
  assert.match(String(storeMocks.writeFile.mock.calls[0]?.[1]), /"keep-1"/);
  assert.equal(storeMocks.rm.mock.calls[0]?.[0], path.join("/tmp/copytrade-cleanup", "processes"));
});

test("cleanupTradeLogs keeps only recent days and deletes matching mongo records", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));
  setEnv({
    PROCESS_LOG_STORAGE: "dual",
    PROCESS_LOG_DIR: "/tmp/copytrade-cleanup-retention",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.readFile.mockResolvedValue(
    [
      JSON.stringify({
        _id: "file-old",
        type: "executor",
        action: "BUY",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      JSON.stringify({
        _id: "file-new",
        processId: "proc-keep",
        type: "executor",
        action: "SELL",
        createdAt: "2026-01-09T00:00:00.000Z",
      }),
    ].join("\n"),
  );
  storeMocks.tradeLogFind.mockReturnValue(
    createMongoQuery([
      {
        _id: "mongo-old",
        type: "executor",
        action: "TRACE",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        _id: "mongo-new",
        processId: "proc-keep",
        type: "executor",
        action: "TP",
        createdAt: "2026-01-09T12:00:00.000Z",
      },
    ]),
  );
  storeMocks.tradeLogDeleteMany.mockResolvedValue({ deletedCount: 1 });

  const result = await cleanupTradeLogs({
    mode: "retention",
    keepDays: 3,
  });

  assert.deepEqual(result, {
    mode: "retention",
    keepDays: 3,
    scannedCount: 4,
    deletedCount: 2,
    remainingCount: 2,
    deletedFileCount: 1,
    deletedMongoCount: 1,
  });
  assert.deepEqual(storeMocks.tradeLogDeleteMany.mock.calls[0]?.[0], {
    _id: { $in: ["mongo-old"] },
  });
  assert.equal(storeMocks.writeFile.mock.calls.length, 2);
  vi.useRealTimers();
});

test("cleanupTradeLogs validates keepDays and mongo readiness", async () => {
  await assert.rejects(
    () =>
      cleanupTradeLogs({
        mode: "retention",
        keepDays: 0,
      }),
    /keepDays must be >= 1/,
  );

  setEnv({
    PROCESS_LOG_STORAGE: "mongo",
  });
  storeMocks.readFile.mockResolvedValue("");

  await assert.rejects(
    () =>
      cleanupTradeLogs({
        mode: "noisy-json",
      }),
    /MongoDB connection is not ready/,
  );

  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_INCLUDE_MONGO_LEGACY: "false",
    PROCESS_LOG_DIR: "/tmp/copytrade-cleanup-no-mongo",
  });
  storeMocks.readFile.mockResolvedValue("");

  const noMongoResult = await cleanupTradeLogs({
    mode: "noisy-json",
  });
  assert.equal(noMongoResult.scannedCount, 0);
});

test("cleanupTradeLogs tolerates mongo legacy read failures in file mode", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-cleanup-legacy",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.readFile.mockResolvedValue(
    JSON.stringify({
      _id: "file-keep",
      type: "executor",
      action: "BUY",
      createdAt: "2026-01-09T00:00:00.000Z",
    }),
  );
  storeMocks.tradeLogFind.mockReturnValue(
    createMongoQuery(new Error("mongo cleanup read failed")),
  );
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const result = await cleanupTradeLogs({
    mode: "noisy-json",
  });

  assert.equal(result.deletedMongoCount, 0);
  assert.match(
    String(warnSpy.mock.calls[0]?.[0]),
    /Failed to read Mongo logs: mongo cleanup read failed/,
  );
});

test("cleanupTradeLogs stringifies non-Error mongo legacy read failures", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-cleanup-legacy-string",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.readFile.mockResolvedValue("");
  storeMocks.tradeLogFind.mockReturnValue(createMongoQuery("mongo cleanup exploded"));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const result = await cleanupTradeLogs({
    mode: "noisy-json",
  });

  assert.equal(result.deletedMongoCount, 0);
  assert.match(
    String(warnSpy.mock.calls[0]?.[0]),
    /Failed to read Mongo logs: mongo cleanup exploded/,
  );
});

test("remote backend mode also activates via VERCEL and reports missing backend configuration", async () => {
  setEnv({
    VERCEL: "1",
    BACKEND_URL: "https://backend.vercel.example/",
  });
  storeMocks.fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        logs: [],
        totalCount: 0,
        page: 1,
        limit: 1,
        totalPages: 0,
      },
    }),
  });

  const result = await countTradeLogs();
  assert.equal(result, 0);
  assert.equal(
    storeMocks.fetchMock.mock.calls[0]?.[0],
    "https://backend.vercel.example/api/logs?page=1&limit=1&hideCronNoise=false&order=desc",
  );
});

test("backend runtime bypasses remote proxy mode even when backend URLs are configured", async () => {
  setEnv({
    COPYTRADE_RUNTIME: "backend",
    BACKEND_URL: "https://backend.example.com",
    NEXT_RUNTIME: "nodejs",
    PROCESS_LOG_STORAGE: "file",
    PROCESS_LOG_DIR: "/tmp/copytrade-backend-runtime",
  });
  storeMocks.readFile.mockResolvedValue("");

  const result = await listTradeLogs({
    hideCronNoise: false,
  });

  assert.equal(result.totalCount, 0);
  assert.equal(storeMocks.fetchMock.mock.calls.length, 0);
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

test("remote backend mode falls back to HTTP status messages and raw payloads when needed", async () => {
  setEnv({
    NEXT_RUNTIME: "nodejs",
    NEXT_PUBLIC_BACKEND_URL: "https://backend.example.com",
  });
  storeMocks.fetchMock
    .mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        success: false,
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _id: "payload-record",
        type: "executor",
        action: "BUY",
      }),
    });

  await assert.rejects(
    () =>
      listTradeLogs({
        page: 1,
      }),
    /Remote log request failed: 502/,
  );

  const created = await createTradeLog({
    processId: "remote-payload",
    type: "executor",
    action: "BUY",
  });

  assert.deepEqual(created, {
    _id: "payload-record",
    type: "executor",
    action: "BUY",
  });
});

test("blank storage mode falls back to file mode", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "",
    PROCESS_LOG_DIR: "/tmp/copytrade-blank-storage",
  });
  storeMocks.readFile.mockResolvedValue("");

  const result = await listTradeLogs({
    hideCronNoise: false,
  });

  assert.equal(result.totalCount, 0);
  assert.equal(storeMocks.tradeLogFind.mock.calls.length, 0);
});

test("createTradeLog warns when mongo create throws a non-Error value in dual mode", async () => {
  setEnv({
    PROCESS_LOG_STORAGE: "dual",
    PROCESS_LOG_DIR: "/tmp/copytrade-dual-mongo-string",
  });
  storeMocks.mongooseConnection.readyState = 1;
  storeMocks.tradeLogCreate.mockRejectedValue("mongo exploded");
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const record = await createTradeLog({
    processId: "proc-mongo-string",
    type: "executor",
    action: "BUY",
  });

  assert.equal(record.processId, "proc-mongo-string");
  assert.equal(storeMocks.appendFile.mock.calls.length, 2);
  assert.match(
    String(warnSpy.mock.calls.at(-1)?.[0]),
    /Mongo log write failed: mongo exploded/,
  );
});
