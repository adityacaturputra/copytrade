import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { MetaTraderExchange } from "./metatrader/index";
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
    /\[MetaTrader\] POST \/orders failed status=503: down \| payload=\{\} \| response=\{"message":"down"\}/,
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

test("metatrader private mappers and extractors cover data-array and fallback branches", () => {
  const exchange = createExchange();
  const now = Date.now;
  Date.now = () => 123456789;

  try {
    assert.deepEqual(exchange.extractArray({ data: [{ id: 1 }] }, ["orders"]), [{ id: 1 }]);
    assert.deepEqual(exchange.extractArray("bad-payload", ["orders"]), []);
    assert.deepEqual(exchange.extractObject("bad-payload", ["account"]), {});

    assert.deepEqual(
      exchange.mapPosition({
        ticket: 7,
        symbol: "eurusd",
        type: 1,
        lots: "2",
        priceOpen: "1.2",
        priceCurrent: "1.3",
        profit: "8",
        leverage: "0",
      }),
      {
        symbol: "EURUSD",
        positionId: "7",
        side: "SHORT",
        leverage: 1,
        marginType: "cross",
        entryPrice: 1.2,
        quantity: 2,
        margin: 0,
        unrealizedPnl: 8,
        liquidationPrice: 0,
        markPrice: 1.3,
        raw: {
          ticket: 7,
          symbol: "eurusd",
          type: 1,
          lots: "2",
          priceOpen: "1.2",
          priceCurrent: "1.3",
          profit: "8",
          leverage: "0",
        },
      },
    );

    assert.deepEqual(
      exchange.mapOpenOrder({
        ticket: 8,
        symbol: "eurusd",
        type: "sell_stop",
        openPrice: "1.1",
        lots: "3",
        executedQty: "1.2",
        state: "pending",
        time: "100",
      }),
      {
        orderId: "8",
        symbol: "EURUSD",
        side: "SELL",
        type: "sell_stop",
        price: 1.1,
        quantity: 3,
        filledQuantity: 1.2,
        status: "pending",
        createdAt: 100,
        raw: {
          ticket: 8,
          symbol: "eurusd",
          type: "sell_stop",
          openPrice: "1.1",
          lots: "3",
          executedQty: "1.2",
          state: "pending",
          time: "100",
        },
      },
    );

    assert.deepEqual(
      exchange.mapHistoricalOrder({
        ticket: 9,
        symbol: "eurusd",
        side: "buy",
        openPrice: "1.05",
        volume: "4",
        commission: "1",
        pnl: "5",
        state: "done",
      }),
      {
        orderId: "9",
        symbol: "EURUSD",
        side: "BUY",
        type: "unknown",
        price: 1.05,
        quantity: 4,
        filledQuantity: 4,
        fee: 1,
        realizedPnl: 5,
        status: "done",
        createdAt: 123456789,
        updatedAt: undefined,
        raw: {
          ticket: 9,
          symbol: "eurusd",
          side: "buy",
          openPrice: "1.05",
          volume: "4",
          commission: "1",
          pnl: "5",
          state: "done",
        },
      },
    );
  } finally {
    Date.now = now;
  }
});

test("metatrader fallback account and instrument branches return normalized defaults", async () => {
  const exchange = createExchange();

  exchange.client.request = async ({
    method,
    url,
  }: {
    method: string;
    url: string;
  }) => {
    if (method === "GET" && url === "/account") {
      return {
        data: {
          account: {
            balance: "1200",
            marginFree: "900",
            profit: "12",
          },
        },
      };
    }

    if (method === "GET" && url === "/positions") {
      return {
        data: {
          positions: [
            {
              positionId: "p1",
              symbol: "eurusd",
              quantity: "1",
              side: "buy",
            },
          ],
        },
      };
    }

    if (url === "/instruments/EURUSD") {
      return {
        data: {
          instrument: {
            ctVal: "1000",
            lotSz: "0.1",
            minSz: "0.2",
            tickSz: "0.01",
            profitCurrency: "USD",
          },
        },
      };
    }

    return {
      data: {
        instrument: {
          ctVal: "1000",
          lotSz: "0.1",
          minSz: "0.2",
          tickSz: "0.01",
        },
      },
    };
  };

  assert.deepEqual(await exchange.getAccountInfo(), {
    totalBalance: 1200,
    availableBalance: 900,
    unrealizedPnl: 12,
    currency: "USD",
  });
  assert.deepEqual(await exchange.cancelAlgoOrders("eurusd"), {
    cancelled: [],
    errors: [],
  });
  assert.deepEqual(await exchange.getInstrumentSpecs("eurusd"), {
    ctVal: 1000,
    lotSz: 0.1,
    minSz: 0.2,
    ctValCcy: "USD",
    tickSz: 0.01,
    qtyDecimals: 1,
    priceDecimals: 2,
  });
  assert.deepEqual(await exchange.getInstrumentSpecs("gbpjpy"), {
    ctVal: 1000,
    lotSz: 0.1,
    minSz: 0.2,
    ctValCcy: "GBP",
    tickSz: 0.01,
    qtyDecimals: 1,
    priceDecimals: 2,
  });
  assert.equal(await exchange.clearSyntheticProtectionOrder("plain", "eurusd"), false);
  assert.equal(await exchange.clearSyntheticProtectionOrder("mt-sl:", "eurusd"), false);
});

