import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { BybitExchange } from "./BybitExchange";
import { ExchangeOrderType, OrderSide } from "../enums";

type MockSpecs = Awaited<ReturnType<BybitExchange["getInstrumentSpecs"]>>;
type RequestParams = Record<string, string | number | boolean | undefined>;
const DEFAULT_SPECS: MockSpecs = {
  ctVal: 1,
  lotSz: 0.1,
  minSz: 0.1,
  ctValCcy: "BTC",
  tickSz: 0.5,
  qtyDecimals: 1,
  priceDecimals: 1,
};

function createExchange(specs?: MockSpecs) {
  const exchange = new BybitExchange("key", "secret") as any;

  if (specs) {
    exchange.getInstrumentSpecs = async () => specs;
  }

  return exchange as BybitExchange;
}

test("Bybit setLeverage keeps symbol margin switching for classic accounts", async () => {
  const exchange = createExchange() as any;
  const calls: Array<{
    method: string;
    path: string;
    payload: Record<string, unknown>;
  }> = [];

  exchange.signedRequest = async (
    method: string,
    path: string,
    payload: Record<string, unknown> = {},
  ) => {
    calls.push({ method, path, payload });
    if (path === "/v5/account/info") {
      return { unifiedMarginStatus: 1 };
    }
    return {};
  };

  const result = await exchange.setLeverage("BTCUSDT", 7);

  assert.equal(result, 7);
  assert.deepEqual(
    calls.map((item) => item.path),
    [
      "/v5/account/info",
      "/v5/account/set-margin-mode",
      "/v5/position/switch-isolated",
      "/v5/position/set-leverage",
    ],
  );
  assert.equal(calls[1]?.payload.setMarginMode, "ISOLATED_MARGIN");
  assert.equal(calls[2]?.payload.tradeMode, 1);
  assert.equal(calls[3]?.payload.buyLeverage, "7");
  assert.equal(calls[3]?.payload.sellLeverage, "7");
});

test("Bybit setLeverage skips symbol margin switching for unified linear accounts", async () => {
  const exchange = createExchange() as any;
  const calls: Array<{
    method: string;
    path: string;
    payload: Record<string, unknown>;
  }> = [];

  exchange.signedRequest = async (
    method: string,
    path: string,
    payload: Record<string, unknown> = {},
  ) => {
    calls.push({ method, path, payload });
    if (path === "/v5/account/info") {
      return { unifiedMarginStatus: 5 };
    }
    return {};
  };

  const result = await exchange.setLeverage("BTCUSDT", 7);

  assert.equal(result, 7);
  assert.deepEqual(
    calls.map((item) => item.path),
    [
      "/v5/account/info",
      "/v5/account/set-margin-mode",
      "/v5/position/set-leverage",
    ],
  );
  assert.equal(calls[1]?.payload.setMarginMode, "ISOLATED_MARGIN");
  assert.equal(calls[2]?.payload.buyLeverage, "7");
  assert.equal(calls[2]?.payload.sellLeverage, "7");
});

test("Bybit getAccountInfo normalizes wallet balances", async () => {
  const exchange = createExchange() as any;

  exchange.signedRequest = async () => ({
    list: [
      {
        totalWalletBalance: "1000",
        totalAvailableBalance: "800",
        totalPerpUPL: "12.5",
        coin: [{ coin: "USDT", walletBalance: "900" }],
      },
    ],
  });

  const result = await exchange.getAccountInfo();

  assert.deepEqual(result, {
    totalBalance: 1000,
    availableBalance: 800,
    unrealizedPnl: 12.5,
    currency: "USDT",
  });
});

test("Bybit market orders clamp quantity and use ticker price for fills", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  const leverageCalls: Array<{
    symbol: string;
    leverage: number;
    marginType: string;
  }> = [];
  let payload: RequestParams | undefined;

  exchange.setLeverage = async (
    symbol: string,
    leverage: number,
    marginType: string,
  ) => {
    leverageCalls.push({ symbol, leverage, marginType });
    return leverage;
  };
  exchange.getTickerPrice = async () => 64000;
  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/v5/order/create") {
      payload = params;
      return { orderId: "order-1" };
    }
    return {};
  };

  const result = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 2.789,
    leverage: 7,
  });

  assert.deepEqual(leverageCalls, [
    { symbol: "BTCUSDT", leverage: 7, marginType: undefined },
  ]);
  assert.equal(payload?.symbol, "BTCUSDT");
  assert.equal(payload?.side, "Buy");
  assert.equal(payload?.orderType, "Market");
  assert.equal(payload?.qty, "2.7");
  assert.deepEqual(result, {
    orderId: "order-1",
    price: 64000,
    quantity: 2.7,
    status: "submitted",
    raw: { orderId: "order-1" },
  });
});

test("Bybit limit orders require a valid price", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  await assert.rejects(
    exchange.placeOrder({
      symbol: "BTCUSDT",
      side: OrderSide.BUY,
      type: ExchangeOrderType.LIMIT,
      quantity: 1,
    }),
    /LIMIT order requires a valid price/,
  );
});

