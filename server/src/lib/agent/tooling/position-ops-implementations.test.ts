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
  resolveExchangeContext: vi.fn(),
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
  resolveExchangeContext: positionOpsMocks.resolveExchangeContext,
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

function createPositionDoc(overrides: Record<string, unknown> = {}): any {
  const doc: any = {
    _id: "pos-1",
    status: "open",
    side: "LONG",
    symbol: "BTCUSDT",
    quantity: 2,
    entryPrice: 100,
    currentPrice: 100,
    pnl: 0,
    stopLossPrice: 95,
    takeProfitTargets: [{ price: 120, quantity: 2, percentage: 100, status: "pending" }],
    save: vi.fn(),
    toObject() {
      return this;
    },
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
  positionOpsMocks.resolveExchangeContext.mockReset();
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

test("position ops exposes live protection state and mismatch details", async () => {
  const exchange = {
    getAlgoOrders: vi.fn().mockResolvedValue([
      {
        orderId: "sl-live",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "sl",
        triggerPrice: 95,
        quantity: 2,
        status: "active",
      },
      {
        orderId: "tp-live-extra",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "tp",
        triggerPrice: 130,
        quantity: 2,
        status: "active",
      },
    ]),
  };

  positionOpsMocks.findPositionRecord.mockResolvedValue({
    _id: { toString: () => "pos-prot" },
    accountId: "acc-1",
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 2,
    takeProfitTargets: [{ price: 120, quantity: 2, percentage: 100, status: "pending" }],
    stopLossPrice: 95,
  });
  positionOpsMocks.positionFindById.mockReturnValue(
    createQuery(
      createPositionDoc({
        _id: "pos-prot",
        quantity: 2,
        stopLossPrice: 95,
        takeProfitTargets: [{ price: 120, quantity: 2, percentage: 100, status: "pending" }],
      }),
    ),
  );
  positionOpsMocks.getLivePositionSnapshot.mockResolvedValue({
    exchange,
    currentPrice: 110,
    pnlPercent: 10,
    exchangePosition: { symbol: "BTCUSDT", quantity: 2 },
  });

  const result = JSON.parse(
    await positionOpsToolImplementations.get_position_protection({
      positionId: "pos-prot",
    }),
  );

  assert.equal(result.success, true);
  assert.equal(result.protection.missingLiveStopLoss, false);
  assert.equal(result.protection.missingLiveTakeProfits.length, 1);
  assert.equal(result.protection.extraLiveTakeProfitOrders.length, 1);
  assert.equal(positionOpsMocks.logProcessStep.mock.calls.at(-1)?.[0]?.action, "get_position_protection");
});

test("position ops adjusts stop loss and replaces the take-profit ladder", async () => {
  const exchange = {
    getAlgoOrders: vi.fn().mockResolvedValue([]),
    placeStopLoss: vi.fn().mockResolvedValue("new-sl"),
    placeTakeProfit: vi
      .fn()
      .mockResolvedValueOnce("tp-1")
      .mockResolvedValueOnce("tp-2"),
  };
  const positionDoc = createPositionDoc({
    _id: "pos-adjust",
    quantity: 2,
    side: "LONG",
    stopLossPrice: 95,
    takeProfitTargets: [{ price: 120, quantity: 2, percentage: 100, status: "pending" }],
  });

  positionOpsMocks.findPositionRecord.mockResolvedValue({
    _id: { toString: () => "pos-adjust" },
    accountId: "acc-1",
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 2,
    stopLossPrice: 95,
    takeProfitTargets: [{ price: 120, quantity: 2, percentage: 100, status: "pending" }],
  });
  positionOpsMocks.positionFindById.mockReturnValue(createQuery(positionDoc));
  positionOpsMocks.getLivePositionSnapshot.mockResolvedValue({
    exchange,
    currentPrice: 112,
    pnlPercent: 12,
    exchangePosition: { symbol: "BTCUSDT", quantity: 2 },
  });

  const result = JSON.parse(
    await positionOpsToolImplementations.adjust_position_protection({
      positionId: "pos-adjust",
      stopLossPrice: 100.123,
      takeProfits: [
        { price: 125, percentage: 50 },
        { price: 130, percentage: 50 },
      ],
    }),
  );

  assert.equal(result.success, true);
  assert.equal(positionDoc.stopLossPrice, 100.12);
  assert.equal(positionDoc.takeProfitTargets.length, 2);
  assert.deepEqual(positionOpsMocks.cancelAlgoOrdersByTypes.mock.calls[0], [
    exchange,
    "BTCUSDT",
    ["sl"],
  ]);
  assert.deepEqual(positionOpsMocks.cancelAlgoOrdersByTypes.mock.calls[1], [
    exchange,
    "BTCUSDT",
    ["tp"],
  ]);
  assert.deepEqual(exchange.placeStopLoss.mock.calls[0], [
    "BTCUSDT",
    100.12,
    100.12,
    "SELL",
    2,
  ]);
  assert.deepEqual(exchange.placeTakeProfit.mock.calls[0], [
    "BTCUSDT",
    125,
    125,
    "SELL",
    1,
  ]);
  assert.equal(positionOpsMocks.logProcessStep.mock.calls.at(-1)?.[0]?.action, "adjust_position_protection");
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

test("position ops cleans orphan protection orders only for symbols without tracked or live activity", async () => {
  const exchange = {
    getAlgoOrders: vi.fn().mockResolvedValue([
      {
        orderId: "algo-stale",
        symbol: "DOGEUSDT",
        side: "SELL",
        type: "tp",
        triggerPrice: 0.2,
        quantity: 1000,
        status: "NEW",
      },
      {
        orderId: "algo-active",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "sl",
        triggerPrice: 95,
        quantity: 1,
        status: "NEW",
      },
    ]),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getOpenPositions: vi.fn().mockResolvedValue([{ symbol: "BTCUSDT" }]),
    cancelAlgoOrders: vi.fn().mockResolvedValue({
      cancelled: ["algo-stale"],
      errors: [],
    }),
  };

  positionOpsMocks.resolveExchangeContext.mockResolvedValue({
    exchange,
    accountId: "acc-1",
    accountName: "VIP",
    provider: "bybit",
  });
  positionOpsMocks.positionFind.mockReturnValue(
    createQuery([{ symbol: "BTCUSDT", status: "open" }]),
  );

  const preview = JSON.parse(
    await positionOpsToolImplementations.cleanup_orphan_protection_orders({
      accountId: "acc-1",
    }),
  );
  const applied = JSON.parse(
    await positionOpsToolImplementations.cleanup_orphan_protection_orders({
      accountId: "acc-1",
      dryRun: false,
    }),
  );

  assert.equal(preview.orphanCandidates.length, 1);
  assert.equal(preview.orphanCandidates[0].symbol, "DOGEUSDT");
  assert.equal(applied.cleanupResults.length, 1);
  assert.equal(applied.cleanupResults[0].symbol, "DOGEUSDT");
  assert.equal(exchange.cancelAlgoOrders.mock.calls.length, 1);
  assert.equal(positionOpsMocks.logProcessStep.mock.calls.at(-1)?.[0]?.action, "cleanup_orphan_protection_orders");
});

test("position ops manage_position covers partial close, breakeven, trailing stop, take-profit updates, cancel orders, and validation errors", async () => {
  const exchange = {
    closePosition: vi.fn().mockResolvedValue(undefined),
    placeStopLoss: vi.fn().mockResolvedValue("sl-2"),
    placeTakeProfit: vi.fn().mockResolvedValue("tp-2"),
    getOpenOrders: vi.fn().mockResolvedValue([
      { orderId: "o-1", symbol: "BTCUSDT" },
      { orderId: "o-2", symbol: "BTCUSDT" },
    ]),
    cancelOrder: vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("already done")),
  };
  const partialDoc = createPositionDoc({
    _id: "pos-partial",
    quantity: 4,
  });
  const breakevenDoc = createPositionDoc({
    _id: "pos-be",
    quantity: 2,
    entryPrice: 101.239,
  });
  const trailingDoc = createPositionDoc({
    _id: "pos-trail",
    quantity: 2.5,
    side: "SHORT",
  });
  const moveTpExistingDoc = createPositionDoc({
    _id: "pos-tp-existing",
    quantity: 3,
    takeProfitTargets: [
      { price: 120, quantity: 3, percentage: 100, status: "pending" },
    ],
  });
  const moveTpAppendDoc = createPositionDoc({
    _id: "pos-tp-append",
    quantity: 1.5,
    takeProfitTargets: [
      { price: 120, quantity: 1.5, percentage: 100, status: "filled" },
    ],
  });
  const cancelOrdersDoc = createPositionDoc({
    _id: "pos-cancel",
    quantity: 1,
  });
  const unsupportedDoc = createPositionDoc({
    _id: "pos-unsupported",
  });

  positionOpsMocks.findPositionRecord
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-partial" },
      accountId: "acc-1",
      symbol: "BTCUSDT",
      quantity: 4,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-be" },
      accountId: "acc-1",
      symbol: "BTCUSDT",
      quantity: 2,
      side: "LONG",
      entryPrice: 101.239,
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-trail" },
      accountId: "acc-1",
      symbol: "ETHUSDT",
      quantity: 2.5,
      side: "SHORT",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-tp-existing" },
      accountId: "acc-1",
      symbol: "SOLUSDT",
      quantity: 3,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-tp-append" },
      accountId: "acc-1",
      symbol: "XRPUSDT",
      quantity: 1.5,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-cancel" },
      accountId: "acc-1",
      symbol: "ADAUSDT",
      quantity: 1,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-unsupported" },
      accountId: "acc-1",
      symbol: "DOGEUSDT",
      quantity: 1,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-missing-doc" },
      accountId: "acc-1",
      symbol: "BTCUSDT",
      quantity: 1,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-no-action" },
      accountId: "acc-1",
      symbol: "BTCUSDT",
      quantity: 1,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-no-price" },
      accountId: "acc-1",
      symbol: "BTCUSDT",
      quantity: 1,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-no-tp" },
      accountId: "acc-1",
      symbol: "BTCUSDT",
      quantity: 1,
      side: "LONG",
    })
    .mockResolvedValueOnce({
      _id: { toString: () => "pos-no-trail" },
      accountId: "acc-1",
      symbol: "BTCUSDT",
      quantity: 1,
      side: "LONG",
    });

  positionOpsMocks.positionFindById
    .mockReturnValueOnce(createQuery(partialDoc))
    .mockReturnValueOnce(createQuery(breakevenDoc))
    .mockReturnValueOnce(createQuery(trailingDoc))
    .mockReturnValueOnce(createQuery(moveTpExistingDoc))
    .mockReturnValueOnce(createQuery(moveTpAppendDoc))
    .mockReturnValueOnce(createQuery(cancelOrdersDoc))
    .mockReturnValueOnce(createQuery(unsupportedDoc))
    .mockReturnValueOnce(createQuery(null))
    .mockReturnValueOnce(createQuery(createPositionDoc({ _id: "pos-no-action" })))
    .mockReturnValueOnce(createQuery(createPositionDoc({ _id: "pos-no-price" })))
    .mockReturnValueOnce(createQuery(createPositionDoc({ _id: "pos-no-tp" })))
    .mockReturnValueOnce(createQuery(createPositionDoc({ _id: "pos-no-trail" })));

  positionOpsMocks.getLivePositionSnapshot
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 112,
      exchangePosition: { positionId: "ex-partial" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 113,
      exchangePosition: { positionId: "ex-be" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 89,
      exchangePosition: { positionId: "ex-trail" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 121,
      exchangePosition: { positionId: "ex-tp-existing" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 122,
      exchangePosition: { positionId: "ex-tp-append" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 100,
      exchangePosition: { positionId: "ex-cancel" },
    })
    .mockResolvedValueOnce({
      exchange: {
        closePosition: vi.fn().mockResolvedValue(undefined),
        placeStopLoss: vi.fn().mockResolvedValue("sl-x"),
        placeTakeProfit: vi.fn().mockResolvedValue("tp-x"),
        getOpenOrders: vi.fn().mockResolvedValue([]),
        cancelOrder: vi.fn().mockResolvedValue(true),
      },
      currentPrice: 100,
      exchangePosition: { positionId: "ex-unsupported" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 100,
      exchangePosition: { positionId: "ex-no-action" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 100,
      exchangePosition: { positionId: "ex-no-price" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 100,
      exchangePosition: { positionId: "ex-no-tp" },
    })
    .mockResolvedValueOnce({
      exchange,
      currentPrice: 100,
      exchangePosition: { positionId: "ex-no-trail" },
    });

  const partial = JSON.parse(
    await positionOpsToolImplementations.manage_position({
      positionId: "pos-partial",
      action: "partial_close",
      quantity: 1.5,
    }),
  );
  const breakeven = JSON.parse(
    await positionOpsToolImplementations.manage_position({
      positionId: "pos-be",
      action: "move_stop_loss_to_breakeven",
    }),
  );
  const trailing = JSON.parse(
    await positionOpsToolImplementations.manage_position({
      positionId: "pos-trail",
      action: "trail_stop",
      newPrice: 88.888,
    }),
  );
  const movedTpExisting = JSON.parse(
    await positionOpsToolImplementations.manage_position({
      positionId: "pos-tp-existing",
      action: "move_take_profit",
      newPrice: 130.126,
    }),
  );
  const movedTpAppend = JSON.parse(
    await positionOpsToolImplementations.manage_position({
      positionId: "pos-tp-append",
      action: "move_take_profit",
      newPrice: 140.555,
    }),
  );
  const cancelled = JSON.parse(
    await positionOpsToolImplementations.manage_position({
      positionId: "pos-cancel",
      action: "cancel_all_orders",
    }),
  );

  assert.equal(partial.closedQuantity, 1.5);
  assert.equal(partial.remainingQuantity, 2.5);
  assert.equal(partialDoc.quantity, 2.5);
  assert.equal(breakeven.stopLossPrice, 101.24);
  assert.equal(trailing.stopLossPrice, 88.89);
  assert.equal(exchange.placeStopLoss.mock.calls[1][3], "BUY");
  assert.equal(movedTpExisting.takeProfitPrice, 130.13);
  assert.equal(moveTpExistingDoc.takeProfitTargets[0].price, 130.13);
  assert.equal(movedTpAppend.takeProfitPrice, 140.56);
  assert.equal(moveTpAppendDoc.takeProfitTargets.length, 2);
  assert.equal(cancelled.cancelled, 1);
  assert.equal(cancelled.failed, 1);
  assert.equal(cancelled.results[1].error, "already done");

  await assert.rejects(
    () =>
      positionOpsToolImplementations.manage_position({
        positionId: "pos-unsupported",
        action: "unsupported",
      }),
    /Unsupported manage_position action/,
  );
  await assert.rejects(
    () =>
      positionOpsToolImplementations.manage_position({
        positionId: "pos-missing-doc",
        action: "close",
      }),
    /Position document not found/,
  );
  await assert.rejects(
    () =>
      positionOpsToolImplementations.manage_position({
        positionId: "pos-no-action",
      }),
    /manage_position requires an action/,
  );
  await assert.rejects(
    () =>
      positionOpsToolImplementations.manage_position({
        positionId: "pos-no-price",
        action: "move_stop_loss",
      }),
    /move_stop_loss requires newPrice/,
  );
  await assert.rejects(
    () =>
      positionOpsToolImplementations.manage_position({
        positionId: "pos-no-tp",
        action: "move_take_profit",
      }),
    /move_take_profit requires newPrice/,
  );
  await assert.rejects(
    () =>
      positionOpsToolImplementations.manage_position({
        positionId: "pos-no-trail",
        action: "trail_stop",
      }),
    /trail_stop requires newPrice/,
  );
});

test("position ops review_signal_thread falls back across anchors and handles position-based lookups", async () => {
  positionOpsMocks.parseOptionalString.mockImplementation((value) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined,
  );

  positionOpsMocks.positionFindById
    .mockReturnValueOnce(createQuery(null))
    .mockReturnValueOnce(
      createQuery({
        _id: { toString: () => "pos-2" },
        accountId: "acc-2",
        messageId: "msg-3",
        channelId: "chan-3",
        processId: null,
      }),
    );
  positionOpsMocks.processedMessageFind
    .mockReturnValueOnce(createQuery([{ processId: "proc-from-processed", messageId: "msg-2" }]))
    .mockReturnValueOnce(createQuery([]));
  positionOpsMocks.draftTradeFind
    .mockReturnValueOnce(createQuery([{ processId: "proc-from-draft", messageId: "msg-2" }]))
    .mockReturnValueOnce(createQuery([]));
  positionOpsMocks.positionFind
    .mockReturnValueOnce(createQuery([]))
    .mockReturnValueOnce(createQuery([{ _id: "linked-1" }]));
  positionOpsMocks.getProcessTradeLogs
    .mockResolvedValueOnce([{ action: "proc-log" }])
    .mockResolvedValueOnce([]);

  const byMessage = JSON.parse(
    await positionOpsToolImplementations.review_signal_thread({
      messageId: "msg-2",
      accountId: "acc-1",
      limit: 500,
      processId: "proc-explicit",
    }),
  );
  const discordFailure = JSON.parse(
    await positionOpsToolImplementations.review_signal_thread({
      positionId: "pos-2",
      limit: -1,
    }),
  );

  assert.equal(byMessage.anchor.processId, "proc-explicit");
  assert.deepEqual(byMessage.sourceContextMessages, []);
  assert.equal(discordFailure.anchor.processId, null);
  assert.deepEqual(discordFailure.sourceContextMessages, []);
  assert.equal(discordFailure.linkedPositions.length, 0);
});
