import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const executorMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  processedMessageFind: vi.fn(),
  processedMessageInsertMany: vi.fn(),
  processedMessageUpdateOne: vi.fn(),
  positionFind: vi.fn(),
  positionFindOne: vi.fn(),
  positionCountDocuments: vi.fn(),
  positionCreate: vi.fn(),
  accountFind: vi.fn(),
  accountFindById: vi.fn(),
  accountFindByIdAndUpdate: vi.fn(),
  getTradingMode: vi.fn(),
  buildTPTargets: vi.fn(),
  recalculateTPAllocation: vi.fn(),
  sourceGetProvider: vi.fn(),
  getClientForAccount: vi.fn(),
  getPaperClient: vi.fn(),
  buildExchangeCredentials: vi.fn(),
  calculateRiskBasedPosition: vi.fn(),
  getRiskConfig: vi.fn(),
  resolveEffectiveRiskConfig: vi.fn(),
  getSignalConfig: vi.fn(),
  createTradeProcessId: vi.fn(),
  logExecutorError: vi.fn(),
  logExecutorInfo: vi.fn(),
  logExecutorWarn: vi.fn(),
  logProcessStep: vi.fn(),
  analyzeMessagesWithAI: vi.fn(),
  draftFind: vi.fn(),
  draftFindOne: vi.fn(),
  createDraft: vi.fn(),
  refreshDraftFromSignal: vi.fn(),
  rejectDraftWithReason: vi.fn(),
  resolveDraftWithExecution: vi.fn(),
  autoCalculateTPFromRR: vi.fn(),
  autoCalculateSLFromRR: vi.fn(),
  sanitizeLeverage: vi.fn(),
}));

vi.mock("./database", () => ({
  connectDB: executorMocks.connectDB,
  ProcessedMessage: {
    find: executorMocks.processedMessageFind,
    insertMany: executorMocks.processedMessageInsertMany,
    updateOne: executorMocks.processedMessageUpdateOne,
  },
  Position: {
    find: executorMocks.positionFind,
    findOne: executorMocks.positionFindOne,
    countDocuments: executorMocks.positionCountDocuments,
    create: executorMocks.positionCreate,
  },
  DraftTrade: {
    find: executorMocks.draftFind,
    findOne: executorMocks.draftFindOne,
  },
  Account: {
    find: executorMocks.accountFind,
    findById: executorMocks.accountFindById,
    findByIdAndUpdate: executorMocks.accountFindByIdAndUpdate,
  },
  getTradingMode: executorMocks.getTradingMode,
  buildTPTargets: executorMocks.buildTPTargets,
  recalculateTPAllocation: executorMocks.recalculateTPAllocation,
}));

vi.mock("./source/SourceFactory", () => ({
  SourceFactory: {
    getProvider: executorMocks.sourceGetProvider,
  },
}));

vi.mock("./exchange/ExchangeFactory", () => ({
  ExchangeFactory: {
    getClientForAccount: executorMocks.getClientForAccount,
    getPaperClient: executorMocks.getPaperClient,
  },
  buildExchangeCredentials: executorMocks.buildExchangeCredentials,
}));

vi.mock("./risk", () => ({
  calculateRiskBasedPosition: executorMocks.calculateRiskBasedPosition,
  getRiskConfig: executorMocks.getRiskConfig,
  resolveEffectiveRiskConfig: executorMocks.resolveEffectiveRiskConfig,
}));

vi.mock("./signal-config", () => ({
  getSignalConfig: executorMocks.getSignalConfig,
}));

vi.mock("./process-log", () => ({
  createTradeProcessId: executorMocks.createTradeProcessId,
  logExecutorError: executorMocks.logExecutorError,
  logExecutorInfo: executorMocks.logExecutorInfo,
  logExecutorWarn: executorMocks.logExecutorWarn,
  logProcessStep: executorMocks.logProcessStep,
}));

vi.mock("./executor-ai", () => ({
  analyzeMessagesWithAI: executorMocks.analyzeMessagesWithAI,
}));

vi.mock("./executor-drafts", () => ({
  createDraft: executorMocks.createDraft,
  refreshDraftFromSignal: executorMocks.refreshDraftFromSignal,
  rejectDraftWithReason: executorMocks.rejectDraftWithReason,
  resolveDraftWithExecution: executorMocks.resolveDraftWithExecution,
  summarizeExecutionForDraft: vi.fn(),
}));

vi.mock("./executor-signal-utils", () => ({
  autoCalculateTPFromRR: executorMocks.autoCalculateTPFromRR,
  autoCalculateSLFromRR: executorMocks.autoCalculateSLFromRR,
  sanitizeLeverage: executorMocks.sanitizeLeverage,
}));

import {
  checkDuplicatePosition,
  executeTrade,
  executeSignal,
  runSignalCheck,
  splitQuantityForTPs,
} from "./executor";

function mockLean<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

function mockSortedLean<T>(value: T) {
  return {
    sort: vi.fn().mockReturnValue(mockLean(value)),
  };
}

function createDoc(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = {
    _id: { toString: () => "pos-1" },
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 1,
    entryPrice: 100,
    stopLossPrice: 95,
    takeProfitTargets: [{ price: 110, status: "pending", quantity: 1, percentage: 100 }],
    status: "open",
    channelId: "chan-1",
    accountId: "acc-1",
    orderId: "ord-1",
    save: vi.fn(),
  };
  Object.assign(doc, overrides);
  doc.save.mockResolvedValue(doc);
  return doc;
}