test("Bybit closePosition filters by position id and rounds the close size", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  let payload: RequestParams | undefined;
  exchange.fetchPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "Buy",
      size: "1.53",
      positionIdx: 1,
    },
    {
      symbol: "BTCUSDT",
      side: "Sell",
      size: "2.0",
      positionIdx: 2,
    },
  ];
  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/v5/order/create") {
      payload = params;
    }
    return {};
  };

  await exchange.closePosition("BTCUSDT", "BTCUSDT:1", 1.24);

  assert.equal(payload?.symbol, "BTCUSDT");
  assert.equal(payload?.side, "Sell");
  assert.equal(payload?.qty, "1.2");
  assert.equal(payload?.positionIdx, 1);
  assert.equal(payload?.reduceOnly, true);
});

test("Bybit getAlgoOrders merges exchange stop orders with position trading stops", async () => {
  const exchange = createExchange() as any;

  exchange.fetchRealtimeOrders = async () => [
    {
      orderId: "algo-1",
      orderLinkId: "ct_tp_existing",
      symbol: "BTCUSDT",
      side: "Sell",
      orderType: "Market",
      triggerPrice: "70500",
      qty: "0.5",
      orderStatus: "New",
      createdTime: "10",
    },
  ];
  exchange.fetchPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "Buy",
      size: "1.25",
      positionIdx: 1,
      takeProfit: "72000",
      stopLoss: "64000",
      updatedTime: "20",
    },
  ];

  const result = await exchange.getAlgoOrders("BTCUSDT");

  assert.deepEqual(result, [
    {
      orderId: "algo-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "tp",
      triggerPrice: 70500,
      executePrice: undefined,
      quantity: 0.5,
      status: "New",
      createdAt: 10,
      raw: {
        orderId: "algo-1",
        orderLinkId: "ct_tp_existing",
        symbol: "BTCUSDT",
        side: "Sell",
        orderType: "Market",
        triggerPrice: "70500",
        qty: "0.5",
        orderStatus: "New",
        createdTime: "10",
      },
    },
    {
      orderId: "position-tp:BTCUSDT:1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "tp",
      triggerPrice: 72000,
      quantity: 1.25,
      status: "active",
      createdAt: 20,
      raw: {
        symbol: "BTCUSDT",
        side: "Buy",
        size: "1.25",
        positionIdx: 1,
        takeProfit: "72000",
        stopLoss: "64000",
        updatedTime: "20",
      },
    },
    {
      orderId: "position-sl:BTCUSDT:1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "sl",
      triggerPrice: 64000,
      quantity: 1.25,
      status: "active",
      createdAt: 20,
      raw: {
        symbol: "BTCUSDT",
        side: "Buy",
        size: "1.25",
        positionIdx: 1,
        takeProfit: "72000",
        stopLoss: "64000",
        updatedTime: "20",
      },
    },
  ]);
});

test("Bybit closePosition rejects missing positions and setLeverage tolerates not-modified responses", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  exchange.fetchPositions = async () => [];
  await assert.rejects(
    () => exchange.closePosition("BTCUSDT", undefined, 1),
    /No open Bybit position found for BTCUSDT/,
  );

  exchange.ensureMarginMode = async () => {};
  exchange.signedRequest = async () => {
    throw new Error("leverage not modified");
  };

  assert.equal(await exchange.setLeverage("BTCUSDT", 9), 9);
});

test("Bybit cancelOrder succeeds and getAlgoOrders ignores malformed position trading-stop rows", async () => {
  const exchange = createExchange() as any;

  exchange.signedRequest = async () => ({});
  assert.equal(await exchange.cancelOrder("open-1", "BTCUSDT"), true);

  exchange.fetchRealtimeOrders = async () => [];
  exchange.fetchPositions = async () => [
    {
      symbol: "",
      side: "Buy",
      size: "1",
      positionIdx: 1,
      takeProfit: "72000",
      stopLoss: "64000",
    },
    {
      symbol: "BTCUSDT",
      side: "None",
      size: "1",
      positionIdx: 1,
      takeProfit: "72000",
      stopLoss: "64000",
    },
    {
      symbol: "BTCUSDT",
      side: "Sell",
      size: "0",
      positionIdx: 2,
      takeProfit: "60000",
      stopLoss: "71000",
    },
  ];

  assert.deepEqual(await exchange.getAlgoOrders("BTCUSDT"), []);
});

