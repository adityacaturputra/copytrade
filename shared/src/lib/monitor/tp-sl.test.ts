import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const tpslMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  positionFind: vi.fn(),
  positionFindOneAndUpdate: vi.fn(),
  positionCountDocuments: vi.fn(),
  accountFindById: vi.fn(),
  getClientForAccount: vi.fn(),
  getPaperClient: vi.fn(),
  buildExchangeCredentials: vi.fn(),
  splitQuantityForTPs: vi.fn(),
  inspectPendingLimitOrder: vi.fn(),
  logExecutorError: vi.fn(),
  logExecutorInfo: vi.fn(),
  logExecutorWarn: vi.fn(),
  logProcessStep: vi.fn(),
  ensurePersistedProcessId: vi.fn(),
}));

vi.mock("../database/index", () => ({
  connectDB: tpslMocks.connectDB,
  Position: {
    find: tpslMocks.positionFind,
    findOneAndUpdate: tpslMocks.positionFindOneAndUpdate,
    countDocuments: tpslMocks.positionCountDocuments,
  },
  Account: {
    findById: tpslMocks.accountFindById,
  },
}));

vi.mock("./exchange/ExchangeFactory", () => ({
  ExchangeFactory: {
    getClientForAccount: tpslMocks.getClientForAccount,
    getPaperClient: tpslMocks.getPaperClient,
  },
  buildExchangeCredentials: tpslMocks.buildExchangeCredentials,
}));

vi.mock("./executor", () => ({
  splitQuantityForTPs: tpslMocks.splitQuantityForTPs,
}));

vi.mock("./pending-order-sync", () => ({
  inspectPendingLimitOrder: tpslMocks.inspectPendingLimitOrder,
}));

vi.mock("./log", () => ({
  logExecutorError: tpslMocks.logExecutorError,
  logExecutorInfo: tpslMocks.logExecutorInfo,
  logExecutorWarn: tpslMocks.logExecutorWarn,
  logProcessStep: tpslMocks.logProcessStep,
}));

vi.mock("./id", () => ({
  ensurePersistedProcessId: tpslMocks.ensurePersistedProcessId,
}));

import { runTpslMonitor } from "./tp-sl";

function createPosition(overrides: Record<string, unknown> = {}) {
  const position: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = {
    _id: { toString: () => "pos-1" },
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 2,
    entryPrice: 100,
    takeProfitTargets: [{ price: 120, status: "pending" }],
    stopLossPrice: 95,
    status: "pending",
    tpSlPlaced: false,
    accountId: undefined,
    save: vi.fn(),
  };
  Object.assign(position, overrides);
  position.save.mockResolvedValue(position);
  return position;
}

beforeEach(() => {
  tpslMocks.connectDB.mockReset();
  tpslMocks.positionFind.mockReset();
  tpslMocks.positionFindOneAndUpdate.mockReset();
  tpslMocks.positionCountDocuments.mockReset();
  tpslMocks.accountFindById.mockReset();
  tpslMocks.getClientForAccount.mockReset();
  tpslMocks.getPaperClient.mockReset();
  tpslMocks.buildExchangeCredentials.mockReset();
  tpslMocks.splitQuantityForTPs.mockReset();
  tpslMocks.inspectPendingLimitOrder.mockReset();
  tpslMocks.logExecutorError.mockReset();
  tpslMocks.logExecutorInfo.mockReset();
  tpslMocks.logExecutorWarn.mockReset();
  tpslMocks.logProcessStep.mockReset();
  tpslMocks.ensurePersistedProcessId.mockReset();

  tpslMocks.connectDB.mockResolvedValue(undefined);
  tpslMocks.logExecutorInfo.mockResolvedValue(undefined);
  tpslMocks.logExecutorWarn.mockResolvedValue(undefined);
  tpslMocks.logExecutorError.mockResolvedValue(undefined);
  tpslMocks.logProcessStep.mockResolvedValue(undefined);
  tpslMocks.ensurePersistedProcessId.mockResolvedValue("proc-1");
  tpslMocks.splitQuantityForTPs.mockResolvedValue([1, 1]);
});