beforeEach(() => {
  executorMocks.connectDB.mockReset();
  executorMocks.processedMessageFind.mockReset();
  executorMocks.processedMessageInsertMany.mockReset();
  executorMocks.processedMessageUpdateOne.mockReset();
  executorMocks.positionFind.mockReset();
  executorMocks.positionFindOne.mockReset();
  executorMocks.positionCountDocuments.mockReset();
  executorMocks.positionCreate.mockReset();
  executorMocks.accountFind.mockReset();
  executorMocks.accountFindById.mockReset();
  executorMocks.accountFindByIdAndUpdate.mockReset();
  executorMocks.getTradingMode.mockReset();
  executorMocks.buildTPTargets.mockReset();
  executorMocks.recalculateTPAllocation.mockReset();
  executorMocks.sourceGetProvider.mockReset();
  executorMocks.getClientForAccount.mockReset();
  executorMocks.getPaperClient.mockReset();
  executorMocks.buildExchangeCredentials.mockReset();
  executorMocks.calculateRiskBasedPosition.mockReset();
  executorMocks.getRiskConfig.mockReset();
  executorMocks.resolveEffectiveRiskConfig.mockReset();
  executorMocks.getSignalConfig.mockReset();
  executorMocks.createTradeProcessId.mockReset();
  executorMocks.logExecutorError.mockReset();
  executorMocks.logExecutorInfo.mockReset();
  executorMocks.logExecutorWarn.mockReset();
  executorMocks.logProcessStep.mockReset();
  executorMocks.analyzeMessagesWithAI.mockReset();
  executorMocks.draftFind.mockReset();
  executorMocks.draftFindOne.mockReset();
  executorMocks.createDraft.mockReset();
  executorMocks.refreshDraftFromSignal.mockReset();
  executorMocks.rejectDraftWithReason.mockReset();
  executorMocks.resolveDraftWithExecution.mockReset();
  executorMocks.autoCalculateTPFromRR.mockReset();
  executorMocks.autoCalculateSLFromRR.mockReset();
  executorMocks.sanitizeLeverage.mockReset();

  executorMocks.logExecutorInfo.mockResolvedValue(undefined);
  executorMocks.logExecutorWarn.mockResolvedValue(undefined);
  executorMocks.logExecutorError.mockResolvedValue(undefined);
  executorMocks.logProcessStep.mockResolvedValue(undefined);
  executorMocks.connectDB.mockResolvedValue(undefined);
  executorMocks.processedMessageInsertMany.mockResolvedValue(undefined);
  executorMocks.processedMessageUpdateOne.mockResolvedValue(undefined);
  executorMocks.accountFindByIdAndUpdate.mockResolvedValue(undefined);
  executorMocks.draftFind.mockResolvedValue([]);
  executorMocks.draftFindOne.mockResolvedValue(null);
  executorMocks.resolveEffectiveRiskConfig.mockResolvedValue({
    defaultLeverage: 10,
    defaultPositionSize: 1,
    defaultRR: 2,
    maxPositions: 0,
    skipNoSL: false,
  });
  executorMocks.sanitizeLeverage.mockImplementation((value) => {
    if (typeof value === "number") return value;
    return null;
  });
  executorMocks.buildTPTargets.mockImplementation((targets: number[], quantity: number) =>
    targets.map((price) => ({ price, quantity, percentage: 100, status: "pending" })),
  );
  executorMocks.recalculateTPAllocation.mockImplementation((targets) => targets);
  executorMocks.autoCalculateTPFromRR.mockReturnValue([120, 130]);
  executorMocks.autoCalculateSLFromRR.mockReturnValue(95);
});

test("splitQuantityForTPs handles trivial cases, lot-size rounding, and spec fallback", async () => {
  assert.deepEqual(await splitQuantityForTPs(1, 0, async () => ({ lotSz: 1, qtyDecimals: 0 })), []);
  assert.deepEqual(await splitQuantityForTPs(1.5, 1, async () => ({ lotSz: 1, qtyDecimals: 0 })), [1.5]);

  const rounded = await splitQuantityForTPs(
    1.234,
    3,
    async () => ({ lotSz: 0.1, qtyDecimals: 2 }),
  );
  const fallback = await splitQuantityForTPs(
    0.1234,
    2,
    async () => {
      throw new Error("specs unavailable");
    },
  );

  assert.deepEqual(rounded, [0.4, 0.4, 0.43]);
  assert.deepEqual(fallback, [0, 0.1234]);
});

test("checkDuplicatePosition returns new, exact duplicate, updated, and no-update outcomes", async () => {
  executorMocks.positionFindOne.mockResolvedValueOnce(null);
  assert.deepEqual(
    await checkDuplicatePosition("BTCUSDT", "LONG", "chan-1", 100, [110], 95),
    { type: "new" },
  );

  executorMocks.positionFindOne.mockResolvedValueOnce(
    createDoc({ entryPrice: 100, stopLossPrice: 95, takeProfitTargets: [{ price: 110 }] }),
  );
  assert.deepEqual(
    await checkDuplicatePosition("BTCUSDT", "LONG", "chan-1", 100, [110], 95),
    { type: "duplicate_exact" },
  );

  const updatedDoc = createDoc({ quantity: 2 });
  executorMocks.positionFindOne.mockResolvedValueOnce(updatedDoc);
  assert.deepEqual(
    await checkDuplicatePosition("BTCUSDT", "LONG", "chan-1", 100, [120], 90),
    { type: "duplicate_updated", updates: ["TP: 110 → 120", "SL: 95 → 90"] },
  );
  assert.equal(updatedDoc.save.mock.calls.length, 1);

  executorMocks.positionFindOne.mockResolvedValueOnce(
    createDoc({ takeProfitTargets: [{ price: 110 }], stopLossPrice: 95 }),
  );
  assert.deepEqual(
    await checkDuplicatePosition("BTCUSDT", "LONG", "chan-1", null, [], null),
    { type: "duplicate_no_update" },
  );
});

test("checkDuplicatePosition treats different entry prices as a new signal", async () => {
  executorMocks.positionFindOne.mockResolvedValueOnce(
    createDoc({ entryPrice: 100, stopLossPrice: 95, takeProfitTargets: [{ price: 110 }] }),
  );

  assert.deepEqual(
    await checkDuplicatePosition("BTCUSDT", "LONG", "chan-1", 105, [110], 95),
    { type: "new" },
  );
});

test("executeSignal skips BUY/SELL when max positions are reached", async () => {
  executorMocks.resolveEffectiveRiskConfig.mockResolvedValue({
    defaultLeverage: 10,
    defaultPositionSize: 1,
    defaultRR: 2,
    maxPositions: 2,
    skipNoSL: false,
  });
  executorMocks.positionCountDocuments.mockResolvedValue(2);

  const result = await executeSignal(
    { action: "BUY", symbol: "BTCUSDT" } as never,
    "msg-1",
    "chan-1",
    undefined,
    "acc-1",
    "proc-1",
  );

  assert.deepEqual(result, {
    type: "skipped",
    code: "max_positions",
    reason: "Trade skipped: 2 open positions, max is 2",
  });
});

test("executeSignal handles duplicate exact, duplicate update, and duplicate no-update branches", async () => {
  executorMocks.positionFindOne
    .mockResolvedValueOnce(
      createDoc({ entryPrice: 100, stopLossPrice: 95, takeProfitTargets: [{ price: 110 }] }),
    )
    .mockResolvedValueOnce(createDoc({ quantity: 2 }))
    .mockResolvedValueOnce(createDoc({ takeProfitTargets: [{ price: 110 }], stopLossPrice: 95 }));

  const exact = await executeSignal(
    {
      action: "BUY",
      symbol: "BTCUSDT",
      entryPrice: 100,
      takeProfitTargets: [110],
      stopLoss: 95,
    } as never,
    "msg-1",
    "chan-1",
    undefined,
    "acc-1",
    "proc-1",
  );
  const updated = await executeSignal(
    {
      action: "BUY",
      symbol: "BTCUSDT",
      entryPrice: 100,
      takeProfitTargets: [120],
      stopLoss: 90,
    } as never,
    "msg-2",
    "chan-1",
    undefined,
    "acc-1",
    "proc-2",
  );
  const noUpdate = await executeSignal(
    {
      action: "BUY",
      symbol: "BTCUSDT",
      entryPrice: null as never,
      takeProfitTargets: [],
      stopLoss: null as never,
    } as never,
    "msg-3",
    "chan-1",
    undefined,
    "acc-1",
    "proc-3",
  );

  assert.deepEqual(exact, {
    type: "skipped",
    code: "duplicate_exact",
    reason: "Exact duplicate: open LONG position exists with same entry=100, TP=110, SL=95",
  });
  assert.deepEqual(updated, {
    type: "updated",
    code: "updated_tp_sl",
    details: "TP: 110 → 120, SL: 95 → 90",
  });
  assert.deepEqual(noUpdate, {
    type: "skipped",
    code: "duplicate_no_update",
    reason: "Open LONG position exists with same entry but no valid TP/SL update provided",
  });
});

