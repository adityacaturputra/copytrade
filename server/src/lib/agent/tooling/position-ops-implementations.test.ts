import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const positionOpsMocks = vi.hoisted(() => ({
  accountFindById: vi.fn(),
  draftTradeFind: vi.fn(),
  positionFind: vi.fn(),
  positionFindById: vi.fn(),
  processedMessageFind: vi.fn(),
  getAnalyzer: vi.fn(),
  buildPositionAnalysisInput: vi.fn(),
  logProcessStep: vi.fn(),
  ensurePersistedProcessId: vi.fn(),
  getResolvedProcessId: vi.fn(),
  getProcessTradeLogs: vi.fn(),
  cancelAlgoOrdersByTypes: vi.fn(),
  findPositionRecord: vi.fn(),
  getAccountIdFromArgs: vi.fn(),
  getLivePositionSnapshot: vi.fn(),
  getSourceContextForAccount: vi.fn(),
  normalizePositiveNumber: vi.fn(),
  normalizeSortOrder: vi.fn(),
  normalizeSourceType: vi.fn(),
  parseOptionalString: vi.fn(),
  roundPrice: vi.fn(),
  serializeSourceMessages: vi.fn(),
  toClosingSide: vi.fn(),
  fetchMessageContext: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/database", () => ({
  Account: {
    findById: positionOpsMocks.accountFindById,
  },
  DraftTrade: {
    find: positionOpsMocks.draftTradeFind,
  },
  Position: {
    find: positionOpsMocks.positionFind,
    findById: positionOpsMocks.positionFindById,
  },
  ProcessedMessage: {
    find: positionOpsMocks.processedMessageFind,
  },
}));

vi.mock("@copytrade/shared/lib/ai/AIFactory", () => ({
  AIFactory: {
    getAnalyzer: positionOpsMocks.getAnalyzer,
  },
}));

vi.mock("@copytrade/shared/lib/ai/PositionMonitorContext", () => ({
  buildPositionAnalysisInput: positionOpsMocks.buildPositionAnalysisInput,
}));

vi.mock("@copytrade/shared/lib/process-log", () => ({
  logProcessStep: positionOpsMocks.logProcessStep,
}));

vi.mock("@copytrade/shared/lib/process-id", () => ({
  ensurePersistedProcessId: positionOpsMocks.ensurePersistedProcessId,
  getResolvedProcessId: positionOpsMocks.getResolvedProcessId,
}));

vi.mock("@copytrade/shared/lib/source/DiscordSourceProvider", () => ({
  DiscordSourceProvider: class {
    fetchMessageContext = positionOpsMocks.fetchMessageContext;
  },
}));

vi.mock("@copytrade/shared/lib/trade-log-store", () => ({
  getProcessTradeLogs: positionOpsMocks.getProcessTradeLogs,
}));

vi.mock("./shared", () => ({
  cancelAlgoOrdersByTypes: positionOpsMocks.cancelAlgoOrdersByTypes,
  findPositionRecord: positionOpsMocks.findPositionRecord,
  getAccountIdFromArgs: positionOpsMocks.getAccountIdFromArgs,
  getLivePositionSnapshot: positionOpsMocks.getLivePositionSnapshot,
  getSourceContextForAccount: positionOpsMocks.getSourceContextForAccount,
  normalizePositiveNumber: positionOpsMocks.normalizePositiveNumber,
  normalizeSortOrder: positionOpsMocks.normalizeSortOrder,
  normalizeSourceType: positionOpsMocks.normalizeSourceType,
  parseOptionalString: positionOpsMocks.parseOptionalString,
  roundPrice: positionOpsMocks.roundPrice,
  serializeSourceMessages: positionOpsMocks.serializeSourceMessages,
  toClosingSide: positionOpsMocks.toClosingSide,
}));

import { positionOpsToolImplementations } from "./position-ops-implementations";