test("runTpslMonitor handles live, cancelled, and filled pending positions and places TP/SL for claimed opens", async () => {
  const livePending = createPosition({ _id: { toString: () => "live-1" }, symbol: "BTCUSDT" });
  const cancelledPending = createPosition({ _id: { toString: () => "cancel-1" }, symbol: "ETHUSDT" });
  const filledPending = createPosition({ _id: { toString: () => "fill-1" }, symbol: "SOLUSDT" });
  const claimedOpen = createPosition({
    _id: { toString: () => "open-1" },
    symbol: "XRPUSDT",
    status: "open",
    quantity: 2,
    takeProfitTargets: [{ price: 0.7 }, { price: 0.8 }],
    stopLossPrice: 0.5,
  });

  const exchange = {
    name: "paper",
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 1, qtyDecimals: 0 }),
    placeTakeProfit: vi.fn()
      .mockResolvedValueOnce("tp-1")
      .mockResolvedValueOnce("tp-2"),
    placeStopLoss: vi.fn().mockResolvedValue("sl-1"),
  };
  tpslMocks.getPaperClient.mockReturnValue(exchange);
  tpslMocks.positionFind.mockResolvedValue([livePending, cancelledPending, filledPending]);
  tpslMocks.inspectPendingLimitOrder
    .mockResolvedValueOnce({ type: "live", reason: "still open" })
    .mockResolvedValueOnce({ type: "cancelled", reason: "cancelled on exchange" })
    .mockResolvedValueOnce({ type: "filled", reason: "filled on exchange", fillPrice: 123 });
  tpslMocks.positionFindOneAndUpdate
    .mockResolvedValueOnce(claimedOpen)
    .mockResolvedValueOnce(null);
  tpslMocks.positionCountDocuments.mockResolvedValue(4);
  tpslMocks.splitQuantityForTPs.mockResolvedValue([1, 1]);

  const result = await runTpslMonitor();

  assert.deepEqual(result, {
    checked: 4,
    promoted: 1,
    tpslPlaced: 1,
    errors: [],
  });
  assert.equal(cancelledPending.status, "closed");
  assert.equal(cancelledPending.tpSlPlaced, true);
  assert.equal(filledPending.status, "open");
  assert.equal(filledPending.entryPrice, 123);
  assert.equal(claimedOpen.tpSlPlaced, true);
  assert.equal(exchange.placeTakeProfit.mock.calls.length, 2);
  assert.equal(exchange.placeStopLoss.mock.calls.length, 1);
});

test("runTpslMonitor marks positions without TP/SL targets as placed and recovers from placement failures", async () => {
  const noTargets = createPosition({
    _id: { toString: () => "open-no-targets" },
    status: "open",
    symbol: "ADAUSDT",
    takeProfitTargets: [],
    stopLossPrice: undefined,
  });
  const failingClaim = createPosition({
    _id: { toString: () => "open-fail" },
    status: "open",
    symbol: "DOGEUSDT",
    takeProfitTargets: [{ price: 0.2 }],
    stopLossPrice: 0.1,
  });

  const exchange = {
    name: "paper",
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 1, qtyDecimals: 0 }),
    placeTakeProfit: vi.fn().mockRejectedValue(new Error("tp failed")),
    placeStopLoss: vi.fn().mockRejectedValue(new Error("sl failed")),
  };
  tpslMocks.getPaperClient.mockReturnValue(exchange);
  tpslMocks.positionFind.mockResolvedValue([]);
  tpslMocks.positionFindOneAndUpdate
    .mockResolvedValueOnce(noTargets)
    .mockResolvedValueOnce(failingClaim)
    .mockResolvedValueOnce(null);
  tpslMocks.positionCountDocuments.mockResolvedValue(1);
  tpslMocks.splitQuantityForTPs.mockResolvedValue([1]);

  const result = await runTpslMonitor();

  assert.deepEqual(result, {
    checked: 2,
    promoted: 0,
    tpslPlaced: 2,
    errors: [],
  });
  assert.equal(noTargets.tpSlPlaced, true);
  assert.equal(failingClaim.tpSlPlaced, true);
  assert.equal(
    tpslMocks.logExecutorWarn.mock.calls.some((call) =>
      String(call[0]).includes("Failed to place TP"),
    ),
    true,
  );
  assert.equal(
    tpslMocks.logExecutorWarn.mock.calls.some((call) =>
      String(call[0]).includes("Failed to place SL"),
    ),
    true,
  );
});