test("executeSignal skips trades without stop loss when skipNoSL is enabled", async () => {
  executorMocks.resolveEffectiveRiskConfig.mockResolvedValue({
    defaultLeverage: 10,
    defaultPositionSize: 1,
    defaultRR: 2,
    maxPositions: 0,
    skipNoSL: true,
  });
  executorMocks.positionFindOne.mockResolvedValue(null);

  const result = await executeSignal(
    { action: "BUY", symbol: "ETHUSDT" } as never,
    "msg-1",
    "chan-1",
    undefined,
    "acc-1",
    "proc-1",
  );

  assert.deepEqual(result, {
    type: "skipped",
    code: "no_stop_loss",
    reason: "Trade skipped: no stop loss provided and skipNoSL is enabled",
  });
});

test("executeSignal opens a new trade and auto-calculates stop loss from RR when needed", async () => {
  const exchange = {
    name: "paper",
    getAccountInfo: vi
      .fn()
      .mockResolvedValue({ availableBalance: 1000, totalBalance: 1000 }),
    setLeverage: vi.fn().mockResolvedValue(10),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "open-1",
      price: 100,
      quantity: 1,
    }),
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 0.01, qtyDecimals: 2 }),
    placeTakeProfit: vi.fn().mockResolvedValue("tp-1"),
    placeStopLoss: vi.fn().mockResolvedValue("sl-1"),
  };
  executorMocks.positionFindOne.mockResolvedValue(null);
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: false,
    skipReason: "kept requested sizing",
  });
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "new-pos" },
    side: payload.side,
    ...payload,
  }));

  const result = await executeSignal(
    {
      action: "BUY",
      symbol: "BTCUSDT",
      entryPrice: 100,
      takeProfitTargets: [120],
      defaultRR: 2,
    } as never,
    "msg-open",
    "chan-1",
    undefined,
    undefined,
    "proc-open",
  );

  assert.equal(result.type, "opened");
  assert.equal(result.position._id.toString(), "new-pos");
  assert.equal(executorMocks.autoCalculateSLFromRR.mock.calls.length, 1);
  assert.equal(exchange.placeOrder.mock.calls[0]?.[0].type, "MARKET");
});

test("executeSignal uses risk-config RR fallbacks for duplicate-entry proceed, auto-sl, and auto-tp branches", async () => {
  const exchange = {
    name: "paper",
    getAccountInfo: vi
      .fn()
      .mockResolvedValue({ availableBalance: 1000, totalBalance: 1000 }),
    setLeverage: vi.fn().mockResolvedValue(10),
    placeOrder: vi
      .fn()
      .mockResolvedValueOnce({
        orderId: "rr-open-1",
        price: 100,
        quantity: 1,
      })
      .mockResolvedValueOnce({
        orderId: "rr-open-2",
        price: 100,
        quantity: 1,
      }),
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 0.01, qtyDecimals: 2 }),
    placeTakeProfit: vi.fn().mockResolvedValue("tp-1"),
    placeStopLoss: vi.fn().mockResolvedValue("sl-1"),
  };
  executorMocks.resolveEffectiveRiskConfig.mockResolvedValue({
    defaultLeverage: 10,
    defaultPositionSize: 1,
    defaultRR: 3,
    maxPositions: 0,
    skipNoSL: false,
  });
  executorMocks.positionFindOne
    .mockResolvedValueOnce(createDoc({ entryPrice: 99, stopLossPrice: 95 }))
    .mockResolvedValueOnce(null);
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: false,
    skipReason: "kept requested sizing",
  });
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => `pos-${payload.orderId || payload.symbol}` },
    side: payload.side,
    ...payload,
  }));

  const autoSlResult = await executeSignal(
    {
      action: "BUY",
      symbol: "BTCUSDT",
      entryPrice: 100,
      takeProfitTargets: [130],
    } as never,
    "msg-auto-sl",
    "chan-1",
    undefined,
    undefined,
    "proc-auto-sl",
  );
  const autoTpResult = await executeSignal(
    {
      action: "BUY",
      symbol: "ETHUSDT",
      entryPrice: 100,
      stopLoss: 95,
      takeProfitTargets: [],
    } as never,
    "msg-auto-tp",
    "chan-1",
    undefined,
    undefined,
    "proc-auto-tp",
  );

  assert.equal(autoSlResult.type, "opened");
  assert.equal(autoTpResult.type, "opened");
  assert.deepEqual(executorMocks.autoCalculateSLFromRR.mock.calls.at(-1), [
    100,
    130,
    3,
    "LONG",
  ]);
  assert.deepEqual(executorMocks.autoCalculateTPFromRR.mock.calls.at(-1), [
    100,
    95,
    3,
    "LONG",
  ]);
  assert.ok(
    executorMocks.logExecutorInfo.mock.calls.some((call) =>
      String(call[0]).includes("proceeding as new order"),
    ),
  );
});

test("executeSignal prefers signal defaultRR over risk config when auto-calculating TP", async () => {
  const exchange = {
    name: "paper",
    getAccountInfo: vi
      .fn()
      .mockResolvedValue({ availableBalance: 1000, totalBalance: 1000 }),
    setLeverage: vi.fn().mockResolvedValue(10),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "sig-rr-open",
      price: 100,
      quantity: 1,
    }),
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 0.01, qtyDecimals: 2 }),
    placeTakeProfit: vi.fn().mockResolvedValue("tp-1"),
    placeStopLoss: vi.fn().mockResolvedValue("sl-1"),
  };
  executorMocks.resolveEffectiveRiskConfig.mockResolvedValue({
    defaultLeverage: 10,
    defaultPositionSize: 1,
    defaultRR: 2,
    maxPositions: 0,
    skipNoSL: false,
  });
  executorMocks.positionFindOne.mockResolvedValueOnce(null);
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: false,
    skipReason: "kept requested sizing",
  });
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "sig-rr-pos" },
    side: payload.side,
    ...payload,
  }));

  const result = await executeSignal(
    {
      action: "BUY",
      symbol: "XRPUSDT",
      entryPrice: 100,
      stopLoss: 96,
      takeProfitTargets: [],
      defaultRR: 4,
    } as never,
    "msg-signal-rr",
    "chan-rr",
    undefined,
    undefined,
    "proc-signal-rr",
  );

  assert.equal(result.type, "opened");
  assert.deepEqual(executorMocks.autoCalculateTPFromRR.mock.calls.at(-1), [
    100,
    96,
    4,
    "LONG",
  ]);
});