test("Bybit cancelAlgoOrders combines realtime stop cancellations and trading-stop resets", async () => {
  const exchange = createExchange() as any;

  const cleared: Array<{ symbol: string; positionIdx: number }> = [];
  exchange.fetchRealtimeOrders = async () => [
    { orderId: "algo-1", symbol: "BTCUSDT" },
    { orderId: "algo-2", symbol: "BTCUSDT" },
  ];
  exchange.cancelOrder = async (orderId: string) => orderId === "algo-1";
  exchange.fetchPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "Buy",
      size: "1.5",
      positionIdx: 1,
      takeProfit: "72000",
      stopLoss: "64000",
    },
  ];
  exchange.clearTradingStopsForPosition = async (
    symbol: string,
    positionIdx: number,
  ) => {
    cleared.push({ symbol, positionIdx });
  };

  const result = await exchange.cancelAlgoOrders("BTCUSDT");

  assert.deepEqual(cleared, [{ symbol: "BTCUSDT", positionIdx: 1 }]);
  assert.deepEqual(result, {
    cancelled: ["algo-1", "position-tp:BTCUSDT:1", "position-sl:BTCUSDT:1"],
    errors: ["algo-2: Unknown order"],
  });
});

test("Bybit getInstrumentSpecs caches normalized instrument metadata", async () => {
  const exchange = createExchange() as any;

  let calls = 0;
  exchange.publicRequest = async () => {
    calls += 1;
    return {
      list: [
        {
          symbol: "BTCUSDT",
          baseCoin: "BTC",
          priceFilter: { tickSize: "0.10" },
          lotSizeFilter: {
            qtyStep: "0.001",
            minOrderQty: "0.010",
            minNotionalValue: "5",
          },
        },
      ],
    };
  };

  const first = await exchange.getInstrumentSpecs("BTCUSDT");
  const second = await exchange.getInstrumentSpecs("BTCUSDT");

  assert.equal(calls, 1);
  assert.deepEqual(first, {
    ctVal: 1,
    lotSz: 0.001,
    minSz: 0.01,
    minNotional: 5,
    ctValCcy: "BTC",
    tickSz: 0.1,
    qtyDecimals: 3,
    priceDecimals: 1,
  });
  assert.deepEqual(second, first);
});

test("Bybit market data helpers normalize ticker and kline payloads", async () => {
  const exchange = createExchange() as any;

  exchange.publicRequest = async (path: string) => {
    if (path === "/v5/market/tickers") {
      return {
        list: [{ symbol: "BTCUSDT", lastPrice: "65000.5" }],
      };
    }

    return {
      list: [
        ["200", "11", "15", "10", "14", "3"],
        ["100", "10", "12", "9", "11", "2"],
      ],
    };
  };

  const price = await exchange.getTickerPrice("BTCUSDT");
  const klines = await exchange.getKlines("BTCUSDT", "1h", 2);

  assert.equal(price, 65000.5);
  assert.deepEqual(klines, [
    { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 2 },
    { time: 200, open: 11, high: 15, low: 10, close: 14, volume: 3 },
  ]);
});

test("Bybit getOpenPositions maps exchange rows into normalized positions", async () => {
  const exchange = createExchange() as any;

  exchange.fetchPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "Buy",
      size: "2",
      avgPrice: "60000",
      leverage: "5",
      tradeMode: 1,
      positionIM: "120",
      unrealisedPnl: "15",
      liqPrice: "55000",
      markPrice: "61000",
      positionIdx: 1,
    },
    {
      symbol: "ETHUSDT",
      side: "Sell",
      size: "3",
      avgPrice: "3000",
      leverage: "4",
      tradeMode: 0,
      positionBalance: "80",
      unrealisedPnl: "-5",
      liqPrice: "3500",
      markPrice: "2900",
      positionIdx: 2,
    },
  ];

  const positions = await exchange.getOpenPositions();

  assert.deepEqual(positions, [
    {
      symbol: "BTCUSDT",
      positionId: "BTCUSDT:1",
      side: "LONG",
      leverage: 5,
      marginType: "isolated",
      entryPrice: 60000,
      quantity: 2,
      margin: 120,
      unrealizedPnl: 15,
      liquidationPrice: 55000,
      markPrice: 61000,
      raw: {
        symbol: "BTCUSDT",
        side: "Buy",
        size: "2",
        avgPrice: "60000",
        leverage: "5",
        tradeMode: 1,
        positionIM: "120",
        unrealisedPnl: "15",
        liqPrice: "55000",
        markPrice: "61000",
        positionIdx: 1,
      },
    },
    {
      symbol: "ETHUSDT",
      positionId: "ETHUSDT:2",
      side: "SHORT",
      leverage: 4,
      marginType: "cross",
      entryPrice: 3000,
      quantity: 3,
      margin: 80,
      unrealizedPnl: -5,
      liquidationPrice: 3500,
      markPrice: 2900,
      raw: {
        symbol: "ETHUSDT",
        side: "Sell",
        size: "3",
        avgPrice: "3000",
        leverage: "4",
        tradeMode: 0,
        positionBalance: "80",
        unrealisedPnl: "-5",
        liqPrice: "3500",
        markPrice: "2900",
        positionIdx: 2,
      },
    },
  ]);
});