test("metatrader constructor attaches proxy agents and handles proxy lookup failures", async () => {
  vi.resetModules();
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const proxyAgent = { agent: "proxy" };

  try {
    vi.doMock("../proxy/ProxyFactory", () => ({
      getProxyAgent: vi
        .fn()
        .mockResolvedValueOnce(proxyAgent)
        .mockRejectedValueOnce(new Error("proxy unavailable")),
    }));

    const { MetaTraderExchange: MockedMetaTraderExchange } = await import(
      "./metatrader/index"
    );
    const exchange = new MockedMetaTraderExchange({
      baseUrl: "https://mt.example.com/",
      login: "login",
      password: "password",
      server: "server",
      platform: "MT5",
      bridgeToken: "token",
    }) as any;

    const interceptor = exchange.client.interceptors.request.handlers[0];
    const first = await interceptor.fulfilled({ headers: {} });
    assert.equal(first.httpsAgent, proxyAgent);
    assert.equal(first.httpAgent, proxyAgent);

    const second = await interceptor.fulfilled({ headers: {} });
    assert.equal(second.httpsAgent, undefined);
    assert.equal(second.httpAgent, undefined);
    assert.equal(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes("Proxy agent not available"),
      ),
      true,
    );
  } finally {
    warnSpy.mockRestore();
    vi.doUnmock("../proxy/ProxyFactory");
    vi.resetModules();
  }
});

test("metatrader order and algo fallbacks cover volume-based rows and fatal cancel errors", async () => {
  const exchange = createExchange();
  const now = Date.now;
  Date.now = () => 123456;

  try {
    exchange.client.request = async ({ url }: { url: string }) => {
      if (url === "/orders") {
        return {
          data: {
            result: {
              id: 11,
              volume: "1.25",
              status: "queued",
            },
          },
        };
      }

      if (url === "/orders/history") {
        return {
          data: {
            result: [
              {
                id: 4,
                symbol: "xauusd",
                type: "buy",
                lots: "0.3",
                status: "closed",
                openPrice: "2500",
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected request for ${url}`);
    };

    exchange.getPositionsRaw = async () => [
      {
        ticket: 9,
        symbol: "xauusd",
        type: "sell",
        volume: "0.4",
        sl: "2400",
        tp: "2600",
        time: "2026-01-03T00:00:00Z",
      },
      {
        id: 10,
        symbol: "eurusd",
        side: "sell",
        lots: "0.2",
        stopLoss: "1.05",
        takeProfit: "1.15",
      },
    ];

    assert.deepEqual(
      await exchange.placeOrder({
        symbol: "xauusd",
        side: OrderSide.SELL,
        type: ExchangeOrderType.MARKET,
        quantity: 2,
      }),
      {
        orderId: "11",
        price: 0,
        quantity: 1.25,
        status: "queued",
        raw: { id: 11, volume: "1.25", status: "queued" },
      },
    );

    assert.deepEqual(await exchange.getOrderHistory("xauusd", 5), [
      {
        orderId: "4",
        symbol: "XAUUSD",
        side: "BUY",
        type: "buy",
        price: 2500,
        quantity: 0.3,
        filledQuantity: 0.3,
        fee: 0,
        realizedPnl: 0,
        status: "closed",
        createdAt: 123456,
        updatedAt: undefined,
        raw: {
          id: 4,
          symbol: "xauusd",
          type: "buy",
          lots: "0.3",
          status: "closed",
          openPrice: "2500",
        },
      },
    ]);

    assert.deepEqual(await exchange.getAlgoOrders(), [
      {
        orderId: "mt-sl:9",
        symbol: "XAUUSD",
        side: "BUY",
        type: "sl",
        triggerPrice: 2400,
        quantity: 0.4,
        status: "active",
        createdAt: Date.parse("2026-01-03T00:00:00Z"),
        raw: {
          ticket: 9,
          symbol: "xauusd",
          type: "sell",
          volume: "0.4",
          sl: "2400",
          tp: "2600",
          time: "2026-01-03T00:00:00Z",
        },
      },
      {
        orderId: "mt-tp:9",
        symbol: "XAUUSD",
        side: "BUY",
        type: "tp",
        triggerPrice: 2600,
        quantity: 0.4,
        status: "active",
        createdAt: Date.parse("2026-01-03T00:00:00Z"),
        raw: {
          ticket: 9,
          symbol: "xauusd",
          type: "sell",
          volume: "0.4",
          sl: "2400",
          tp: "2600",
          time: "2026-01-03T00:00:00Z",
        },
      },
      {
        orderId: "mt-sl:10",
        symbol: "EURUSD",
        side: "BUY",
        type: "sl",
        triggerPrice: 1.05,
        quantity: 0.2,
        status: "active",
        createdAt: undefined,
        raw: {
          id: 10,
          symbol: "eurusd",
          side: "sell",
          lots: "0.2",
          stopLoss: "1.05",
          takeProfit: "1.15",
        },
      },
      {
        orderId: "mt-tp:10",
        symbol: "EURUSD",
        side: "BUY",
        type: "tp",
        triggerPrice: 1.15,
        quantity: 0.2,
        status: "active",
        createdAt: undefined,
        raw: {
          id: 10,
          symbol: "eurusd",
          side: "sell",
          lots: "0.2",
          stopLoss: "1.05",
          takeProfit: "1.15",
        },
      },
    ]);

    exchange.request = async () => {
      throw new Error("fatal");
    };

    await assert.rejects(
      () => exchange.cancelOrder("broker-order", "eurusd"),
      /fatal/,
    );
  } finally {
    Date.now = now;
  }
});