test("executeSignal closes positions or noops when none exist", async () => {
  const exchange = {
    closePosition: vi.fn().mockResolvedValue(undefined),
  };
  executorMocks.getClientForAccount.mockReturnValue(exchange);
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.buildExchangeCredentials.mockReturnValue({ provider: "bybit" });

  const closedDoc = createDoc({ symbol: "BTCUSDT", quantity: 2, orderId: "ord-1" });
  executorMocks.positionFind
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([closedDoc]);
  executorMocks.accountFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue({ tradingPlatform: "bybit", exchangeData: { apiKey: "x" } }),
  });

  const noop = await executeSignal(
    { action: "CLOSE", symbol: "BTCUSDT" } as never,
    "msg-1",
    "chan-1",
    undefined,
    "acc-1",
    "proc-1",
  );
  const closed = await executeSignal(
    { action: "CLOSE", symbol: "BTCUSDT" } as never,
    "msg-2",
    "chan-1",
    undefined,
    "acc-1",
    "proc-2",
  );

  assert.deepEqual(noop, {
    type: "noop",
    code: "no_open_position",
    details: "No open position found for BTCUSDT (channel=chan-1) to close",
  });
  assert.deepEqual(closed, {
    type: "closed",
    closedCount: 1,
  });
  assert.equal(closedDoc.status, "closed");
  assert.equal(exchange.closePosition.mock.calls.length, 1);
});

test("executeSignal CLOSE falls back to paper exchange when account credentials are unavailable", async () => {
  const paperExchange = {
    closePosition: vi.fn().mockResolvedValue(undefined),
  };
  const closeDoc = createDoc({
    symbol: "ETHUSDT",
    quantity: 1.5,
    orderId: "ord-paper",
    accountId: "acc-missing",
  });
  executorMocks.positionFind.mockResolvedValue([closeDoc]);
  executorMocks.accountFindById.mockReturnValue(mockLean({ tradingPlatform: "bybit" }));
  executorMocks.buildExchangeCredentials.mockReturnValue(null);
  executorMocks.getPaperClient.mockReturnValue(paperExchange);

  const result = await executeSignal(
    { action: "CLOSE", symbol: "ETHUSDT" } as never,
    "msg-close",
    "chan-2",
    undefined,
    "acc-1",
    "proc-close",
  );

  assert.deepEqual(result, {
    type: "closed",
    closedCount: 1,
  });
  assert.equal(paperExchange.closePosition.mock.calls.length, 1);
  assert.equal(closeDoc.status, "closed");
});

test("executeSignal updates or noops position updates and handles add-tp flows", async () => {
  const updateDoc = createDoc({
    quantity: 2,
    takeProfitTargets: [{ price: 110, status: "pending", quantity: 2, percentage: 100 }],
  });
  const addTpDoc = createDoc({
    quantity: 2,
    side: "LONG",
    takeProfitTargets: [{ price: 110, status: "pending", quantity: 2, percentage: 100 }],
  });
  const exchange = {
    placeTakeProfit: vi.fn().mockResolvedValue("tp-1"),
  };
  executorMocks.positionFindOne
    .mockResolvedValueOnce(updateDoc)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(addTpDoc)
    .mockResolvedValueOnce(addTpDoc);
  executorMocks.recalculateTPAllocation.mockImplementation((targets) => targets);
  executorMocks.getClientForAccount.mockReturnValue(exchange);
  executorMocks.buildExchangeCredentials.mockReturnValue({ provider: "bybit" });
  executorMocks.accountFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue({ tradingPlatform: "bybit", exchangeData: { apiKey: "x" } }),
  });

  const updated = await executeSignal(
    { action: "UPDATE_TP", symbol: "BTCUSDT", takeProfitTargets: [125] } as never,
    "msg-1",
    "chan-1",
    undefined,
    "acc-1",
    "proc-1",
  );
  const noOpen = await executeSignal(
    { action: "UPDATE_SL", symbol: "BTCUSDT", stopLoss: 90 } as never,
    "msg-2",
    "chan-1",
    undefined,
    "acc-1",
    "proc-2",
  );
  const addTp = await executeSignal(
    { action: "ADD_TP", symbol: "BTCUSDT", takeProfitTargets: [130] } as never,
    "msg-3",
    "chan-1",
    undefined,
    "acc-1",
    "proc-3",
  );
  const addTpNoop = await executeSignal(
    { action: "ADD_TP", symbol: "BTCUSDT", takeProfitTargets: [110] } as never,
    "msg-4",
    "chan-1",
    undefined,
    "acc-1",
    "proc-4",
  );

  assert.deepEqual(updated, {
    type: "updated",
    code: "update_tp",
    details: "UPDATE_TP applied for BTCUSDT",
  });
  assert.equal(updateDoc.takeProfitTargets[0].price, 125);
  assert.deepEqual(noOpen, {
    type: "noop",
    code: "no_open_position",
    details: "No open position found for BTCUSDT (channel=chan-1) to update",
  });
  assert.deepEqual(addTp, {
    type: "updated",
    code: "add_tp",
    details: "Added 1 TP target(s) for BTCUSDT",
  });
  assert.deepEqual(addTpNoop, {
    type: "noop",
    code: "tp_exists",
    details: "All requested TP levels already exist for BTCUSDT",
  });
});

test("executeSignal covers update-sl, update-tp append, add-tp account fallback warnings, and empty add-tp input", async () => {
  const updateSlDoc = createDoc({
    stopLossPrice: 95,
  });
  const updateTpAppendDoc = createDoc({
    quantity: 3,
    takeProfitTargets: [{ price: 110, status: "filled", quantity: 3, percentage: 100 }],
  });
  const addTpWarnDoc = createDoc({
    accountId: null,
    side: "SHORT",
    quantity: 2,
    takeProfitTargets: [{ price: 110, status: "pending", quantity: 2, percentage: 100 }],
  });
  const exchange = {
    placeTakeProfit: vi.fn().mockRejectedValue(new Error("exchange tp rejected")),
  };

  executorMocks.positionFindOne
    .mockResolvedValueOnce(updateSlDoc)
    .mockResolvedValueOnce(updateTpAppendDoc)
    .mockResolvedValueOnce(addTpWarnDoc)
    .mockResolvedValueOnce(addTpWarnDoc);
  executorMocks.buildTPTargets.mockReturnValue([
    { price: 140, quantity: 3, percentage: 100, status: "pending" },
  ]);
  executorMocks.recalculateTPAllocation.mockImplementation((targets) => targets);
  executorMocks.accountFindById.mockReturnValue(
    mockLean({
      tradingPlatform: "bybit",
      exchangeData: { apiKey: "k", secret: "s" },
    }),
  );
  executorMocks.buildExchangeCredentials.mockReturnValue({ provider: "bybit" });
  executorMocks.getClientForAccount.mockReturnValue(exchange);

  const updatedSl = await executeSignal(
    { action: "UPDATE_SL", symbol: "BTCUSDT", stopLoss: 88 } as never,
    "msg-1",
    "chan-1",
    undefined,
    "acc-1",
    "proc-1",
  );
  const appendedTp = await executeSignal(
    { action: "UPDATE_TP", symbol: "BTCUSDT", takeProfitTargets: [140] } as never,
    "msg-2",
    "chan-1",
    undefined,
    "acc-1",
    "proc-2",
  );
  const addTpWarn = await executeSignal(
    { action: "ADD_TP", symbol: "BTCUSDT", takeProfitTargets: [145] } as never,
    "msg-3",
    "chan-1",
    undefined,
    "acc-1",
    "proc-3",
  );
  const addTpEmpty = await executeSignal(
    { action: "ADD_TP", symbol: "BTCUSDT", takeProfitTargets: [] } as never,
    "msg-4",
    "chan-1",
    undefined,
    "acc-1",
    "proc-4",
  );

  assert.deepEqual(updatedSl, {
    type: "updated",
    code: "update_sl",
    details: "UPDATE_SL applied for BTCUSDT",
  });
  assert.equal(updateSlDoc.stopLossPrice, 88);
  assert.deepEqual(appendedTp, {
    type: "updated",
    code: "update_tp",
    details: "UPDATE_TP applied for BTCUSDT",
  });
  assert.equal(updateTpAppendDoc.takeProfitTargets.length, 2);
  assert.equal(updateTpAppendDoc.takeProfitTargets[1].price, 140);
  assert.deepEqual(addTpWarn, {
    type: "updated",
    code: "add_tp",
    details: "Added 1 TP target(s) for BTCUSDT",
  });
  assert.equal(addTpWarnDoc.takeProfitTargets[1].price, 145);
  assert.equal(exchange.placeTakeProfit.mock.calls[0]?.[3], "BUY");
  assert.ok(
    executorMocks.logExecutorWarn.mock.calls.some((call) =>
      String(call[0]).includes("Failed to place TP on exchange at 145"),
    ),
  );
  assert.deepEqual(addTpEmpty, {
    type: "noop",
    code: "no_open_position",
    details: "No open position found for BTCUSDT (channel=chan-1) to add TP",
  });
});