test("Bybit stop loss and take profit delegate to conditional close orders", async () => {
  const exchange = createExchange() as any;

  const calls: Array<{
    type: string;
    symbol: string;
    triggerPrice: number;
    side: string;
    quantity: number;
  }> = [];
  exchange.placeConditionalCloseOrder = async (
    type: string,
    symbol: string,
    triggerPrice: number,
    side: string,
    quantity: number,
  ) => {
    calls.push({ type, symbol, triggerPrice, side, quantity });
    return `${type}-id`;
  };

  const sl = await exchange.placeStopLoss(
    "BTCUSDT",
    60000,
    0,
    OrderSide.SELL,
    2,
  );
  const tp = await exchange.placeTakeProfit(
    "BTCUSDT",
    70000,
    0,
    OrderSide.BUY,
    1,
  );

  assert.equal(sl, "sl-id");
  assert.equal(tp, "tp-id");
  assert.deepEqual(calls, [
    {
      type: "sl",
      symbol: "BTCUSDT",
      triggerPrice: 60000,
      side: "SELL",
      quantity: 2,
    },
    {
      type: "tp",
      symbol: "BTCUSDT",
      triggerPrice: 70000,
      side: "BUY",
      quantity: 1,
    },
  ]);
});

test("Bybit open orders and order history are normalized", async () => {
  const exchange = createExchange() as any;

  exchange.fetchRealtimeOrders = async (orderFilter: string) =>
    orderFilter === "Order"
      ? [
          {
            orderId: "open-1",
            symbol: "BTCUSDT",
            side: "Buy",
            orderType: "Limit",
            price: "65000",
            qty: "2",
            cumExecQty: "0.5",
            orderStatus: "New",
            createdTime: "100",
          },
        ]
      : [];
  exchange.signedRequest = async (_method: string, path: string) => {
    if (path === "/v5/order/history") {
      return {
        list: [
          {
            orderId: "hist-1",
            symbol: "BTCUSDT",
            side: "Sell",
            orderType: "Market",
            avgPrice: "64000",
            qty: "1.5",
            cumExecQty: "1.5",
            cumExecFee: "2.1",
            closedPnl: "18",
            orderStatus: "Filled",
            createdTime: "200",
            updatedTime: "210",
          },
        ],
      };
    }
    return {};
  };

  const openOrders = await exchange.getOpenOrders("BTCUSDT");
  const history = await exchange.getOrderHistory("BTCUSDT", 5);

  assert.deepEqual(openOrders, [
    {
      orderId: "open-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "Limit",
      price: 65000,
      quantity: 2,
      filledQuantity: 0.5,
      status: "New",
      createdAt: 100,
      raw: {
        orderId: "open-1",
        symbol: "BTCUSDT",
        side: "Buy",
        orderType: "Limit",
        price: "65000",
        qty: "2",
        cumExecQty: "0.5",
        orderStatus: "New",
        createdTime: "100",
      },
    },
  ]);
  assert.deepEqual(history, [
    {
      orderId: "hist-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "Market",
      price: 64000,
      quantity: 1.5,
      filledQuantity: 1.5,
      fee: 2.1,
      realizedPnl: 18,
      status: "Filled",
      createdAt: 200,
      updatedAt: 210,
      raw: {
        orderId: "hist-1",
        symbol: "BTCUSDT",
        side: "Sell",
        orderType: "Market",
        avgPrice: "64000",
        qty: "1.5",
        cumExecQty: "1.5",
        cumExecFee: "2.1",
        closedPnl: "18",
        orderStatus: "Filled",
        createdTime: "200",
        updatedTime: "210",
      },
    },
  ]);
});

test("Bybit cancelOrder returns false when the order no longer exists", async () => {
  const exchange = createExchange() as any;

  exchange.signedRequest = async () => {
    throw new Error("retCode=110001 order not exists");
  };

  const result = await exchange.cancelOrder("missing", "BTCUSDT");

  assert.equal(result, false);
});

