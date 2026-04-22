import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const monitorMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  positionFind: vi.fn(),
  accountFindById: vi.fn(),
  getAnalyzer: vi.fn(),
  buildPositionAnalysisInput: vi.fn(),
  getClientForAccount: vi.fn(),
  getPaperClient: vi.fn(),
  buildExchangeCredentials: vi.fn(),
  inspectPendingLimitOrder: vi.fn(),
  logExecutorError: vi.fn(),
  logExecutorInfo: vi.fn(),
  logExecutorWarn: vi.fn(),
  logProcessStep: vi.fn(),
  ensurePersistedProcessId: vi.fn(),
}));

vi.mock("./database", () => ({
  connectDB: monitorMocks.connectDB,
  Position: {
    find: monitorMocks.positionFind,
  },
  Account: {
    findById: monitorMocks.accountFindById,
  },
}));

vi.mock("./ai/AIFactory", () => ({
  AIFactory: {
    getAnalyzer: monitorMocks.getAnalyzer,
  },
}));

vi.mock("./ai/PositionMonitorContext", () => ({
  buildPositionAnalysisInput: monitorMocks.buildPositionAnalysisInput,
}));

vi.mock("./exchange/ExchangeFactory", () => ({
  ExchangeFactory: {
    getClientForAccount: monitorMocks.getClientForAccount,
    getPaperClient: monitorMocks.getPaperClient,
  },
  buildExchangeCredentials: monitorMocks.buildExchangeCredentials,
}));

vi.mock("./pending-order-sync", () => ({
  inspectPendingLimitOrder: monitorMocks.inspectPendingLimitOrder,
}));

vi.mock("./process-log", () => ({
  logExecutorError: monitorMocks.logExecutorError,
  logExecutorInfo: monitorMocks.logExecutorInfo,
  logExecutorWarn: monitorMocks.logExecutorWarn,
  logProcessStep: monitorMocks.logProcessStep,
}));

vi.mock("./process-id", () => ({
  ensurePersistedProcessId: monitorMocks.ensurePersistedProcessId,
}));

import { runPositionMonitor } from "./monitor";

function createLeanQuery(result: unknown) {
  return {
    lean: vi.fn().mockResolvedValue(result),
  };
}

function createPosition(overrides: Record<string, unknown> = {}) {
  const position: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = {
    _id: { toString: () => "pos-1" },
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 4,
    entryPrice: 100,
    leverage: 10,
    stopLossPrice: undefined,
    takeProfitTargets: [{ price: 120, quantity: 4, percentage: 100, status: "pending" }],
    status: "open",
    orderId: "order-1",
    accountId: undefined,
    messageId: "msg-1",
    channelId: "chan-1",
    save: vi.fn(),
  };
  Object.assign(position, overrides);
  position.save.mockResolvedValue(position);
  return position;
}

function usePositionState(positions: Array<ReturnType<typeof createPosition>>) {
  monitorMocks.positionFind.mockImplementation(
    async (query: { status?: string } = {}) =>
      positions.filter((position) =>
        query.status ? position.status === query.status : true,
      ),
  );
}

function createExchange() {
  return {
    getOpenPositions: vi.fn().mockResolvedValue([]),
    getTickerPrice: vi.fn().mockResolvedValue(100),
    closePosition: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  monitorMocks.connectDB.mockReset();
  monitorMocks.positionFind.mockReset();
  monitorMocks.accountFindById.mockReset();
  monitorMocks.getAnalyzer.mockReset();
  monitorMocks.buildPositionAnalysisInput.mockReset();
  monitorMocks.getClientForAccount.mockReset();
  monitorMocks.getPaperClient.mockReset();
  monitorMocks.buildExchangeCredentials.mockReset();
  monitorMocks.inspectPendingLimitOrder.mockReset();
  monitorMocks.logExecutorError.mockReset();
  monitorMocks.logExecutorInfo.mockReset();
  monitorMocks.logExecutorWarn.mockReset();
  monitorMocks.logProcessStep.mockReset();
  monitorMocks.ensurePersistedProcessId.mockReset();

  monitorMocks.connectDB.mockResolvedValue(undefined);
  monitorMocks.accountFindById.mockReturnValue(createLeanQuery(null));
  monitorMocks.getAnalyzer.mockReturnValue({
    analyzePosition: vi.fn().mockResolvedValue({
      decision: "HOLD",
      confidence: 90,
      reason: "healthy",
    }),
  });
  monitorMocks.buildPositionAnalysisInput.mockImplementation(
    async (position: { symbol: string }) => ({
      symbol: position.symbol,
      currentTime: "2026-04-21T00:00:00.000Z",
      accountOpenPositions: [],
      discordContextMessages: [],
    }),
  );
  monitorMocks.buildExchangeCredentials.mockReturnValue(null);
  monitorMocks.logExecutorInfo.mockResolvedValue(undefined);
  monitorMocks.logExecutorWarn.mockResolvedValue(undefined);
  monitorMocks.logExecutorError.mockResolvedValue(undefined);
  monitorMocks.logProcessStep.mockResolvedValue(undefined);
  monitorMocks.ensurePersistedProcessId.mockImplementation(
    async (position: { symbol: string }, prefix: string) =>
      `${prefix}-${position.symbol}`,
  );
});

