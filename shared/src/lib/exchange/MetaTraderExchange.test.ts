import assert from "node:assert/strict";
import { test } from "vitest";
import { MetaTraderExchange } from "./MetaTraderExchange";
import { ExchangeOrderType, OrderSide } from "../enums";

function createExchange() {
  return new MetaTraderExchange({
    baseUrl: "https://mt.example.com/",
    login: " login ",
    password: " password ",
    server: " server ",
    platform: "MT5",
    bridgeToken: " token ",
  }) as any;
}

test("metatrader account, ticker, klines, and instrument specs are normalized", async () => {
  const exchange = createExchange();

  exchange.client.request = async ({ url }: { url: string }) => {
    if (url === "/account") {
      return {
        data: {
          account: {
            equity: "1100",
            availableBalance: "800",
            pnl: "25",
            currency: "USD",
          },
        },
      };
    }
    if (url === "/ticker") {
      return { data: { ticker: { bid: "65000.5" } } };
    }
    if (url === "/klines") {
      return {
        data: {
          klines: [
            { time: "100", open: "10", high: "12", low: "9", close: "11", volume: "5" },
          ],
        },
      };
    }
    return {
      data: {
        instrument: {
          contractSize: "100000",
          lotStep: "0.01",
          minLot: "0.1",
          tickSize: "0.0001",
          baseCurrency: "EUR",
        },
      },
    };
  };

  assert.deepEqual(await exchange.getAccountInfo(), {
    totalBalance: 1100,
    availableBalance: 800,
    unrealizedPnl: 25,
    currency: "USD",
  });
  assert.equal(await exchange.getTickerPrice("eurusd"), 65000.5);
  assert.deepEqual(await exchange.getKlines("eurusd", "1h", 1), [
    { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 5 },
  ]);
  assert.deepEqual(await exchange.getInstrumentSpecs("eurusd"), {
    ctVal: 100000,
    lotSz: 0.01,
    minSz: 0.1,
    ctValCcy: "EUR",
    tickSz: 0.0001,
    qtyDecimals: 2,
    priceDecimals: 4,
  });
});

test("metatrader request wrapper builds headers and surfaces axios and generic errors", async () => {
  const exchange = createExchange();
  let capturedHeaders: Record<string, string> | undefined;

  exchange.client.request = async (config: { headers?: Record<string, string> }) => {
    capturedHeaders = config.headers;
    return { data: { ok: true } };
  };

  assert.deepEqual(await exchange.request("GET", "/ping"), { ok: true });
  assert.deepEqual(capturedHeaders, {
    "X-MT-LOGIN": "login",
    "X-MT-PASSWORD": "password",
    "X-MT-SERVER": "server",
    "X-MT-PLATFORM": "mt5",
    Authorization: "Bearer token",
  });

  exchange.client.request = async () => {
    throw {
      isAxiosError: true,
      response: { status: 503, data: { message: "down" } },
      message: "Request failed",
    };
  };
  await assert.rejects(
    () => exchange.request("POST", "/orders"),
    /\[MetaTrader\] POST \/orders failed \(HTTP 503\): {"message":"down"}/,
  );

  exchange.client.request = async () => {
    throw new Error("boom");
  };
  await assert.rejects(
    () => exchange.request("GET", "/ticker"),
    /\[MetaTrader\] GET \/ticker failed: boom/,
  );
});