test("Bybit request helpers serialize payloads and normalize auth errors", async () => {
  const exchange = new BybitExchange("key", "secret", true) as any;
  const getCalls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const postCalls: Array<{
    path: string;
    body: Record<string, unknown>;
    headers?: Record<string, string>;
  }> = [];

  exchange.client.get = async (url: string, config?: { headers?: Record<string, string> }) => {
    getCalls.push({ url, headers: config?.headers });

    if (url.startsWith("/ok") || url.startsWith("/signed-get")) {
      return { data: { retCode: 0, retMsg: "OK", result: { value: 1 } } };
    }

    if (url.startsWith("/v5/auth")) {
      throw {
        isAxiosError: true,
        message: "Request failed with status code 401",
        response: {
          status: 401,
          data: { retCode: 10003, retMsg: "invalid api key" },
        },
      };
    }

    return { data: { retCode: 10001, retMsg: "bad request", result: null } };
  };
  exchange.client.post = async (
    path: string,
    body: Record<string, unknown>,
    config?: { headers?: Record<string, string> },
  ) => {
    postCalls.push({ path, body, headers: config?.headers });

    if (path === "/post-ok") {
      return { data: { retCode: 0, retMsg: "OK", result: { ok: true } } };
    }

    return { data: { retCode: 130021, retMsg: "post failed", result: {} } };
  };

  assert.deepEqual(
    await exchange.publicRequest("/ok", { b: 2, a: 1, skip: undefined }),
    { value: 1 },
  );
  assert.equal(getCalls[0]?.url, "/ok");

  const signedGet = await exchange.signedRequest("GET", "/signed-get", {
    b: 2,
    a: 1,
    skip: undefined,
  });
  const signedPost = await exchange.signedRequest("POST", "/post-ok", {
    keep: "yes",
    skip: undefined,
  });

  assert.deepEqual(signedGet, { value: 1 });
  assert.deepEqual(signedPost, { ok: true });
  assert.equal(getCalls[1]?.url, "/signed-get?a=1&b=2");
  assert.equal(postCalls[0]?.path, "/post-ok");
  assert.deepEqual(postCalls[0]?.body, { keep: "yes" });
  assert.equal(Boolean(getCalls[1]?.headers?.["X-BAPI-SIGN"]), true);
  assert.equal(Boolean(postCalls[0]?.headers?.["X-BAPI-SIGN"]), true);

  await assert.rejects(
    () => exchange.publicRequest("/fail", { foo: "bar" }),
    /payload=\{"foo":"bar"\}/,
  );
  await assert.rejects(
    () => exchange.publicRequest("/v5/auth", {}),
    /api-demo\.bybit\.com/,
  );
  await assert.rejects(
    () => exchange.signedRequest("POST", "/post-fail", { foo: "bar" }),
    /payload=\{"foo":"bar"\}/,
  );
});

test("Bybit pagination helpers walk cursors for positions and realtime orders", async () => {
  const exchange = createExchange() as any;

  exchange.signedRequest = async (
    _method: string,
    path: string,
    payload: RequestParams = {},
  ) => {
    if (path === "/v5/position/list") {
      if (!payload.cursor) {
        return {
          list: [{ symbol: "BTCUSDT", side: "Buy", size: "1" }],
          nextPageCursor: "cursor-1",
        };
      }
      return {
        list: [{ symbol: "ETHUSDT", side: "Sell", size: "2" }],
      };
    }

    if (path === "/v5/order/realtime") {
      if (!payload.cursor) {
        return {
          list: [{ orderId: "1", symbol: "BTCUSDT" }],
          nextPageCursor: "cursor-2",
        };
      }
      return {
        list: [{ orderId: "2", symbol: "BTCUSDT" }],
      };
    }

    throw new Error(`Unexpected path: ${path}`);
  };

  assert.deepEqual(await exchange.fetchPositions("BTCUSDT"), [
    { symbol: "BTCUSDT", side: "Buy", size: "1" },
    { symbol: "ETHUSDT", side: "Sell", size: "2" },
  ]);
  assert.deepEqual(await exchange.fetchRealtimeOrders("StopOrder", "BTCUSDT"), [
    { orderId: "1", symbol: "BTCUSDT" },
    { orderId: "2", symbol: "BTCUSDT" },
  ]);
});

test("Bybit conditional close orders clamp values, compute trigger direction, and fall back to generated link ids", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;
  let payload: RequestParams | undefined;

  exchange.fetchTargetPosition = async () => ({
    symbol: "BTCUSDT",
    side: "Buy",
    size: "1.26",
    positionIdx: 1,
    markPrice: "0",
  });
  exchange.getTickerPrice = async () => 65000;
  exchange.buildAlgoOrderLinkId = () => "generated-link";
  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/v5/order/create") {
      payload = params;
      return {};
    }
    throw new Error(`Unexpected path: ${path}`);
  };

  const orderId = await exchange.placeTakeProfit(
    "BTCUSDT",
    64000.24,
    0,
    OrderSide.SELL,
    2,
  );

  assert.equal(orderId, "generated-link");
  assert.deepEqual(payload, {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Sell",
    orderType: "Market",
    qty: "1.2",
    triggerPrice: "64000.0",
    triggerDirection: 2,
    triggerBy: "MarkPrice",
    reduceOnly: true,
    closeOnTrigger: true,
    positionIdx: 1,
    orderLinkId: "generated-link",
  });
});

test("Bybit conditional close orders reject tiny quantities and target-position lookup enforces close side", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  exchange.fetchTargetPosition = async () => ({
    symbol: "BTCUSDT",
    side: "Buy",
    size: "0.04",
    positionIdx: 1,
    markPrice: "65000",
  });

  await assert.rejects(
    () =>
      exchange.placeStopLoss("BTCUSDT", 62000, 0, OrderSide.SELL, 0.04),
    /Conditional SL quantity too small/,
  );

  const lookupExchange = createExchange() as any;
  lookupExchange.fetchPositions = async () => [
    { symbol: "BTCUSDT", side: "Buy", size: "1", positionIdx: 1 },
  ];

  await assert.rejects(
    () => lookupExchange.fetchTargetPosition("BTCUSDT", "BUY"),
    /matching close side BUY/,
  );
});