function createQuery(result: unknown) {
  const sort = vi.fn();
  const limit = vi.fn();
  const lean = vi.fn();
  const exec = vi.fn();
  const query = { sort, limit, lean, exec };
  sort.mockReturnValue(query);
  limit.mockReturnValue(query);
  lean.mockReturnValue(query);
  exec.mockResolvedValue(result);
  return query;
}

function createPositionDoc(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = {
    _id: "pos-1",
    status: "open",
    quantity: 2,
    entryPrice: 100,
    currentPrice: 100,
    pnl: 0,
    stopLossPrice: 95,
    takeProfitTargets: [{ price: 120, quantity: 2, percentage: 100, status: "pending" }],
    save: vi.fn(),
  };
  Object.assign(doc, overrides);
  doc.save.mockResolvedValue(doc);
  return doc;
}

beforeEach(() => {
  positionOpsMocks.accountFindById.mockReset();
  positionOpsMocks.draftTradeFind.mockReset();
  positionOpsMocks.positionFind.mockReset();
  positionOpsMocks.positionFindById.mockReset();
  positionOpsMocks.processedMessageFind.mockReset();
  positionOpsMocks.getAnalyzer.mockReset();
  positionOpsMocks.buildPositionAnalysisInput.mockReset();
  positionOpsMocks.logProcessStep.mockReset();
  positionOpsMocks.ensurePersistedProcessId.mockReset();
  positionOpsMocks.getResolvedProcessId.mockReset();
  positionOpsMocks.getProcessTradeLogs.mockReset();
  positionOpsMocks.cancelAlgoOrdersByTypes.mockReset();
  positionOpsMocks.findPositionRecord.mockReset();
  positionOpsMocks.getAccountIdFromArgs.mockReset();
  positionOpsMocks.getLivePositionSnapshot.mockReset();
  positionOpsMocks.getSourceContextForAccount.mockReset();
  positionOpsMocks.normalizePositiveNumber.mockReset();
  positionOpsMocks.normalizeSortOrder.mockReset();
  positionOpsMocks.normalizeSourceType.mockReset();
  positionOpsMocks.parseOptionalString.mockReset();
  positionOpsMocks.roundPrice.mockReset();
  positionOpsMocks.serializeSourceMessages.mockReset();
  positionOpsMocks.toClosingSide.mockReset();
  positionOpsMocks.fetchMessageContext.mockReset();

  positionOpsMocks.logProcessStep.mockResolvedValue(undefined);
  positionOpsMocks.ensurePersistedProcessId.mockResolvedValue("proc-persisted");
  positionOpsMocks.getResolvedProcessId.mockReturnValue("proc-resolved");
  positionOpsMocks.getAccountIdFromArgs.mockImplementation((args) => args.accountId);
  positionOpsMocks.normalizePositiveNumber.mockImplementation(
    (value, fallback, max) => {
      if (typeof value !== "number" || value <= 0) return fallback;
      return typeof max === "number" ? Math.min(value, max) : value;
    },
  );
  positionOpsMocks.normalizeSortOrder.mockImplementation((value) =>
    value === "asc" ? "asc" : "desc",
  );
  positionOpsMocks.normalizeSourceType.mockImplementation((value) =>
    typeof value === "string" ? value : null,
  );
  positionOpsMocks.parseOptionalString.mockImplementation((value) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined,
  );
  positionOpsMocks.roundPrice.mockImplementation((value: number) =>
    Math.round(value * 100) / 100,
  );
  positionOpsMocks.serializeSourceMessages.mockImplementation((messages) => messages);
  positionOpsMocks.toClosingSide.mockImplementation((side) =>
    side === "LONG" ? "SELL" : "BUY",
  );
});