test("runPositionMonitor handles pending live, cancelled, filled, and sync-closed positions", async () => {
  const syncClosed = createPosition({ _id: { toString: () => "open-1" }, symbol: "MISSUSDT" });
  const stillOpen = createPosition({ _id: { toString: () => "open-2" }, symbol: "KEEPUSDT" });
  const pendingLive = createPosition({
    _id: { toString: () => "pending-live" },
    symbol: "LIVEUSDT",
    status: "pending",
  });
  const pendingCancelled = createPosition({
    _id: { toString: () => "pending-cancelled" },
    symbol: "CANCELUSDT",
    status: "pending",
  });
  const pendingFilled = createPosition({
    _id: { toString: () => "pending-filled" },
    symbol: "FILLUSDT",
    status: "pending",
    entryPrice: 95,
  });
  const positions = [
    syncClosed,
    stillOpen,
    pendingLive,
    pendingCancelled,
    pendingFilled,
  ];
  const exchange = createExchange();

  usePositionState(positions);
  exchange.getOpenPositions.mockResolvedValue([
    {
      symbol: "KEEPUSDT",
      markPrice: 112,
      unrealizedPnl: 4,
      entryPrice: 100,
      quantity: 4,
    },
  ]);
  exchange.getTickerPrice.mockResolvedValue(103);
  monitorMocks.getPaperClient.mockReturnValue(exchange);
  monitorMocks.inspectPendingLimitOrder.mockImplementation(
    async (_exchange: unknown, position: { symbol: string }) => {
      if (position.symbol === "LIVEUSDT") {
        return { type: "live", reason: "still resting" };
      }
      if (position.symbol === "CANCELUSDT") {
        return { type: "cancelled", reason: "cancelled on exchange" };
      }
      return { type: "filled", reason: "filled on exchange", fillPrice: 101 };
    },
  );

  const result = await runPositionMonitor();

  assert.deepEqual(result, {
    checked: 2,
    actions: 1,
    errors: [],
    syncedClosed: 2,
  });
  assert.equal(syncClosed.status, "closed");
  assert.equal(syncClosed.closeReason, "Closed on Exchange (external)");
  assert.equal(pendingCancelled.status, "closed");
  assert.equal(pendingCancelled.closeReason, "cancelled on exchange");
  assert.equal(pendingFilled.status, "open");
  assert.equal(pendingFilled.entryPrice, 101);
  assert.equal(exchange.getTickerPrice.mock.calls[0]?.[0], "FILLUSDT");
});

test("runPositionMonitor closes positions when stop loss or take profit rules are hit", async () => {
  const slPosition = createPosition({
    _id: { toString: () => "sl-1" },
    symbol: "SLUSDT",
    stopLossPrice: 95,
    takeProfitTargets: [],
  });
  const tpPosition = createPosition({
    _id: { toString: () => "tp-1" },
    symbol: "TPUSDT",
    stopLossPrice: undefined,
    takeProfitTargets: [{ price: 110, quantity: 4, percentage: 100, status: "pending" }],
  });
  const positions = [slPosition, tpPosition];
  const exchange = createExchange();

  usePositionState(positions);
  exchange.getOpenPositions.mockResolvedValue([
    {
      symbol: "SLUSDT",
      markPrice: 94,
      unrealizedPnl: -6,
      entryPrice: 100,
      quantity: 4,
    },
    {
      symbol: "TPUSDT",
      markPrice: 111,
      unrealizedPnl: 8,
      entryPrice: 100,
      quantity: 4,
    },
  ]);
  monitorMocks.getPaperClient.mockReturnValue(exchange);

  const result = await runPositionMonitor();

  assert.deepEqual(result, {
    checked: 2,
    actions: 2,
    errors: [],
    syncedClosed: 0,
  });
  assert.equal(slPosition.status, "closed");
  assert.equal(slPosition.closeReason, "Stop Loss Hit");
  assert.equal(tpPosition.status, "closed");
  assert.equal(tpPosition.closeReason, "Take Profit Hit");
  assert.equal(exchange.closePosition.mock.calls.length, 2);
});