test("executeSignal ADD_TP works without an exchange client when no credentials exist", async () => {
  const addTpLocalOnly = createDoc({
    accountId: "acc-no-creds",
    side: "LONG",
    quantity: 2,
    takeProfitTargets: [{ price: 110, status: "pending", quantity: 2, percentage: 100 }],
  });
  executorMocks.positionFindOne.mockResolvedValueOnce(addTpLocalOnly);
  executorMocks.accountFindById
    .mockReturnValueOnce(mockLean({ tradingPlatform: "bybit" }))
    .mockReturnValueOnce(mockLean({ tradingPlatform: "okx" }));
  executorMocks.buildExchangeCredentials.mockReturnValue(null);
  executorMocks.recalculateTPAllocation.mockImplementation((targets) => targets);

  const result = await executeSignal(
    { action: "ADD_TP", symbol: "BTCUSDT", takeProfitTargets: [135] } as never,
    "msg-local",
    "chan-3",
    undefined,
    "acc-fallback",
    "proc-local",
  );

  assert.deepEqual(result, {
    type: "updated",
    code: "add_tp",
    details: "Added 1 TP target(s) for BTCUSDT",
  });
  assert.equal(addTpLocalOnly.takeProfitTargets[1].price, 135);
  assert.equal(executorMocks.getClientForAccount.mock.calls.length, 0);
});

test("executeSignal skips unhandled actions", async () => {
  const result = await executeSignal(
    { action: "HOLD", symbol: "BTCUSDT" } as never,
    "msg-1",
    "chan-1",
    undefined,
    "acc-1",
    "proc-1",
  );

  assert.deepEqual(result, {
    type: "skipped",
    code: "unhandled_action",
    reason: "Unhandled signal action: HOLD",
  });
});

test("executeTrade uses the paper exchange fallback, applies risk sizing, and stores market positions with TP/SL", async () => {
  const exchange = {
    name: "paper",
    getAccountInfo: vi
      .fn()
      .mockResolvedValue({ availableBalance: 500, totalBalance: 650 }),
    setLeverage: vi.fn().mockResolvedValue(12),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "order-1",
      price: 101,
      quantity: 1.25,
    }),
    getInstrumentSpecs: vi
      .fn()
      .mockResolvedValue({ lotSz: 0.01, qtyDecimals: 2 }),
    placeTakeProfit: vi.fn().mockResolvedValue("tp-id"),
    placeStopLoss: vi.fn().mockResolvedValue("sl-id"),
  };
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: true,
    quantity: 1.25,
    leverage: 12,
    accountBalance: 500,
    marginUsdt: 12.5,
    slDistancePercent: 0.05,
    notionalSize: 125,
  });
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "pos-created" },
    side: payload.side,
    ...payload,
  }));

  const position = await executeTrade({
    symbol: "BTCUSDT",
    action: "BUY",
    entryPrice: 100,
    stopLoss: 95,
    takeProfitTargets: [110, 120],
    leverage: 5,
    quantity: 1,
    orderType: "MARKET",
    channelId: "chan-1",
    messageId: "msg-1",
    signalData: "{}",
  } as never);

  assert.equal(executorMocks.calculateRiskBasedPosition.mock.calls.length, 1);
  assert.equal(exchange.setLeverage.mock.calls[0]?.[0], "BTCUSDT");
  assert.equal(exchange.placeOrder.mock.calls[0]?.[0].type, "MARKET");
  assert.equal(exchange.placeTakeProfit.mock.calls.length, 2);
  assert.equal(exchange.placeStopLoss.mock.calls.length, 1);
  assert.equal(executorMocks.positionCreate.mock.calls[0]?.[0].status, "open");
  assert.equal(executorMocks.positionCreate.mock.calls[0]?.[0].tpSlPlaced, true);
  assert.equal(position._id.toString(), "pos-created");
});

test("executeTrade uses account exchange credentials for limit orders and skips TP/SL placement", async () => {
  const exchange = {
    name: "bybit",
    getAccountInfo: vi.fn().mockRejectedValue(new Error("balance offline")),
    setLeverage: vi.fn().mockRejectedValue(new Error("not supported")),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "limit-1",
      price: 200,
      quantity: 2,
    }),
    getInstrumentSpecs: vi.fn(),
    placeTakeProfit: vi.fn(),
    placeStopLoss: vi.fn(),
  };
  executorMocks.accountFindById.mockReturnValue(
    mockLean({
      tradingPlatform: "bybit",
      exchangeData: { apiKey: "k", secret: "s" },
    }),
  );
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: false,
    skipReason: "kept requested sizing",
  });
  executorMocks.buildExchangeCredentials.mockReturnValue({ provider: "bybit" });
  executorMocks.getClientForAccount.mockReturnValue(exchange);
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "limit-pos" },
    side: payload.side,
    ...payload,
  }));

  const position = await executeTrade({
    symbol: "ETHUSDT",
    action: "SELL",
    entryPrice: 200,
    stopLoss: 210,
    takeProfitTargets: [180],
    leverage: 8,
    quantity: 2,
    orderType: "LIMIT",
    channelId: "chan-2",
    accountId: "acc-1",
    signalData: "{}",
  } as never);

  assert.deepEqual(executorMocks.buildExchangeCredentials.mock.calls[0]?.[0], "bybit");
  assert.equal(executorMocks.getClientForAccount.mock.calls.length, 1);
  assert.equal(exchange.placeOrder.mock.calls[0]?.[0].type, "LIMIT");
  assert.equal(exchange.placeOrder.mock.calls[0]?.[0].price, 200);
  assert.equal(exchange.placeTakeProfit.mock.calls.length, 0);
  assert.equal(exchange.placeStopLoss.mock.calls.length, 0);
  assert.equal(executorMocks.positionCreate.mock.calls[0]?.[0].status, "pending");
  assert.equal(executorMocks.positionCreate.mock.calls[0]?.[0].tpSlPlaced, false);
  assert.equal(position.side, "SHORT");
});