test("position ops analyzes position context and returns AI input plus live snapshot", async () => {
  const analyzer = {
    analyzePosition: vi.fn().mockResolvedValue({
      decision: "MOVE_SL",
      confidence: 91,
    }),
  };
  positionOpsMocks.findPositionRecord.mockResolvedValue({
    _id: { toString: () => "pos-1" },
    accountId: "acc-1",
    processId: "proc-old",
    symbol: "BTCUSDT",
  });
  positionOpsMocks.positionFindById.mockReturnValue(
    createQuery(createPositionDoc()),
  );
  positionOpsMocks.getLivePositionSnapshot.mockResolvedValue({
    currentPrice: 111,
    pnlPercent: 10,
    exchangePosition: { symbol: "BTCUSDT" },
  });
  positionOpsMocks.buildPositionAnalysisInput.mockResolvedValue({
    symbol: "BTCUSDT",
  });
  positionOpsMocks.getAnalyzer.mockReturnValue(analyzer);

  const result = JSON.parse(
    await positionOpsToolImplementations.analyze_position_context({
      positionId: "pos-1",
    }),
  );

  assert.equal(result.success, true);
  assert.equal(result.processId, "proc-persisted");
  assert.equal(result.analysis.decision, "MOVE_SL");
  assert.equal(positionOpsMocks.logProcessStep.mock.calls[0][0].action, "analyze_position_context");
});

test("position ops manage_position supports close and stop-loss updates", async () => {
  const exchange = {
    closePosition: vi.fn().mockResolvedValue(undefined),
    placeStopLoss: vi.fn().mockResolvedValue("sl-1"),
  };
  const closeDoc = createPositionDoc({
    _id: "pos-close",
    quantity: 2,
  });
  const slDoc = createPositionDoc({
    _id: "pos-sl",
    quantity: 3,
    entryPrice: 100,
  });
  positionOpsMocks.findPositionRecord
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-close" },
      accountId: "acc-1",
      symbol: "BTCUSDT",
      quantity: 2,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-sl" },
      accountId: "acc-1",
      symbol: "ETHUSDT",
      quantity: 3,
      side: "SHORT",
      entryPrice: 100,
    });
  positionOpsMocks.positionFindById
    .mockReturnValueOnce(createQuery(closeDoc))
    .mockReturnValueOnce(createQuery(slDoc));
  positionOpsMocks.getLivePositionSnapshot
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 111,
      exchangePosition: { positionId: "ex-1" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 95,
      exchangePosition: { positionId: "ex-2" },
    });

  const closed = JSON.parse(
    await positionOpsToolImplementations.manage_position({
      positionId: "pos-close",
      action: "close",
    }),
  );
  const moved = JSON.parse(
    await positionOpsToolImplementations.manage_position({
      positionId: "pos-sl",
      action: "move_stop_loss",
      newPrice: 90.129,
    }),
  );

  assert.equal(closed.status, "closed");
  assert.equal(closeDoc.status, "closed");
  assert.equal(moved.stopLossPrice, 90.13);
  assert.deepEqual(positionOpsMocks.cancelAlgoOrdersByTypes.mock.calls[0], [
    exchange,
    "ETHUSDT",
    ["sl"],
  ]);
  assert.deepEqual(exchange.placeStopLoss.mock.calls[0], [
    "ETHUSDT",
    90.13,
    90.13,
    "BUY",
    3,
  ]);
});

