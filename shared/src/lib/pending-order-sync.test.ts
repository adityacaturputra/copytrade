import { test } from "vitest";
import assert from "node:assert/strict";
import { inspectPendingLimitOrder } from "./pending-order-sync";
import { ExchangeClient } from "./exchange/types";

function createExchangeMock(overrides: Partial<ExchangeClient>): ExchangeClient {
  return {
    name: "mock",
    getAccountInfo: async () => ({
      totalBalance: 0,
      availableBalance: 0,
      unrealizedPnl: 0,
      currency: "USDT",
    }),
    getTickerPrice: async () => 0,
    getKlines: async () => [],
    getOpenPositions: async () => [],
    placeOrder: async () => ({
      orderId: "1",
      price: 0,
      quantity: 0,
      status: "NEW",
    }),
    closePosition: async () => {},
    closeAllPositions: async () => ({ closed: [], errors: [] }),
    setLeverage: async (_symbol, leverage) => leverage,
    placeStopLoss: async () => "sl-1",
    placeTakeProfit: async () => "tp-1",
    getOpenOrders: async () => [],
    cancelOrder: async () => true,
    getAlgoOrders: async () => [],
    cancelAlgoOrders: async () => ({ cancelled: [], errors: [] }),
    getOrderHistory: async () => [],
    getInstrumentSpecs: async () => ({
      ctVal: 1,
      lotSz: 0.001,
      minSz: 0.001,
      ctValCcy: "USDT",
      tickSz: 0.1,
      qtyDecimals: 3,
      priceDecimals: 1,
    }),
    ...overrides,
  };
}

test("inspectPendingLimitOrder keeps order pending when open order id matches as string", async () => {
  const exchange = createExchangeMock({
    getOpenOrders: async () => [
      {
        orderId: "13037313837",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 0.02,
        filledQuantity: 0,
        status: "NEW",
      },
    ],
  });

  const inspection = await inspectPendingLimitOrder(exchange, {
    symbol: "BTCUSDT",
    side: "LONG",
    orderId: "13037313837",
    openedAt: new Date(),
  } as any);

  assert.equal(inspection.type, "live");
});

test("inspectPendingLimitOrder keeps order pending when history state is NEW", async () => {
  const exchange = createExchangeMock({
    getOrderHistory: async () => [
      {
        orderId: "13037313837",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: 67082,
        quantity: 0.02,
        filledQuantity: 0,
        fee: 0,
        status: "NEW",
        createdAt: Date.now(),
      },
    ],
  });

  const inspection = await inspectPendingLimitOrder(exchange, {
    symbol: "BTCUSDT",
    side: "LONG",
    orderId: "13037313837",
    openedAt: new Date(),
  } as any);

  assert.equal(inspection.type, "live");
});

test("inspectPendingLimitOrder gives recent invisible orders a grace period", async () => {
  const exchange = createExchangeMock({});

  const inspection = await inspectPendingLimitOrder(exchange, {
    symbol: "BTCUSDT",
    side: "LONG",
    orderId: "13037313837",
    openedAt: new Date(Date.now() - 30_000),
  } as any);

  assert.equal(inspection.type, "live");
});

test("inspectPendingLimitOrder detects filled order via same-side open position", async () => {
  const exchange = createExchangeMock({
    getOpenPositions: async () => [
      {
        symbol: "BTCUSDT",
        positionId: "BTCUSDT:BOTH",
        side: "LONG",
        leverage: 10,
        marginType: "isolated",
        entryPrice: 67082,
        quantity: 0.02,
        margin: 10,
        unrealizedPnl: 0,
        liquidationPrice: 64000,
        markPrice: 67100,
      },
    ],
  });

  const inspection = await inspectPendingLimitOrder(exchange, {
    symbol: "BTCUSDT",
    side: "LONG",
    orderId: "13037313837",
    openedAt: new Date(Date.now() - 10 * 60 * 1000),
  } as any);

  assert.equal(inspection.type, "filled");
});

test("inspectPendingLimitOrder cancels only after grace period and no exchange evidence", async () => {
  const exchange = createExchangeMock({});

  const inspection = await inspectPendingLimitOrder(exchange, {
    symbol: "BTCUSDT",
    side: "LONG",
    orderId: "13037313837",
    openedAt: new Date(Date.now() - 10 * 60 * 1000),
  } as any);

  assert.equal(inspection.type, "cancelled");
});

test("inspectPendingLimitOrder keeps OKX live history state pending", async () => {
  const exchange = createExchangeMock({
    getOrderHistory: async () => [
      {
        orderId: "okx-123",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "limit",
        price: 67082,
        quantity: 0.02,
        filledQuantity: 0,
        fee: 0,
        status: "live",
        createdAt: Date.now(),
        raw: { state: "live" },
      },
    ],
  });

  const inspection = await inspectPendingLimitOrder(exchange, {
    symbol: "BTCUSDT",
    side: "LONG",
    orderId: "okx-123",
    openedAt: new Date(Date.now() - 10 * 60 * 1000),
  } as any);

  assert.equal(inspection.type, "live");
});

test("inspectPendingLimitOrder detects OKX short fill via same-side position", async () => {
  const exchange = createExchangeMock({
    getOpenPositions: async () => [
      {
        symbol: "BTCUSDT",
        positionId: "okx-short-1",
        side: "SHORT",
        leverage: 10,
        marginType: "isolated",
        entryPrice: 67082,
        quantity: 0.02,
        margin: 10,
        unrealizedPnl: 0,
        liquidationPrice: 70000,
        markPrice: 66900,
      },
    ],
  });

  const inspection = await inspectPendingLimitOrder(exchange, {
    symbol: "BTCUSDT",
    side: "SHORT",
    orderId: "okx-456",
    openedAt: new Date(Date.now() - 10 * 60 * 1000),
  } as any);

  assert.equal(inspection.type, "filled");
});