test("executeTrade falls back to paper provider credentials when account exchangeData cannot be converted", async () => {
  const exchange = {
    name: "paper-via-account",
    getAccountInfo: vi.fn().mockResolvedValue({ availableBalance: 250, totalBalance: 300 }),
    setLeverage: vi.fn().mockResolvedValue(3),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "fallback-paper-order",
      price: 50,
      quantity: 2,
    }),
    getInstrumentSpecs: vi.fn(),
    placeTakeProfit: vi.fn(),
    placeStopLoss: vi.fn(),
  };
  executorMocks.accountFindById.mockReturnValue(
    mockLean({
      tradingPlatform: "binance",
      exchangeData: { apiKey: "bad-shape" },
    }),
  );
  executorMocks.buildExchangeCredentials.mockReturnValue(null);
  executorMocks.getClientForAccount.mockReturnValue(exchange);
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: false,
    skipReason: "kept requested sizing",
  });
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "paper-creds-pos" },
    side: payload.side,
    ...payload,
  }));

  const position = await executeTrade({
    symbol: "SOLUSDT",
    action: "BUY",
    entryPrice: 50,
    stopLoss: 45,
    takeProfitTargets: [60],
    leverage: 3,
    quantity: 2,
    orderType: "LIMIT",
    channelId: "chan-paper-creds",
    accountId: "acc-paper-creds",
    signalData: "{}",
  } as never);

  assert.equal(position._id.toString(), "paper-creds-pos");
  assert.deepEqual(executorMocks.getClientForAccount.mock.calls[0]?.[0], {
    provider: "paper",
  });
  assert.equal(
    executorMocks.logExecutorWarn.mock.calls.some((call) =>
      String(call[0]).includes("has no exchangeData"),
    ),
    false,
  );
});

test("executeTrade warns and uses paper exchange when an account has no exchangeData", async () => {
  const exchange = {
    name: "paper",
    getAccountInfo: vi.fn().mockResolvedValue({ availableBalance: 150, totalBalance: 200 }),
    setLeverage: vi.fn().mockResolvedValue(2),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "no-exchange-data-order",
      price: 25,
      quantity: 1,
    }),
    getInstrumentSpecs: vi.fn(),
    placeTakeProfit: vi.fn(),
    placeStopLoss: vi.fn(),
  };
  executorMocks.accountFindById.mockReturnValue(
    mockLean({
      tradingPlatform: "okx",
    }),
  );
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: false,
    skipReason: "kept requested sizing",
  });
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "paper-no-data-pos" },
    side: payload.side,
    ...payload,
  }));

  const position = await executeTrade({
    symbol: "XRPUSDT",
    action: "SELL",
    entryPrice: 25,
    stopLoss: 26,
    takeProfitTargets: [20],
    leverage: 2,
    quantity: 1,
    orderType: "LIMIT",
    channelId: "chan-paper-no-data",
    accountId: "acc-paper-no-data",
    processId: "proc-paper-no-data",
    signalData: "{}",
  } as never);

  assert.equal(position._id.toString(), "paper-no-data-pos");
  assert.equal(executorMocks.getPaperClient.mock.calls.length, 1);
  assert.ok(
    executorMocks.logExecutorWarn.mock.calls.some(
      (call) =>
        String(call[0]).includes("Account acc-paper-no-data has no exchangeData") &&
        call[1]?.action === "console_exchange_fallback",
    ),
  );
});

test("executeTrade warns and still saves the position when market stop-loss placement fails", async () => {
  const exchange = {
    name: "paper",
    getAccountInfo: vi
      .fn()
      .mockResolvedValue({ availableBalance: 500, totalBalance: 500 }),
    setLeverage: vi.fn().mockResolvedValue(8),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "order-sl-warn",
      price: 101,
      quantity: 1,
    }),
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 0.01, qtyDecimals: 2 }),
    placeTakeProfit: vi.fn().mockResolvedValue("tp-ok"),
    placeStopLoss: vi.fn().mockRejectedValue("sl transport failed"),
  };
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: false,
    skipReason: "kept requested sizing",
  });
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "sl-warn-pos" },
    side: payload.side,
    ...payload,
  }));

  const position = await executeTrade({
    symbol: "ADAUSDT",
    action: "BUY",
    entryPrice: 100,
    stopLoss: 95,
    takeProfitTargets: [110],
    leverage: 8,
    quantity: 1,
    orderType: "MARKET",
    channelId: "chan-sl",
    messageId: "msg-sl",
    signalData: "{}",
  } as never);

  assert.equal(position._id.toString(), "sl-warn-pos");
  assert.equal(exchange.placeStopLoss.mock.calls.length, 1);
  assert.ok(
    executorMocks.logExecutorWarn.mock.calls.some(
      (call) =>
        String(call[0]).includes("Failed to place SL: sl transport failed") &&
        call[1]?.action === "console_stop_loss_failed",
    ),
  );
});

test("executeTrade warns when risk sizing is skipped for missing entry price and TP placement fails", async () => {
  const exchange = {
    name: "paper",
    getAccountInfo: vi
      .fn()
      .mockResolvedValue({ availableBalance: 400, totalBalance: 400 }),
    setLeverage: vi.fn().mockResolvedValue(5),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "order-tp-warn",
      price: 99,
      quantity: 1,
    }),
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 0.01, qtyDecimals: 2 }),
    placeTakeProfit: vi.fn().mockRejectedValue(new Error("tp rejected")),
    placeStopLoss: vi.fn().mockResolvedValue("sl-ok"),
  };
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "tp-warn-pos" },
    side: payload.side,
    ...payload,
  }));

  const position = await executeTrade({
    symbol: "DOGEUSDT",
    action: "BUY",
    entryPrice: undefined,
    stopLoss: 90,
    takeProfitTargets: [110],
    leverage: 5,
    quantity: 1,
    orderType: "MARKET",
    channelId: "chan-tp",
    messageId: "msg-tp",
    signalData: "{}",
  } as never);

  assert.equal(position._id.toString(), "tp-warn-pos");
  assert.equal(exchange.placeTakeProfit.mock.calls.length, 1);
  assert.ok(
    executorMocks.logExecutorWarn.mock.calls.some(
      (call) =>
        String(call[0]).includes("Risk management skipped: no entry price available") &&
        call[1]?.action === "console_risk_skipped",
    ),
  );
  assert.ok(
    executorMocks.logExecutorWarn.mock.calls.some(
      (call) =>
        String(call[0]).includes("Failed to place TP at 110: tp rejected") &&
        call[1]?.action === "console_take_profit_failed",
    ),
  );
});