test("runTpslMonitor releases claimed positions and reports general errors", async () => {
  const failedClaim = createPosition({
    _id: { toString: () => "failed-claim" },
    status: "open",
    symbol: "BNBUSDT",
    tpSlPlaced: true,
    takeProfitTargets: [{ price: 700 }],
  });

  const exchange = {
    name: "paper",
    getInstrumentSpecs: vi.fn().mockRejectedValue(new Error("no specs")),
    placeTakeProfit: vi.fn().mockResolvedValue("tp-1"),
    placeStopLoss: vi.fn().mockResolvedValue("sl-1"),
  };
  tpslMocks.getPaperClient.mockReturnValue(exchange);
  tpslMocks.positionFind.mockRejectedValueOnce(new Error("pending query failed"));

  const general = await runTpslMonitor();
  assert.deepEqual(general, {
    checked: 0,
    promoted: 0,
    tpslPlaced: 0,
    errors: ["General: pending query failed"],
  });

  tpslMocks.positionFind.mockResolvedValue([]);
  tpslMocks.positionFindOneAndUpdate
    .mockResolvedValueOnce(failedClaim)
    .mockResolvedValueOnce(null);
  tpslMocks.positionCountDocuments.mockResolvedValue(0);
  tpslMocks.splitQuantityForTPs.mockRejectedValueOnce(new Error("split failed"));

  const recovered = await runTpslMonitor();

  assert.deepEqual(recovered, {
    checked: 1,
    promoted: 0,
    tpslPlaced: 0,
    errors: ["TP/SL BNBUSDT: split failed"],
  });
  assert.equal(failedClaim.tpSlPlaced, false);
  assert.equal(failedClaim.save.mock.calls.length > 0, true);
});

test("runTpslMonitor checks TP hit and moves SL to breakeven", async () => {
  const tpPosition = createPosition({
    _id: { toString: () => "tp-hit-1" },
    symbol: "HITUSDT",
    status: "open",
    side: "LONG",
    quantity: 4,
    entryPrice: 100,
    stopLossPrice: 95,
    takeProfitTargets: [
      { price: 110, quantity: 2, percentage: 50, status: "pending" },
      { price: 120, quantity: 2, percentage: 50, status: "pending" }
    ]
  });

  tpslMocks.positionFind.mockResolvedValue([tpPosition]);
  tpslMocks.positionFindOneAndUpdate.mockResolvedValue(null);
  tpslMocks.positionCountDocuments.mockResolvedValue(0);

  const exchange = {
    name: "paper",
    getInstrumentSpecs: vi.fn().mockResolvedValue({ lotSz: 1, qtyDecimals: 0 }),
    getOpenPositions: vi.fn().mockResolvedValue([
      { symbol: "HITUSDT", quantity: 2, markPrice: 111 }
    ]),
    getAlgoOrders: vi.fn().mockResolvedValue([
      { orderId: "sl-old-1", symbol: "HITUSDT", type: "sl", side: "SELL" }
    ]),
    cancelOrder: vi.fn().mockResolvedValue(true),
    placeStopLoss: vi.fn().mockResolvedValue("sl-new-1"),
    clearPositionStopLoss: vi.fn().mockResolvedValue(undefined),
  };
  tpslMocks.getPaperClient.mockReturnValue(exchange);

  await runTpslMonitor();

  assert.equal(tpPosition.takeProfitTargets[0].status, "hit");
  assert.equal(tpPosition.stopLossPrice, 100);
  assert.equal(tpPosition.quantity, 2);
  assert.ok(tpPosition.save.mock.calls.length > 0);
  assert.equal(exchange.placeStopLoss.mock.calls.length, 1);
  assert.deepEqual(exchange.placeStopLoss.mock.calls[0], [
    "HITUSDT",
    100,
    100,
    "SELL",
    2
  ]);
});
