import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const resetMocks = vi.hoisted(() => ({
  getPaperClient: vi.fn(),
  getClientForAccount: vi.fn(),
  buildExchangeCredentials: vi.fn(),
  exchangeProviderRequiresCredentials: vi.fn(),
  normalizeExchangeProvider: vi.fn(),
}));

vi.mock("./ExchangeFactory", () => ({
  ExchangeFactory: {
    getPaperClient: resetMocks.getPaperClient,
    getClientForAccount: resetMocks.getClientForAccount,
  },
  buildExchangeCredentials: resetMocks.buildExchangeCredentials,
  exchangeProviderRequiresCredentials: resetMocks.exchangeProviderRequiresCredentials,
  normalizeExchangeProvider: resetMocks.normalizeExchangeProvider,
}));

import { resetExchangeAccountState } from "./reset-account-state";

function createExchangeMock() {
  return {
    name: "mock",
    getAccountInfo: vi.fn(),
    getTickerPrice: vi.fn(),
    getKlines: vi.fn(),
    getOpenPositions: vi.fn(),
    placeOrder: vi.fn(),
    closePosition: vi.fn(),
    closeAllPositions: vi.fn(),
    setLeverage: vi.fn(),
    placeStopLoss: vi.fn(),
    placeTakeProfit: vi.fn(),
    getOpenOrders: vi.fn(),
    cancelOrder: vi.fn(),
    getAlgoOrders: vi.fn(),
    cancelAlgoOrders: vi.fn(),
    getOrderHistory: vi.fn(),
    getInstrumentSpecs: vi.fn(),
  };
}

beforeEach(() => {
  resetMocks.getPaperClient.mockReset();
  resetMocks.getClientForAccount.mockReset();
  resetMocks.buildExchangeCredentials.mockReset();
  resetMocks.exchangeProviderRequiresCredentials.mockReset();
  resetMocks.normalizeExchangeProvider.mockReset();

  resetMocks.normalizeExchangeProvider.mockImplementation(
    (provider) => String(provider || "paper").toLowerCase(),
  );
  resetMocks.exchangeProviderRequiresCredentials.mockReturnValue(false);
});

test("resetExchangeAccountState skips providers with missing credentials or unsupported config", async () => {
  resetMocks.normalizeExchangeProvider
    .mockReturnValueOnce("binance")
    .mockReturnValueOnce("okx");
  resetMocks.exchangeProviderRequiresCredentials
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(false);
  resetMocks.buildExchangeCredentials.mockReturnValueOnce(null);

  const missingCredentials = await resetExchangeAccountState({
    name: "Binance VIP",
    tradingPlatform: "binance",
    exchangeData: null,
  });
  const unsupported = await resetExchangeAccountState({
    name: "Mystery account",
    tradingPlatform: "okx",
    exchangeData: { apiKey: "x" },
  });

  assert.equal(missingCredentials.status, "skipped");
  assert.equal(missingCredentials.provider, "binance");
  assert.equal(missingCredentials.message, "No exchange credentials configured");
  assert.equal(unsupported.status, "skipped");
  assert.equal(unsupported.message, "Unsupported exchange provider");
  assert.equal(resetMocks.getClientForAccount.mock.calls.length, 0);
});

test("resetExchangeAccountState uses the paper client and reports empty success state", async () => {
  const exchange = createExchangeMock();
  exchange.getOpenOrders.mockResolvedValue([]);
  exchange.getAlgoOrders.mockResolvedValue([]);
  exchange.getOpenPositions.mockResolvedValue([]);
  exchange.closeAllPositions.mockResolvedValue({ closed: [], errors: [] });
  resetMocks.normalizeExchangeProvider.mockReturnValue("paper");
  resetMocks.getPaperClient.mockReturnValue(exchange);

  const result = await resetExchangeAccountState({
    name: "Paper account",
    tradingPlatform: "paper",
  });

  assert.equal(result.provider, "paper");
  assert.equal(result.status, "success");
  assert.equal(
    result.message,
    "Reset 0 order(s), 0 algo order(s), 0 position(s); cancelled 0 order(s), 0 algo order(s), closed 0 position(s)",
  );
  assert.deepEqual(result.details, [
    "Open orders: 0",
    "Algo orders: 0",
    "Open positions: 0",
  ]);
  assert.equal(resetMocks.getPaperClient.mock.calls.length, 1);
});

test("resetExchangeAccountState dry-run summarizes unique symbols and planned actions", async () => {
  const exchange = createExchangeMock();
  exchange.getOpenOrders.mockResolvedValue([
    { orderId: "o1", symbol: "BTCUSDT" },
    { orderId: "o2", symbol: " ETHUSDT " },
  ]);
  exchange.getAlgoOrders.mockResolvedValue([
    { orderId: "a1", symbol: "BTCUSDT" },
  ]);
  exchange.getOpenPositions.mockResolvedValue([
    { symbol: "BTCUSDT" },
    { symbol: "XRPUSDT" },
  ]);
  resetMocks.buildExchangeCredentials.mockReturnValue({ provider: "binance" });
  resetMocks.getClientForAccount.mockReturnValue(exchange);

  const result = await resetExchangeAccountState(
    {
      name: "Binance account",
      tradingPlatform: "binance",
      exchangeData: { apiKey: "k" },
    },
    { dryRun: true },
  );

  assert.equal(result.status, "success");
  assert.equal(result.cancelledOrders, 2);
  assert.equal(result.cancelledAlgoOrders, 1);
  assert.equal(result.closedPositions, 2);
  assert.equal(
    result.message,
    "Would reset 2 order(s), 1 algo order(s), 2 position(s)",
  );
  assert.match(result.details[3] || "", /would cancel 2 open order/);
  assert.match(result.details[4] || "", /across 3 symbol/);
  assert.match(result.details[5] || "", /would close 2 position/);
  assert.equal(exchange.cancelOrder.mock.calls.length, 0);
  assert.equal(exchange.cancelAlgoOrders.mock.calls.length, 0);
  assert.equal(exchange.closeAllPositions.mock.calls.length, 0);
});