test("metatrader positions, open orders, and history map broker rows into normalized structures", async () => {
  const exchange = createExchange();

  exchange.client.request = async ({ url }: { url: string }) => {
    if (url === "/positions") {
      return {
        data: {
          positions: [
            {
              id: 1,
              symbol: "eurusd",
              side: "sell",
              quantity: "1.5",
              openPrice: "1.1",
              currentPrice: "1.2",
              pnl: "-15",
              margin: "100",
              leverage: "20",
            },
          ],
        },
      };
    }
    if (url === "/orders/open") {
      return {
        data: {
          orders: [
            {
              id: 2,
              symbol: "eurusd",
              side: "buy",
              orderType: "limit",
              price: "1.15",
              quantity: "2",
              filledQuantity: "0.5",
              status: "working",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      };
    }
    return {
      data: {
        orders: [
          {
            id: 3,
            symbol: "eurusd",
            side: "sell",
            orderType: "market",
            price: "1.13",
            quantity: "1",
            executedQty: "1",
            commission: "2",
            profit: "7",
            status: "closed",
            time: "2026-01-02T00:00:00Z",
          },
        ],
      },
    };
  };

  assert.deepEqual(await exchange.getOpenPositions(), [
    {
      symbol: "EURUSD",
      positionId: "1",
      side: "SHORT",
      leverage: 20,
      marginType: "cross",
      entryPrice: 1.1,
      quantity: 1.5,
      margin: 100,
      unrealizedPnl: -15,
      liquidationPrice: 0,
      markPrice: 1.2,
      raw: {
        id: 1,
        symbol: "eurusd",
        side: "sell",
        quantity: "1.5",
        openPrice: "1.1",
        currentPrice: "1.2",
        pnl: "-15",
        margin: "100",
        leverage: "20",
      },
    },
  ]);
  assert.deepEqual(await exchange.getOpenOrders("eurusd"), [
    {
      orderId: "2",
      symbol: "EURUSD",
      side: "BUY",
      type: "limit",
      price: 1.15,
      quantity: 2,
      filledQuantity: 0.5,
      status: "working",
      createdAt: Date.parse("2026-01-01T00:00:00Z"),
      raw: {
        id: 2,
        symbol: "eurusd",
        side: "buy",
        orderType: "limit",
        price: "1.15",
        quantity: "2",
        filledQuantity: "0.5",
        status: "working",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
  ]);
  assert.deepEqual(await exchange.getOrderHistory("eurusd", 10), [
    {
      orderId: "3",
      symbol: "EURUSD",
      side: "SELL",
      type: "market",
      price: 1.13,
      quantity: 1,
      filledQuantity: 1,
      fee: 2,
      realizedPnl: 7,
      status: "closed",
      createdAt: Date.parse("2026-01-02T00:00:00Z"),
      updatedAt: Date.parse("2026-01-02T00:00:00Z"),
      raw: {
        id: 3,
        symbol: "eurusd",
        side: "sell",
        orderType: "market",
        price: "1.13",
        quantity: "1",
        executedQty: "1",
        commission: "2",
        profit: "7",
        status: "closed",
        time: "2026-01-02T00:00:00Z",
      },
    },
  ]);
});

test("metatrader placeOrder, closePosition, and closeAllPositions cover success and error paths", async () => {
  const exchange = createExchange();

  exchange.client.request = async ({ url }: { url: string }) => {
    if (url === "/orders") {
      return { data: { order: { id: 10, price: "1.25", quantity: "2", status: "submitted" } } };
    }
    return { data: {} };
  };

  assert.deepEqual(
    await exchange.placeOrder({
      symbol: "eurusd",
      side: OrderSide.BUY,
      type: ExchangeOrderType.MARKET,
      quantity: 2,
      price: 1.25,
    }),
    {
      orderId: "10",
      price: 1.25,
      quantity: 2,
      status: "submitted",
      raw: { id: 10, price: "1.25", quantity: "2", status: "submitted" },
    },
  );

  await exchange.closePosition("eurusd", "1", 2);

  exchange.getOpenPositions = async () => [
    { symbol: "EURUSD", side: "LONG" },
    { symbol: "GBPUSD", side: "SHORT" },
  ];
  exchange.request = async (method: string, path: string) => {
    if (method === "POST" && path === "/positions/close-all") return {};
    throw new Error("unexpected");
  };
  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: ["EURUSD (LONG)", "GBPUSD (SHORT)"],
    errors: [],
  });

  exchange.getOpenPositions = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: [],
    errors: ["offline"],
  });
});

test("metatrader leverage and ticker helpers cover fallback branches", async () => {
  const exchange = createExchange();

  exchange.request = async () => {
    throw new Error("not mutable");
  };
  assert.equal(await exchange.setLeverage("eurusd", 30), 30);

  exchange.request = async () => ({ data: {} });
  await assert.rejects(
    () => exchange.getTickerPrice("eurusd"),
    /Ticker not found on MetaTrader bridge for eurusd/,
  );
});

test("metatrader position protection helpers update and clear synthetic protection orders", async () => {
  const exchange = createExchange();
  const payloads: Array<Record<string, unknown>> = [];

  exchange.request = async (
    method: string,
    path: string,
    options?: { data?: Record<string, unknown> },
  ) => {
    if (method === "GET" && path === "/positions") {
      return {
        positions: [
          {
            positionId: "p1",
            symbol: "eurusd",
            quantity: "1",
            side: "buy",
            stopLoss: "1.05",
            takeProfit: "1.25",
          },
        ],
      };
    }
    payloads.push(options?.data || {});
    return {};
  };

  assert.equal(await exchange.placeStopLoss("eurusd", 1.04, 0, OrderSide.SELL, 1), "p1");
  assert.equal(await exchange.placeTakeProfit("eurusd", 1.3, 0, OrderSide.SELL, 1), "p1");
  assert.equal(await exchange.cancelOrder("mt-sl:p1", "eurusd"), true);
  assert.equal(await exchange.cancelOrder("mt-tp:p1", "eurusd"), true);

  assert.deepEqual(payloads, [
    { symbol: "EURUSD", positionId: "p1", stopLoss: 1.04, takeProfit: undefined },
    { symbol: "EURUSD", positionId: "p1", stopLoss: undefined, takeProfit: 1.3 },
    { symbol: "EURUSD", positionId: "p1", stopLoss: null, takeProfit: undefined },
    { symbol: "EURUSD", positionId: "p1", stopLoss: undefined, takeProfit: null },
  ]);
});

test("metatrader protection helpers error when no position exists and cancelOrder handles not-found", async () => {
  const exchange = createExchange();

  exchange.request = async (method: string, path: string) => {
    if (method === "GET" && path === "/positions") return { positions: [] };
    throw new Error("not found");
  };

  await assert.rejects(
    () => exchange.placeStopLoss("eurusd", 1.1, 0, OrderSide.SELL, 1),
    /No open MetaTrader position found for eurusd/,
  );

  assert.equal(await exchange.cancelOrder("plain", "eurusd"), false);
});

test("metatrader algo orders and algo cancellation use position protections", async () => {
  const exchange = createExchange();

  exchange.request = async (
    method: string,
    path: string,
    options?: { data?: Record<string, unknown> },
  ) => {
    if (method === "GET" && path === "/positions") {
      return {
        positions: [
          {
            positionId: "p1",
            symbol: "eurusd",
            quantity: "1",
            side: "buy",
            stopLoss: "1.05",
            takeProfit: "1.25",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      };
    }

    if (method === "POST" && path === "/positions/protection") {
      if (options?.data?.positionId === "p1") return {};
      throw new Error("bad position");
    }

    throw new Error("unexpected");
  };

  assert.deepEqual(await exchange.getAlgoOrders("eurusd"), [
    {
      orderId: "mt-sl:p1",
      symbol: "EURUSD",
      side: "SELL",
      type: "sl",
      triggerPrice: 1.05,
      quantity: 1,
      status: "active",
      createdAt: Date.parse("2026-01-01T00:00:00Z"),
      raw: {
        positionId: "p1",
        symbol: "eurusd",
        quantity: "1",
        side: "buy",
        stopLoss: "1.05",
        takeProfit: "1.25",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
    {
      orderId: "mt-tp:p1",
      symbol: "EURUSD",
      side: "SELL",
      type: "tp",
      triggerPrice: 1.25,
      quantity: 1,
      status: "active",
      createdAt: Date.parse("2026-01-01T00:00:00Z"),
      raw: {
        positionId: "p1",
        symbol: "eurusd",
        quantity: "1",
        side: "buy",
        stopLoss: "1.05",
        takeProfit: "1.25",
        createdAt: "2026-01-01T00:00:00Z",
      },
    },
  ]);

  assert.deepEqual(await exchange.cancelAlgoOrders("eurusd"), {
    cancelled: ["p1"],
    errors: [],
  });

  exchange.request = async () => {
    throw new Error("bridge down");
  };
  assert.deepEqual(await exchange.cancelAlgoOrders("eurusd"), {
    cancelled: [],
    errors: ["bridge down"],
  });
});
