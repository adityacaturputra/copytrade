import { test } from "vitest";
import assert from "node:assert/strict";
import { BybitExchange } from "./BybitExchange";
import { ExchangeOrderType, OrderSide } from "../enums";

type MockSpecs = Awaited<ReturnType<BybitExchange["getInstrumentSpecs"]>>;
type RequestParams = Record<string, string | number | boolean | undefined>;

function createExchange(specs?: MockSpecs) {
  const exchange = new BybitExchange("key", "secret") as any;

  if (specs) {
    exchange.getInstrumentSpecs = async () => specs;
  }

  return exchange as BybitExchange;
}

test("Bybit setLeverage ensures isolated margin mode before setting leverage", async () => {
  const exchange = createExchange() as any;
  const calls: Array<{
    method: string;
    path: string;
    payload: Record<string, unknown>;
  }> = [];

  exchange.signedRequest = async (
    method: string,
    path: string,
    payload: Record<string, unknown>,
  ) => {
    calls.push({ method, path, payload });
    return {};
  };

  const result = await exchange.setLeverage("BTCUSDT", 7);

  assert.equal(result, 7);
  assert.deepEqual(
    calls.map((item) => item.path),
    [
      "/v5/account/set-margin-mode",
      "/v5/position/switch-isolated",
      "/v5/position/set-leverage",
    ],
  );
  assert.equal(calls[0]?.payload.setMarginMode, "ISOLATED_MARGIN");
  assert.equal(calls[1]?.payload.tradeMode, 1);
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
  const exchange = createExchange({
    ctVal: 1,
    lotSz: 0.1,
    minSz: 0.1,
    ctValCcy: "BTC",
    tickSz: 0.5,
    qtyDecimals: 1,
    priceDecimals: 1,
  }) as any;

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
  const exchange = createExchange({
    ctVal: 1,
    lotSz: 0.1,
    minSz: 0.1,
    ctValCcy: "BTC",
    tickSz: 0.5,
    qtyDecimals: 1,
    priceDecimals: 1,
  }) as any;

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
  const exchange = createExchange({
    ctVal: 1,
    lotSz: 0.1,
    minSz: 0.1,
    ctValCcy: "BTC",
    tickSz: 0.5,
    qtyDecimals: 1,
    priceDecimals: 1,
  }) as any;

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
          lotSizeFilter: { qtyStep: "0.001", minOrderQty: "0.010" },
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
