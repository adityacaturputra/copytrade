import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const executorMocks = vi.hoisted(() => ({
  processedMessageFind: vi.fn(),
  positionFind: vi.fn(),
  positionFindOne: vi.fn(),
  positionCountDocuments: vi.fn(),
  positionCreate: vi.fn(),
  accountFind: vi.fn(),
  accountFindById: vi.fn(),
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
  createDraft: vi.fn(),
  refreshDraftFromSignal: vi.fn(),
  rejectDraftWithReason: vi.fn(),
  resolveDraftWithExecution: vi.fn(),
  autoCalculateTPFromRR: vi.fn(),
  autoCalculateSLFromRR: vi.fn(),
  sanitizeLeverage: vi.fn(),
}));

vi.mock("./database", () => ({
  connectDB: vi.fn(),
  ProcessedMessage: {
    find: executorMocks.processedMessageFind,
  },
  Position: {
    find: executorMocks.positionFind,
    findOne: executorMocks.positionFindOne,
    countDocuments: executorMocks.positionCountDocuments,
    create: executorMocks.positionCreate,
  },
  DraftTrade: {
    find: vi.fn(),
  },
  Account: {
    find: executorMocks.accountFind,
    findById: executorMocks.accountFindById,
    findByIdAndUpdate: vi.fn(),
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
  executeSignal,
  splitQuantityForTPs,
} from "./executor";

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
  executorMocks.processedMessageFind.mockReset();
  executorMocks.positionFind.mockReset();
  executorMocks.positionFindOne.mockReset();
  executorMocks.positionCountDocuments.mockReset();
  executorMocks.positionCreate.mockReset();
  executorMocks.accountFind.mockReset();
  executorMocks.accountFindById.mockReset();
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