test("Bybit closeAllPositions aggregates per-position and fetch-level failures", async () => {
  const exchange = createExchange() as any;

  exchange.getOpenPositions = async () => [
    { symbol: "BTCUSDT", side: "LONG", positionId: "BTCUSDT:1", quantity: 1 },
    { symbol: "ETHUSDT", side: "SHORT", positionId: "ETHUSDT:2", quantity: 2 },
  ];
  exchange.closePosition = async (symbol: string) => {
    if (symbol === "ETHUSDT") throw new Error("rejected");
  };

  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: ["BTCUSDT (LONG)"],
    errors: ["ETHUSDT: rejected"],
  });

  exchange.getOpenPositions = async () => {
    throw new Error("offline");
  };

  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: [],
    errors: ["Failed to fetch positions: offline"],
  });
});

test("Bybit private helpers cover symbol normalization, precision handling, and error hints", () => {
  const simulated = new BybitExchange("key", "secret", true) as any;
  const production = new BybitExchange("key", "secret") as any;

  assert.equal(simulated.toSymbol("btc-usdt-swap"), "BTCUSDT");
  assert.equal(simulated.toSymbol("eth_usdt"), "ETHUSDT");
  assert.equal(simulated.countDecimals(0.000001), 6);
  assert.equal(simulated.countDecimals(1e-7), 7);
  assert.equal(simulated.clampToStep(1.2345, 0, 2), 1.23);
  assert.equal(simulated.getPositionAlgoSide("Buy"), "SELL");
  assert.equal(simulated.getPositionAlgoSide("Sell"), "BUY");
  assert.equal(simulated.parseAlgoType("TakeProfit"), "tp");
  assert.equal(simulated.parseAlgoType("Stop"), "sl");
  assert.equal(simulated.parseAlgoType("Trailing"), "conditional");
  assert.equal(simulated.parseAlgoTypeFromOrder({ orderLinkId: "ct_sl_demo" }), "sl");
  assert.equal(
    simulated.isIgnorableMarginModeError("same tp sl mode on uta2.0 account"),
    true,
  );
  assert.equal(simulated.isIgnorableMarginModeError("hard failure"), false);
  assert.match(simulated.buildAlgoOrderLinkId("tp"), /^ct_tp_[a-z0-9]+_[a-z0-9]{6}$/);

  const generic = production.normalizeError(new Error("boom"), "GET /x");
  assert.match(generic.message, /\[Bybit\] GET \/x failed: boom/);

  const demoAuth = simulated.normalizeError(
    {
      isAxiosError: true,
      message: "Request failed with status code 401",
      response: { status: 401, data: { retCode: 10003, retMsg: "invalid key" } },
    },
    "GET /auth",
  );
  assert.match(demoAuth.message, /api-demo\.bybit\.com/);

  const prodAuth = production.normalizeError(
    {
      isAxiosError: true,
      message: "Request failed with status code 401",
      response: { status: 401, data: { retCode: 10003, retMsg: "invalid key" } },
    },
    "GET /auth",
    { symbol: "BTCUSDT" },
  );
  assert.match(prodAuth.message, /api\.bybit\.com/);
  assert.match(prodAuth.message, /payload=\{"symbol":"BTCUSDT"\}/);
});

test("Bybit constructor request interceptor attaches proxy agents and tolerates proxy lookup failures", async () => {
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

    const { BybitExchange: MockedBybitExchange } = await import("./BybitExchange");
    const exchange = new MockedBybitExchange("key", "secret") as any;
    const interceptor = exchange.client.interceptors.request.handlers[0];

    const first = await interceptor.fulfilled({ headers: {} });
    assert.equal(first.httpsAgent, proxyAgent);
    assert.equal(first.httpAgent, proxyAgent);

    const second = await interceptor.fulfilled({ headers: {} });
    assert.equal(second.httpsAgent, undefined);
    assert.equal(second.httpAgent, undefined);
    assert.equal(
      warnSpy.mock.calls.some((call) => String(call[0]).includes("Proxy agent not available")),
      true,
    );
  } finally {
    warnSpy.mockRestore();
    vi.doUnmock("../proxy/ProxyFactory");
    vi.resetModules();
  }
});