test("position ops reviews signal threads, fetches discord context, and exposes process logs", async () => {
  const position = {
    _id: { toString: () => "pos-1" },
    accountId: "acc-1",
    processId: "proc-1",
    messageId: "msg-1",
    channelId: "chan-1",
    symbol: "BTCUSDT",
  };
  positionOpsMocks.parseOptionalString.mockImplementation((value) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined,
  );
  positionOpsMocks.positionFindById.mockReturnValue(createQuery(position));
  positionOpsMocks.processedMessageFind.mockReturnValue(
    createQuery([{ processId: "proc-1", messageId: "msg-1" }]),
  );
  positionOpsMocks.draftTradeFind.mockReturnValue(
    createQuery([{ processId: "proc-1", messageId: "msg-1" }]),
  );
  positionOpsMocks.positionFind.mockReturnValue(
    createQuery([position]),
  );
  positionOpsMocks.getProcessTradeLogs.mockResolvedValue([{ action: "x" }]);
  positionOpsMocks.accountFindById.mockReturnValue(
    createQuery({ _id: "acc-1", name: "VIP", sourceType: "discord" }),
  );
  positionOpsMocks.getSourceContextForAccount.mockReturnValue({
    config: { _id: "acc-1" },
  });
  positionOpsMocks.fetchMessageContext.mockResolvedValue([{ messageId: "ctx-1" }]);

  const result = JSON.parse(
    await positionOpsToolImplementations.review_signal_thread({
      positionId: "pos-1",
      limit: 10,
    }),
  );

  assert.equal(result.success, true);
  assert.equal(result.anchor.processId, "proc-1");
  assert.deepEqual(result.sourceContextMessages, [{ messageId: "ctx-1" }]);
  assert.deepEqual(result.processLogs, [{ action: "x" }]);
});

test("position ops get_process_logs validates process id and syncs positions with exchange state", async () => {
  const position = {
    _id: { toString: () => "pos-1" },
    accountId: "acc-1",
    symbol: "BTCUSDT",
  };
  const openDoc = createPositionDoc({
    _id: "pos-1",
    quantity: 1,
    takeProfitTargets: [{ price: 120, quantity: 1, percentage: 100, status: "pending" }],
  });
  const closedDoc = createPositionDoc({
    _id: "pos-2",
    quantity: 1,
  });

  await assert.rejects(
    () => positionOpsToolImplementations.get_process_logs({}),
    /get_process_logs requires processId/,
  );

  positionOpsMocks.getProcessTradeLogs.mockResolvedValue([{ action: "log" }]);
  const logs = JSON.parse(
    await positionOpsToolImplementations.get_process_logs({
      processId: "proc-1",
      limit: 999,
      order: "asc",
    }),
  );
  assert.equal(logs.count, 1);
  assert.equal(logs.order, "asc");

  positionOpsMocks.findPositionRecord
    .mockResolvedValueOnce(position)
    .mockResolvedValueOnce({ ...position, _id: { toString: () => "pos-2" } });
  positionOpsMocks.positionFindById
    .mockReturnValueOnce(createQuery(openDoc))
    .mockReturnValueOnce(createQuery(closedDoc));
  positionOpsMocks.getLivePositionSnapshot
    .mockResolvedValueOnce({
      exchange: {
        getOpenOrders: vi.fn().mockResolvedValue([{ orderId: "o1" }]),
        getAlgoOrders: vi.fn().mockResolvedValue([{ orderId: "a1" }]),
      },
      currentPrice: 115,
      pnlPercent: 15,
      exchangePosition: {
        symbol: "BTCUSDT",
        side: "LONG",
        entryPrice: 100,
        quantity: 1.5,
        leverage: 10,
        markPrice: 115,
        unrealizedPnl: 15,
        liquidationPrice: 80,
      },
    })
    .mockResolvedValueOnce({
      exchange: {
        getOpenOrders: vi.fn().mockResolvedValue([]),
        getAlgoOrders: vi.fn().mockResolvedValue([]),
      },
      currentPrice: 90,
      pnlPercent: -10,
      exchangePosition: null,
    });

  const syncedOpen = JSON.parse(
    await positionOpsToolImplementations.sync_position_with_exchange({
      positionId: "pos-1",
    }),
  );
  const syncedClosed = JSON.parse(
    await positionOpsToolImplementations.sync_position_with_exchange({
      positionId: "pos-2",
    }),
  );

  assert.equal(syncedOpen.syncedStatus, "open");
  assert.equal(openDoc.quantity, 1.5);
  assert.equal(syncedClosed.syncedStatus, "closed");
  assert.equal(closedDoc.status, "closed");
  assert.equal(positionOpsMocks.logProcessStep.mock.calls.at(-1)?.[0]?.action, "sync_position_with_exchange");
});