test("runPositionMonitor applies AI close, move SL, partial close, update TP, and hold decisions", async () => {
  const aiClose = createPosition({ _id: { toString: () => "ai-close" }, symbol: "CLOSEUSDT" });
  const moveSl = createPosition({
    _id: { toString: () => "ai-move-sl" },
    symbol: "MOVESLUSDT",
    stopLossPrice: 90,
  });
  const partial = createPosition({
    _id: { toString: () => "ai-partial" },
    symbol: "PARTUSDT",
    quantity: 4,
  });
  const updateTp = createPosition({
    _id: { toString: () => "ai-update-tp" },
    symbol: "UPDATEUSDT",
    takeProfitTargets: [{ price: 120, quantity: 4, percentage: 100, status: "pending" }],
  });
  const hold = createPosition({ _id: { toString: () => "ai-hold" }, symbol: "HOLDUSDT" });
  const positions = [aiClose, moveSl, partial, updateTp, hold];
  const exchange = createExchange();
  const analyzer = {
    analyzePosition: vi.fn().mockImplementation(
      async (input: { symbol: string }) => {
        switch (input.symbol) {
          case "CLOSEUSDT":
            return { decision: "CLOSE", confidence: 80, reason: "trend break" };
          case "MOVESLUSDT":
            return {
              decision: "MOVE_SL",
              confidence: 70,
              reason: "trail profit",
              newStopLoss: 105,
            };
          case "PARTUSDT":
            return {
              decision: "PARTIAL_CLOSE",
              confidence: 80,
              reason: "de-risk",
              closePercentage: 25,
            };
          case "UPDATEUSDT":
            return {
              decision: "UPDATE_TP",
              confidence: 75,
              reason: "extend target",
              newTakeProfit: 130,
            };
          default:
            return { decision: "HOLD", confidence: 90, reason: "healthy" };
        }
      },
    ),
  };

  usePositionState(positions);
  exchange.getOpenPositions.mockResolvedValue(
    positions.map((position) => ({
      symbol: position.symbol,
      markPrice: 108,
      unrealizedPnl: 5,
      entryPrice: 100,
      quantity: Number(position.quantity),
    })),
  );
  monitorMocks.getPaperClient.mockReturnValue(exchange);
  monitorMocks.getAnalyzer.mockReturnValue(analyzer);

  const result = await runPositionMonitor();

  assert.deepEqual(result, {
    checked: 5,
    actions: 4,
    errors: [],
    syncedClosed: 0,
  });
  assert.equal(aiClose.status, "closed");
  assert.match(String(aiClose.closeReason), /AI Close: trend break/);
  assert.equal(moveSl.stopLossPrice, 105);
  assert.equal(partial.quantity, 3);
  assert.equal(updateTp.takeProfitTargets[0].price, 130);
  assert.equal(hold.status, "open");
  assert.equal(exchange.closePosition.mock.calls.length, 2);
  assert.deepEqual(exchange.closePosition.mock.calls[1], [
    "PARTUSDT",
    "order-1",
    1,
  ]);
});

test("runPositionMonitor records per-position failures and general monitor failures", async () => {
  const broken = createPosition({ _id: { toString: () => "err-1" }, symbol: "ERRUSDT" });
  const positions = [broken];
  const exchange = createExchange();

  usePositionState(positions);
  exchange.getOpenPositions.mockResolvedValue([
    {
      symbol: "ERRUSDT",
      markPrice: 107,
      unrealizedPnl: 3,
      entryPrice: 100,
      quantity: 4,
    },
  ]);
  monitorMocks.getPaperClient.mockReturnValue(exchange);
  monitorMocks.buildPositionAnalysisInput.mockRejectedValueOnce(
    new Error("context failed"),
  );

  const positionFailure = await runPositionMonitor();

  assert.deepEqual(positionFailure, {
    checked: 1,
    actions: 0,
    errors: ["ERRUSDT: context failed"],
    syncedClosed: 0,
  });

  monitorMocks.positionFind.mockRejectedValueOnce(new Error("open query failed"));

  const generalFailure = await runPositionMonitor();

  assert.deepEqual(generalFailure, {
    checked: 0,
    actions: 0,
    errors: ["General: open query failed"],
    syncedClosed: 0,
  });
});