test("Bybit target-position and trading-stop helpers prefer explicit hedge legs and ignore benign mode errors", async () => {
  const exchange = createExchange() as any;
  const calls: Array<{ path: string; payload: RequestParams }> = [];

  exchange.fetchPositions = async () => [
    { symbol: "BTCUSDT", side: "Buy", size: "1", positionIdx: 0 },
    { symbol: "BTCUSDT", side: "Buy", size: "2", positionIdx: 1 },
    { symbol: "BTCUSDT", side: "Sell", size: "3", positionIdx: 2 },
  ];

  assert.deepEqual(await exchange.fetchTargetPosition("BTCUSDT", "SELL"), {
    symbol: "BTCUSDT",
    side: "Buy",
    size: "2",
    positionIdx: 1,
  });
  assert.deepEqual(await exchange.fetchTargetPosition("BTCUSDT", "BUY"), {
    symbol: "BTCUSDT",
    side: "Sell",
    size: "3",
    positionIdx: 2,
  });

  exchange.signedRequest = async (
    _method: string,
    path: string,
    payload: RequestParams = {},
  ) => {
    calls.push({ path, payload });
    throw new Error("position mode is not modified");
  };

  await exchange.ensureAccountMarginMode("cross");
  await exchange.ensureSymbolMarginMode("BTCUSDT", 5, "cross");

  exchange.signedRequest = async (
    _method: string,
    path: string,
    payload: RequestParams = {},
  ) => {
    calls.push({ path, payload });
    return {};
  };

  await exchange.clearTradingStopsForPosition("btc-usdt", 2);

  assert.deepEqual(calls.at(-1), {
    path: "/v5/position/trading-stop",
    payload: {
      category: "linear",
      symbol: "BTCUSDT",
      positionIdx: 2,
      tpslMode: "Full",
      takeProfit: "0",
      stopLoss: "0",
    },
  });
});

test("Bybit account and order helpers cover fallback balances, limit price clamping, and missing order ids", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;
  const payloads: RequestParams[] = [];

  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/v5/account/wallet-balance") {
      return {
        list: [
          {
            coin: [
              {
                coin: "USDT",
                walletBalance: "900",
                availableToWithdraw: "700",
                unrealisedPnl: "15",
              },
            ],
          },
        ],
      };
    }

    if (path === "/v5/order/create") {
      payloads.push(params);
      return payloads.length === 1 ? { orderLinkId: "linked-order" } : {};
    }

    throw new Error(`Unexpected path: ${path}`);
  };

  assert.deepEqual(await exchange.getAccountInfo(), {
    totalBalance: 900,
    availableBalance: 700,
    unrealizedPnl: 15,
    currency: "USDT",
  });

  const limitOrder = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.SELL,
    type: ExchangeOrderType.LIMIT,
    quantity: 1.29,
    price: 65000.74,
  });

  assert.deepEqual(limitOrder, {
    orderId: "linked-order",
    price: 65000.74,
    quantity: 1.2,
    status: "submitted",
    raw: { orderLinkId: "linked-order" },
  });
  assert.deepEqual(payloads[0], {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Sell",
    orderType: "Limit",
    qty: "1.2",
    price: "65000.5",
    timeInForce: "GTC",
  });

  await assert.rejects(
    () =>
      exchange.placeOrder({
        symbol: "BTCUSDT",
        side: OrderSide.BUY,
        type: ExchangeOrderType.MARKET,
        quantity: 0.04,
      }),
    /Order quantity too small for BTCUSDT/,
  );

  await assert.rejects(
    () =>
      exchange.placeOrder({
        symbol: "BTCUSDT",
        side: OrderSide.BUY,
        type: ExchangeOrderType.MARKET,
        quantity: 1,
      }),
    /\[Bybit\] Order accepted but no orderId returned/,
  );
});

test("Bybit setLeverage tolerates not-modified responses and cross margin mode", async () => {
  const exchange = createExchange() as any;
  const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];

  exchange.signedRequest = async (
    _method: string,
    path: string,
    payload: Record<string, unknown> = {},
  ) => {
    calls.push({ path, payload });
    if (path === "/v5/account/info") {
      return { unifiedMarginStatus: 1 };
    }
    if (path === "/v5/account/set-margin-mode") {
      throw new Error("margin mode is not modified");
    }
    if (path === "/v5/position/switch-isolated") {
      throw new Error("position mode is not modified");
    }
    if (path === "/v5/position/set-leverage") {
      throw new Error("not modified");
    }
    return {};
  };

  const result = await exchange.setLeverage("BTCUSDT", 9, "cross");

  assert.equal(result, 9);
  assert.deepEqual(
    calls.map((call) => [call.path, call.payload]),
    [
      ["/v5/account/info", {}],
      ["/v5/account/set-margin-mode", { setMarginMode: "REGULAR_MARGIN" }],
      [
        "/v5/position/switch-isolated",
        {
          category: "linear",
          symbol: "BTCUSDT",
          tradeMode: 0,
          buyLeverage: "9",
          sellLeverage: "9",
        },
      ],
      [
        "/v5/position/set-leverage",
        {
          category: "linear",
          symbol: "BTCUSDT",
          buyLeverage: "9",
          sellLeverage: "9",
        },
      ],
    ],
  );
});

test("Bybit market-data and order-management errors cover missing rows and unexpected cancel failures", async () => {
  const exchange = createExchange() as any;

  exchange.publicRequest = async (path: string) => {
    if (path === "/v5/market/tickers") return { list: [] };
    return { list: [] };
  };
  exchange.signedRequest = async () => {
    throw new Error("fatal");
  };

  await assert.rejects(
    () => exchange.getTickerPrice("BTCUSDT"),
    /Ticker not found on Bybit/,
  );
  await assert.rejects(() => exchange.cancelOrder("1", "BTCUSDT"), /fatal/);
});