test("runSignalCheck processes manual-mode messages across parse failure, ignored, and drafted outcomes", async () => {
  const fetchMessages = vi.fn().mockResolvedValue([
    {
      messageId: "m1",
      channelId: "chan-1",
      author: "Trader",
      content: "bad parse",
      timestamp: new Date("2024-01-01T00:00:00Z"),
    },
    {
      messageId: "m2",
      channelId: "chan-1",
      author: "Trader",
      content: "hold",
      timestamp: new Date("2024-01-01T00:00:01Z"),
    },
    {
      messageId: "m3",
      channelId: "chan-1",
      author: "Trader",
      content: "buy",
      timestamp: new Date("2024-01-01T00:00:02Z"),
    },
  ]);
  executorMocks.getTradingMode.mockResolvedValue("manual");
  executorMocks.getSignalConfig.mockResolvedValue({
    fetchLimit: 20,
    timeWindowHours: 6,
    batchSize: 5,
  });
  executorMocks.processedMessageFind
    .mockReturnValueOnce(mockLean([{ messageId: "old", accountId: { toString: () => "acc-9" } }]))
    .mockReturnValueOnce(mockLean([]));
  executorMocks.accountFind.mockReturnValue(
    mockSortedLean([
      {
        _id: { toString: () => "acc-disabled" },
        name: "Disabled",
        sourceType: "discord",
        channelIds: ["chan-x"],
        disabledChannelIds: ["chan-x"],
        sourceData: {},
      },
      {
        _id: { toString: () => "acc-1" },
        name: "Signals",
        sourceType: "discord",
        channelIds: ["chan-1"],
        disabledChannelIds: [],
        sourceData: { token: "abc" },
      },
    ]),
  );
  executorMocks.sourceGetProvider.mockReturnValue({ fetchMessages });
  executorMocks.analyzeMessagesWithAI.mockResolvedValue([
    { messageId: "m1", signal: null, parseError: "invalid schema" },
    { messageId: "m2", signal: { action: "HOLD" } },
    { messageId: "m3", signal: { action: "BUY", symbol: "BTCUSDT" } },
  ]);
  executorMocks.createTradeProcessId
    .mockReturnValueOnce("proc-1")
    .mockReturnValueOnce("proc-2")
    .mockReturnValueOnce("proc-3");
  executorMocks.createDraft.mockResolvedValue({ _id: { toString: () => "draft-1" } });

  const result = await runSignalCheck();

  assert.deepEqual(result, {
    checked: 3,
    newSignals: 1,
    executed: 0,
    drafted: 1,
    errors: ["Message m1: AI parse failed: invalid schema"],
    sources: [
      { name: "Disabled", channels: 1, healthy: true },
      { name: "Signals", channels: 1, healthy: true },
    ],
  });
  assert.equal(fetchMessages.mock.calls[0]?.[1], 20);
  assert.equal(fetchMessages.mock.calls[0]?.[2], 6);
  assert.deepEqual([...fetchMessages.mock.calls[0]?.[3]], []);
  assert.equal(executorMocks.processedMessageInsertMany.mock.calls.length, 1);
  assert.equal(executorMocks.processedMessageUpdateOne.mock.calls.length, 4);
  assert.equal(executorMocks.createDraft.mock.calls.length, 1);
  assert.equal(executorMocks.accountFindByIdAndUpdate.mock.calls.length, 1);
});

test("runSignalCheck handles provider errors and auto-mode cancel signals that reject drafts and close positions", async () => {
  const cancelledDraft = {
    _id: { toString: () => "draft-2" },
    symbol: "BTCUSDT",
    accountId: "acc-2",
    processId: "draft-proc",
    status: "pending",
    resolvedAt: null,
    save: vi.fn().mockResolvedValue(undefined),
  };
  const openPosition = createDoc({
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 3,
    orderId: "order-77",
    accountId: "acc-2",
  });
  const exchange = {
    closePosition: vi.fn().mockResolvedValue(undefined),
  };
  executorMocks.getTradingMode.mockResolvedValue("auto");
  executorMocks.getSignalConfig.mockResolvedValue({
    fetchLimit: 10,
    timeWindowHours: 12,
    batchSize: 2,
  });
  executorMocks.processedMessageFind
    .mockReturnValueOnce(mockLean([]))
    .mockReturnValueOnce(mockLean([]));
  executorMocks.accountFind.mockReturnValue(
    mockSortedLean([
      {
        _id: { toString: () => "acc-bad" },
        name: "Broken Source",
        sourceType: "discord",
        channelIds: ["chan-bad"],
        disabledChannelIds: [],
        sourceData: {},
      },
      {
        _id: { toString: () => "acc-2" },
        name: "Auto Source",
        sourceType: "discord",
        channelIds: ["chan-2"],
        disabledChannelIds: [],
        sourceData: {},
      },
    ]),
  );
  executorMocks.sourceGetProvider
    .mockReturnValueOnce({
      fetchMessages: vi.fn().mockRejectedValue(new Error("source offline")),
    })
    .mockReturnValueOnce({
      fetchMessages: vi.fn().mockResolvedValue([
        {
          messageId: "cancel-1",
          channelId: "chan-2",
          author: "Trader",
          content: "cancel btc",
          sourceId: "acc-2",
          sourceName: "Auto Source",
        },
      ]),
    });
  executorMocks.analyzeMessagesWithAI.mockResolvedValue([
    {
      messageId: "cancel-1",
      signal: { action: "CANCEL", symbol: "BTCUSDT", reasoning: "setup invalid" },
    },
  ]);
  executorMocks.createTradeProcessId.mockReturnValue("proc-cancel");
  executorMocks.draftFind.mockResolvedValue([cancelledDraft]);
  executorMocks.positionFind.mockResolvedValue([openPosition]);
  executorMocks.accountFindById.mockReturnValue(
    mockLean({
      tradingPlatform: "bybit",
      exchangeData: { apiKey: "k", secret: "s" },
    }),
  );
  executorMocks.buildExchangeCredentials.mockReturnValue({ provider: "bybit" });
  executorMocks.getClientForAccount.mockReturnValue(exchange);

  const result = await runSignalCheck();

  assert.equal(result.checked, 1);
  assert.equal(result.newSignals, 0);
  assert.equal(result.executed, 0);
  assert.deepEqual(result.errors, ['Account "Broken Source": source offline']);
  assert.deepEqual(result.sources, [
    { name: "Broken Source", channels: 1, healthy: false },
    { name: "Auto Source", channels: 1, healthy: true },
  ]);
  assert.equal(cancelledDraft.status, "rejected");
  assert.ok(cancelledDraft.resolvedAt instanceof Date);
  assert.equal(openPosition.status, "closed");
  assert.match(String(openPosition.closeReason), /Cancel request by Trader/);
  assert.equal(exchange.closePosition.mock.calls.length, 1);
});