test("resetExchangeAccountState cancels orders, algo orders, and positions during a successful reset", async () => {
  const exchange = createExchangeMock();
  exchange.getOpenOrders.mockResolvedValue([
    { orderId: "o1", symbol: "BTCUSDT" },
    { orderId: "o2", symbol: "ETHUSDT" },
  ]);
  exchange.getAlgoOrders.mockResolvedValue([
    { orderId: "a1", symbol: "BTCUSDT" },
  ]);
  exchange.getOpenPositions.mockResolvedValue([
    { symbol: "ETHUSDT" },
  ]);
  exchange.cancelOrder.mockResolvedValue(true);
  exchange.cancelAlgoOrders
    .mockResolvedValueOnce({ cancelled: ["a1"], errors: [] })
    .mockResolvedValueOnce({ cancelled: ["eth-tp"], errors: [] });
  exchange.closeAllPositions.mockResolvedValue({
    closed: ["BTCUSDT", "ETHUSDT"],
    errors: [],
  });
  resetMocks.buildExchangeCredentials.mockReturnValue({ provider: "bybit" });
  resetMocks.getClientForAccount.mockReturnValue(exchange);

  const result = await resetExchangeAccountState({
    name: "Bybit account",
    tradingPlatform: "bybit",
    exchangeData: { apiKey: "k" },
  });

  assert.equal(result.status, "success");
  assert.equal(result.cancelledOrders, 2);
  assert.equal(result.cancelledAlgoOrders, 2);
  assert.equal(result.closedPositions, 2);
  assert.equal(exchange.cancelOrder.mock.calls.length, 2);
  assert.deepEqual(exchange.cancelOrder.mock.calls[0], ["o1", "BTCUSDT"]);
  assert.deepEqual(exchange.cancelAlgoOrders.mock.calls, [
    ["BTCUSDT"],
    ["ETHUSDT"],
  ]);
  assert.match(result.details.join("\n"), /Cancelled algo orders for BTCUSDT: 1/);
  assert.match(result.details.join("\n"), /Closed positions: BTCUSDT, ETHUSDT/);
});

test("resetExchangeAccountState aggregates fetch, cancel, algo, and close failures into an error result", async () => {
  const exchange = createExchangeMock();
  exchange.getOpenOrders.mockRejectedValue(new Error("orders offline"));
  exchange.getAlgoOrders.mockResolvedValue([
    { orderId: "a1", symbol: "BTCUSDT" },
  ]);
  exchange.getOpenPositions.mockResolvedValue([
    { symbol: "BTCUSDT" },
    { symbol: "SOLUSDT" },
  ]);
  exchange.cancelAlgoOrders
    .mockResolvedValueOnce({ cancelled: [], errors: ["already gone"] })
    .mockRejectedValueOnce(new Error("algo service down"));
  exchange.closeAllPositions.mockRejectedValue(new Error("cannot close"));
  resetMocks.buildExchangeCredentials.mockReturnValue({ provider: "okx" });
  resetMocks.getClientForAccount.mockReturnValue(exchange);

  const result = await resetExchangeAccountState({
    name: "OKX account",
    tradingPlatform: "okx",
    exchangeData: { apiKey: "k" },
  });

  assert.equal(result.status, "error");
  assert.equal(result.openOrders, 0);
  assert.equal(result.algoOrders, 1);
  assert.equal(result.openPositions, 2);
  assert.equal(result.cancelledAlgoOrders, 0);
  assert.equal(result.algoCancelErrors, 2);
  assert.equal(result.positionCloseErrors, 1);
  assert.match(result.message, /Reset 0 order\(s\), 1 algo order\(s\), 2 position\(s\)/);
  assert.match(result.details.join("\n"), /Failed to fetch open orders: orders offline/);
  assert.match(result.details.join("\n"), /Algo cancel errors for BTCUSDT: already gone/);
  assert.match(result.details.join("\n"), /Algo reset failed for SOLUSDT: algo service down/);
  assert.match(result.details.join("\n"), /Failed to close positions: cannot close/);
});

test("resetExchangeAccountState records per-order cancellation failures", async () => {
  const exchange = createExchangeMock();
  exchange.getOpenOrders.mockResolvedValue([
    { orderId: "o1", symbol: "BTCUSDT" },
    { orderId: "o2", symbol: "ETHUSDT" },
  ]);
  exchange.getAlgoOrders.mockResolvedValue([]);
  exchange.getOpenPositions.mockResolvedValue([]);
  exchange.cancelOrder
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("cancel denied"));
  exchange.closeAllPositions.mockResolvedValue({ closed: [], errors: [] });
  resetMocks.buildExchangeCredentials.mockReturnValue({ provider: "binance" });
  resetMocks.getClientForAccount.mockReturnValue(exchange);

  const result = await resetExchangeAccountState({
    name: "Binance account",
    tradingPlatform: "binance",
    exchangeData: { apiKey: "k" },
  });

  assert.equal(result.status, "error");
  assert.equal(result.cancelledOrders, 0);
  assert.equal(result.orderCancelErrors, 2);
  assert.match(result.details.join("\n"), /Order not cancelled: BTCUSDT#o1/);
  assert.match(
    result.details.join("\n"),
    /Cancel order failed for ETHUSDT#o2: cancel denied/,
  );
});