test("Bybit cancelAlgoOrders records stop-order and trading-stop failures, and missing instruments are rejected", async () => {
  const exchange = createExchange() as any;

  exchange.fetchRealtimeOrders = async () => [
    { orderId: "algo-1", symbol: "BTCUSDT" },
    { symbol: "BTCUSDT" },
  ];
  exchange.cancelOrder = async () => {
    throw new Error("cancel failed");
  };
  exchange.fetchPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "Buy",
      size: "1",
      positionIdx: 1,
      takeProfit: "70000",
      stopLoss: "0",
    },
  ];
  exchange.clearTradingStopsForPosition = async () => {
    throw new Error("clear failed");
  };

  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: [],
    errors: ["algo-1: cancel failed", "position:1: clear failed"],
  });

  exchange.publicRequest = async () => ({ list: [] });
  await assert.rejects(
    () => exchange.getInstrumentSpecs("DOGEUSDT"),
    /Instrument not found on Bybit: DOGEUSDT/,
  );
});

test("Bybit cancelAlgoOrders skips positions without TP/SL and getInstrumentSpecs falls back to quote-stripped base coin", async () => {
  const exchange = createExchange() as any;

  exchange.fetchRealtimeOrders = async () => [];
  exchange.fetchPositions = async () => [
    {
      symbol: "BTCUSDT",
      side: "Buy",
      size: "1",
      positionIdx: 1,
      takeProfit: "0",
      stopLoss: "0",
    },
    {
      symbol: "BTCUSDT",
      side: "Sell",
      size: "2",
      positionIdx: 2,
      takeProfit: "65000",
      stopLoss: "0",
    },
  ];
  const cleared: number[] = [];
  exchange.clearTradingStopsForPosition = async (_symbol: string, positionIdx: number) => {
    cleared.push(positionIdx);
  };
  exchange.publicRequest = async () => ({
    list: [
      {
        symbol: "ETHUSDT",
        lotSizeFilter: {
          qtyStep: "0.01",
          minOrderQty: "0.05",
          minNotionalValue: "5",
        },
        priceFilter: {
          tickSize: "0.1",
        },
      },
    ],
  });

  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: ["position-tp:BTCUSDT:2"],
    errors: [],
  });
  assert.deepEqual(cleared, [2]);
  assert.deepEqual(await exchange.getInstrumentSpecs("ETHUSDT"), {
    ctVal: 1,
    lotSz: 0.01,
    minSz: 0.05,
    minNotional: 5,
    ctValCcy: "ETH",
    tickSz: 0.1,
    qtyDecimals: 2,
    priceDecimals: 1,
  });
});

test("Bybit edge branches cover generic formatting, wallet fallbacks, runtime order fallback pricing, and hard failures", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  const genericAxios = exchange.normalizeError(
    {
      isAxiosError: true,
      message: "transport failed",
      response: { data: { retCode: 10001, retMsg: "bad request" } },
    },
    "GET /generic",
  );
  assert.match(genericAxios.message, /\[Bybit\] GET \/generic failed code=10001: bad request/);
  assert.doesNotMatch(genericAxios.message, /status=/);
  assert.doesNotMatch(genericAxios.message, /hint=/);

  exchange.client.get = async () => ({ data: { retCode: 10001, result: null } });
  await assert.rejects(
    () => exchange.publicRequest("/unknown-retmsg"),
    /Unknown Bybit error/,
  );
  await assert.rejects(
    () => exchange.signedRequest("GET", "/unknown-signed-retmsg"),
    /Unknown Bybit error/,
  );

  exchange.signedRequest = async (_method: string, path: string) => {
    if (path === "/v5/account/wallet-balance") {
      return {
        list: [
          {
            coin: [{ coin: "BTC", walletBalance: "321" }],
          },
        ],
      };
    }

    if (path === "/v5/order/create") {
      return { orderId: "runtime-order" };
    }

    throw new Error(`Unexpected path: ${path}`);
  };

  assert.deepEqual(await exchange.getAccountInfo(), {
    totalBalance: 321,
    availableBalance: 321,
    unrealizedPnl: 0,
    currency: "USDT",
  });

  const runtimeOrder = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: "STOP" as ExchangeOrderType,
    quantity: 1.2,
  });
  assert.deepEqual(runtimeOrder, {
    orderId: "runtime-order",
    price: 0,
    quantity: 1.2,
    status: "submitted",
    raw: { orderId: "runtime-order" },
  });

  assert.equal(
    exchange.parseAlgoTypeFromOrder({ stopOrderType: "StopLoss" }),
    "sl",
  );

  exchange.signedRequest = async () => {
    throw new Error("hard failure");
  };

  await assert.rejects(
    () => exchange.ensureAccountMarginMode("isolated"),
    /hard failure/,
  );
  await assert.rejects(
    () => exchange.ensureSymbolMarginMode("BTCUSDT", 4, "cross"),
    /hard failure/,
  );
  await assert.rejects(
    () => exchange.setLeverage("BTCUSDT", 4),
    /hard failure/,
  );
});