test("runSignalCheck auto-executes signals, resolves drafts, and marks messages executed", async () => {
  const fetchMessages = vi.fn().mockResolvedValue([
    {
      messageId: "auto-1",
      channelId: "chan-auto",
      author: "Trader",
      content: "buy btc",
      sourceId: "acc-auto",
      sourceName: "Auto Desk",
      messageUrl: "https://discord.example/1",
      imageUrls: [],
    },
  ]);
  const exchange = {
    name: "paper",
    getAccountInfo: vi.fn().mockResolvedValue({ availableBalance: 1000, totalBalance: 1000 }),
    setLeverage: vi.fn().mockResolvedValue(10),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "auto-open-1",
      price: 100,
      quantity: 1,
    }),
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 0.01, qtyDecimals: 2 }),
    placeTakeProfit: vi.fn().mockResolvedValue("tp-1"),
    placeStopLoss: vi.fn().mockResolvedValue("sl-1"),
  };
  executorMocks.getTradingMode.mockResolvedValue("auto");
  executorMocks.getSignalConfig.mockResolvedValue({
    fetchLimit: 10,
    timeWindowHours: 12,
    batchSize: 5,
  });
  executorMocks.processedMessageFind
    .mockReturnValueOnce(mockLean([]))
    .mockReturnValueOnce(mockLean([]));
  executorMocks.accountFind.mockReturnValue(
    mockSortedLean([
      {
        _id: { toString: () => "acc-auto" },
        name: "Auto Desk",
        sourceType: "discord",
        channelIds: ["chan-auto"],
        disabledChannelIds: [],
        sourceData: { token: "abc" },
      },
    ]),
  );
  executorMocks.sourceGetProvider.mockReturnValue({ fetchMessages });
  executorMocks.analyzeMessagesWithAI.mockResolvedValue([
    {
      messageId: "auto-1",
      signal: {
        action: "BUY",
        symbol: "BTCUSDT",
        entryPrice: 100,
        stopLoss: 95,
        takeProfitTargets: [110],
      },
    },
  ]);
  executorMocks.createTradeProcessId.mockReturnValue("proc-auto-1");
  executorMocks.createDraft.mockResolvedValue({ _id: { toString: () => "draft-auto-1" } });
  executorMocks.resolveDraftWithExecution.mockResolvedValue({
    status: "accepted",
    result: "executed",
    positionId: "pos-auto-1",
  });
  executorMocks.positionFindOne.mockResolvedValue(null);
  executorMocks.accountFindById.mockReturnValue(
    mockLean({
      tradingPlatform: "bybit",
    }),
  );
  executorMocks.buildExchangeCredentials.mockReturnValue(null);
  executorMocks.getPaperClient.mockReturnValue(exchange);
  executorMocks.calculateRiskBasedPosition.mockResolvedValue({
    applied: false,
    skipReason: "kept requested sizing",
  });
  executorMocks.positionCreate.mockImplementation(async (payload) => ({
    _id: { toString: () => "pos-auto-1" },
    side: payload.side,
    ...payload,
  }));

  const result = await runSignalCheck();

  assert.deepEqual(result, {
    checked: 1,
    newSignals: 1,
    executed: 1,
    drafted: 0,
    errors: [],
    sources: [{ name: "Auto Desk", channels: 1, healthy: true }],
  });
  assert.equal(executorMocks.createDraft.mock.calls.length, 1);
  assert.equal(executorMocks.resolveDraftWithExecution.mock.calls.length, 1);
  assert.ok(
    executorMocks.processedMessageUpdateOne.mock.calls.some(
      (call) =>
        call[0]?.messageId === "auto-1" && call[1]?.status === "executed",
    ),
  );
  assert.ok(
    executorMocks.logProcessStep.mock.calls.some(
      (call) => call[0]?.action === "auto_execution_completed",
    ),
  );
});

test("runSignalCheck rejects pending auto drafts and marks messages failed when processing throws", async () => {
  const fetchMessages = vi.fn().mockResolvedValue([
    {
      messageId: "auto-fail-1",
      channelId: "chan-auto-fail",
      author: "Trader",
      content: "buy eth",
      sourceId: "acc-auto-fail",
      sourceName: "Auto Fail Desk",
      messageUrl: "https://discord.example/2",
      imageUrls: [],
      processId: "proc-auto-fail-1",
    },
  ]);
  const pendingDraft = {
    _id: { toString: () => "draft-pending-1" },
    status: "pending",
    save: vi.fn().mockResolvedValue(undefined),
  };
  executorMocks.getTradingMode.mockResolvedValue("auto");
  executorMocks.getSignalConfig.mockResolvedValue({
    fetchLimit: 10,
    timeWindowHours: 12,
    batchSize: 5,
  });
  executorMocks.processedMessageFind
    .mockReturnValueOnce(mockLean([]))
    .mockReturnValueOnce(mockLean([]));
  executorMocks.accountFind.mockReturnValue(
    mockSortedLean([
      {
        _id: { toString: () => "acc-auto-fail" },
        name: "Auto Fail Desk",
        sourceType: "discord",
        channelIds: ["chan-auto-fail"],
        disabledChannelIds: [],
        sourceData: { token: "abc" },
      },
    ]),
  );
  executorMocks.sourceGetProvider.mockReturnValue({ fetchMessages });
  executorMocks.analyzeMessagesWithAI.mockResolvedValue([
    {
      messageId: "auto-fail-1",
      signal: { action: "BUY", symbol: "ETHUSDT" },
    },
  ]);
  executorMocks.createTradeProcessId.mockReturnValue("proc-auto-fail-1");
  executorMocks.createDraft.mockRejectedValue(new Error("draft create failed"));
  executorMocks.draftFindOne.mockResolvedValue(pendingDraft);
  executorMocks.rejectDraftWithReason.mockResolvedValue({
    status: "rejected",
    result: "rejected",
    message: "draft create failed",
    error: "draft create failed",
  });

  const result = await runSignalCheck();

  assert.deepEqual(result.errors, ["Message auto-fail-1: draft create failed"]);
  assert.ok(
    executorMocks.processedMessageUpdateOne.mock.calls.some(
      (call) =>
        call[0]?.messageId === "auto-fail-1" && call[1]?.status === "failed",
    ),
  );
  assert.equal(executorMocks.rejectDraftWithReason.mock.calls.length, 1);
  assert.ok(
    executorMocks.logProcessStep.mock.calls.some(
      (call) =>
        call[0]?.action === "process_failed" && call[0]?.error === "draft create failed",
    ),
  );
  assert.ok(
    executorMocks.logExecutorError.mock.calls.some(
      (call) =>
        String(call[0]).includes("Error processing message auto-fail-1: draft create failed") &&
        call[1]?.action === "console_process_error",
    ),
  );
});

test("runSignalCheck records a general error when top-level execution throws", async () => {
  executorMocks.getTradingMode.mockRejectedValue(new Error("db exploded"));

  const result = await runSignalCheck();

  assert.equal(result.checked, 0);
  assert.deepEqual(result.errors, ["General: db exploded"]);
  assert.ok(
    executorMocks.logExecutorError.mock.calls.some(
      (call) =>
        String(call[0]).includes("Signal check error: db exploded") &&
        call[1]?.action === "console_signal_check_error",
    ),
  );
});
