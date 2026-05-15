import assert from "node:assert/strict";
import { test } from "vitest";
import { MexcExchange } from "./mexc/index";
import { ExchangeOrderType, OrderSide } from "../enums";

type RequestParams = Record<string, string | number | boolean | undefined>;

function createExchange() {
  const exchange = new MexcExchange("key", "secret") as any;
  exchange.buildAuthParams = () => ({
    api_key: "key",
    timestamp: 123,
  });
  exchange.sign = () => "sig";
  return exchange as MexcExchange & { [key: string]: any };
}

test("mexc account and market helpers normalize successful responses", async () => {
  const exchange = createExchange();

  exchange.client.get = async (path: string) => {
    if (path === "/api/v1/private/account/assets") {
      return {
        data: {
          success: true,
          data: [
            {
              currency: "USDT",
              totalBalance: "1000",
              availableBalance: "750",
              unrealizedProfit: "12.5",
            },
          ],
        },
      };
    }
    if (path === "/api/v1/contract/ticker?symbol=BTCUSDT") {
      return {
        data: { success: true, data: { lastPrice: "65000.5" } },
      };
    }
    return {
      data: {
        success: true,
        data: [[1, 10, 11, 12, 9, 100]],
      },
    };
  };

  assert.deepEqual(await exchange.getAccountInfo(), {
    totalBalance: 1000,
    availableBalance: 750,
    unrealizedPnl: 12.5,
    currency: "USDT",
  });
  assert.equal(await exchange.getTickerPrice("BTCUSDT"), 65000.5);
  assert.deepEqual(await exchange.getKlines("BTCUSDT", "1h", 1), [
    { time: 1, open: 10, close: 11, high: 12, low: 9, volume: 100 },
  ]);
});

test("mexc account and market helpers surface failures", async () => {
  const exchange = createExchange();

  exchange.client.get = async (path: string) => {
    if (path === "/api/v1/private/account/assets") {
      return { data: { success: false, message: "denied" } };
    }
    if (path === "/api/v1/contract/ticker?symbol=BTCUSDT") {
      return { data: { success: false } };
    }
    return { data: { success: false } };
  };

  await assert.rejects(() => exchange.getAccountInfo(), /MEXC API error: denied/);
  await assert.rejects(
    () => exchange.getTickerPrice("BTCUSDT"),
    /Failed to get price for BTCUSDT/,
  );
  assert.deepEqual(await exchange.getKlines("BTCUSDT"), []);
});

test("mexc positions and leverage handling normalize rows and keep best-effort leverage updates", async () => {
  const exchange = createExchange();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

  try {
    exchange.client.get = async () => ({
      data: {
        success: true,
        data: [
          {
            symbol: "BTCUSDT",
            positionId: 1,
            type: 1,
            leverage: 5,
            openType: 1,
            entryPrice: 60000,
            holdQty: 2,
            margin: 100,
            unrealizedPnl: 10,
            liquidationPrice: 50000,
            marketPrice: 61000,
          },
        ],
      },
    });
    exchange.client.post = async (path: string) => {
      if (path === "/api/v1/private/position/change_leverage") {
        return { data: { success: false, message: "not supported" } };
      }
      return { data: { success: true } };
    };

    assert.deepEqual(await exchange.getOpenPositions(), [
      {
        symbol: "BTCUSDT",
        positionId: "1",
        side: "LONG",
        leverage: 5,
        marginType: "isolated",
        entryPrice: 60000,
        quantity: 2,
        margin: 100,
        unrealizedPnl: 10,
        liquidationPrice: 50000,
        markPrice: 61000,
        raw: {
          symbol: "BTCUSDT",
          positionId: 1,
          type: 1,
          leverage: 5,
          openType: 1,
          entryPrice: 60000,
          holdQty: 2,
          margin: 100,
          unrealizedPnl: 10,
          liquidationPrice: 50000,
          marketPrice: 61000,
        },
      },
    ]);
    assert.equal(await exchange.setLeverage("BTCUSDT", 9, "cross"), 9);
    assert.equal(warnings.some((line) => line.includes("Failed to set leverage")), true);
  } finally {
    console.warn = originalWarn;
  }
});

test("mexc getOpenPositions throws when the exchange rejects the request", async () => {
  const exchange = createExchange();
  exchange.client.get = async () => ({
    data: { success: false, message: "position error" },
  });

  await assert.rejects(
    () => exchange.getOpenPositions(),
    /Failed to get positions: position error/,
  );
});

test("mexc placeOrder covers leverage, market and limit orders, and failures", async () => {
  const exchange = createExchange();
  const leverageCalls: Array<{ symbol: string; leverage: number }> = [];
  const payloads: RequestParams[] = [];

  exchange.setLeverage = async (symbol: string, leverage: number) => {
    leverageCalls.push({ symbol, leverage });
    return leverage;
  };
  exchange.getTickerPrice = async () => 64000;
  exchange.client.post = async (
    path: string,
    _body: null,
    config?: { params?: RequestParams },
  ) => {
    if (path === "/api/v1/private/order/submit") {
      payloads.push(config?.params || {});
      if (payloads.length === 3) {
        return { data: { success: false, message: "reject" } };
      }
      return { data: { success: true, data: payloads.length } };
    }
    return { data: { success: true } };
  };

  const market = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 2,
    leverage: 7,
  });
  const limit = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.SELL,
    type: ExchangeOrderType.LIMIT,
    quantity: 3,
    price: 65000,
  });

  assert.deepEqual(leverageCalls, [{ symbol: "BTCUSDT", leverage: 7 }]);
  assert.equal(payloads[0]?.side, 1);
  assert.equal(payloads[0]?.type, 5);
  assert.equal(payloads[0]?.price, 2);
  assert.equal(payloads[1]?.side, 3);
  assert.equal(payloads[1]?.type, 1);
  assert.equal(payloads[1]?.optionType, 1);
  assert.deepEqual(market, {
    orderId: "1",
    price: 64000,
    quantity: 2,
    status: "submitted",
  });
  assert.deepEqual(limit, {
    orderId: "2",
    price: 65000,
    quantity: 3,
    status: "submitted",
  });

  await assert.rejects(
    () =>
      exchange.placeOrder({
        symbol: "BTCUSDT",
        side: OrderSide.BUY,
        type: ExchangeOrderType.MARKET,
        quantity: 1,
      }),
    /Failed to place order: reject/,
  );
});

test("mexc closePosition and closeAllPositions cover success and failure paths", async () => {
  const exchange = createExchange();

  exchange.client.post = async (path: string) => {
    if (path === "/api/v1/private/position/close") {
      return { data: { success: true } };
    }
    return { data: { success: true } };
  };
  await exchange.closePosition("BTCUSDT", "1", 2);

  exchange.client.post = async () => ({ data: { success: false, message: "nope" } });
  await assert.rejects(
    () => exchange.closePosition("BTCUSDT"),
    /Failed to close position: nope/,
  );

  exchange.getOpenPositions = async () => [
    { symbol: "BTCUSDT", positionId: "1" },
    { symbol: "ETHUSDT", positionId: "2" },
  ];
  exchange.closePosition = async (symbol: string) => {
    if (symbol === "ETHUSDT") throw new Error("reject");
  };
  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: ["BTCUSDT"],
    errors: ["ETHUSDT: reject"],
  });

  exchange.getOpenPositions = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: [],
    errors: ["Failed to fetch positions: offline"],
  });
});

test("mexc stop-loss and take-profit order helpers return ids and propagate exchange failures", async () => {
  const exchange = createExchange();
  let calls = 0;

  exchange.client.post = async () => {
    calls += 1;
    if (calls === 1) return { data: { success: true, data: 111 } };
    if (calls === 2) return { data: { success: true, data: 222 } };
    return { data: { success: false, message: "tp/sl failed" } };
  };

  assert.equal(
    await exchange.placeStopLoss("BTCUSDT", 60000, 59900, OrderSide.SELL, 2),
    "111",
  );
  assert.equal(
    await exchange.placeTakeProfit("BTCUSDT", 70000, 69900, OrderSide.BUY, 1),
    "222",
  );
  await assert.rejects(
    () => exchange.placeStopLoss("BTCUSDT", 1, 1, OrderSide.BUY, 1),
    /Failed to place stop loss: tp\/sl failed/,
  );
});

test("mexc open orders, single cancellation, and algo order listing are normalized", async () => {
  const exchange = createExchange();

  exchange.client.get = async (path: string) => {
    if (path === "/api/v1/private/order/list/open_orders") {
      return {
        data: {
          success: true,
          data: [
            {
              id: "o1",
              symbol: "BTCUSDT",
              side: 1,
              type: 5,
              price: 65000,
              vol: 2,
              dealVol: 0.5,
              state: 1,
              cTime: 123,
            },
          ],
        },
      };
    }
    if (path === "/api/v1/private/plan/order/list") {
      return {
        data: {
          success: true,
          data: [
            {
              id: "a1",
              symbol: "BTCUSDT",
              side: 3,
              type: 1,
              triggerPrice: 60000,
              executePrice: 59900,
              vol: 2,
              state: 1,
              cTime: 456,
            },
          ],
        },
      };
    }
    return { data: { success: false } };
  };
  exchange.client.post = async () => ({ data: { success: true } });

  assert.deepEqual(await exchange.getOpenOrders("BTCUSDT"), [
    {
      orderId: "o1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "5",
      price: 65000,
      quantity: 2,
      filledQuantity: 0.5,
      status: "1",
      createdAt: 123,
      raw: {
        id: "o1",
        symbol: "BTCUSDT",
        side: 1,
        type: 5,
        price: 65000,
        vol: 2,
        dealVol: 0.5,
        state: 1,
        cTime: 123,
      },
    },
  ]);
  assert.equal(await exchange.cancelOrder("o1", "BTCUSDT"), true);
  assert.deepEqual(await exchange.getAlgoOrders("BTCUSDT"), [
    {
      orderId: "a1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "sl",
      triggerPrice: 60000,
      executePrice: 59900,
      quantity: 2,
      status: "1",
      createdAt: 456,
      raw: {
        id: "a1",
        symbol: "BTCUSDT",
        side: 3,
        type: 1,
        triggerPrice: 60000,
        executePrice: 59900,
        vol: 2,
        state: 1,
        cTime: 456,
      },
    },
  ]);
});

test("mexc algo cancellation aggregates exchange and thrown errors", async () => {
  const exchange = createExchange();

  exchange.getAlgoOrders = async () => [
    { orderId: "a1" },
    { orderId: "a2" },
    { orderId: "a3" },
  ];

  let calls = 0;
  exchange.client.post = async () => {
    calls += 1;
    if (calls === 1) return { data: { success: true } };
    if (calls === 2) return { data: { success: false, message: "busy" } };
    throw new Error("network");
  };

  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: ["a1"],
    errors: [
      "a2: busy",
      "a3: [MEXC] POST /api/v1/private/plan/order/cancel failed: network | payload={\"api_key\":\"[redacted]\",\"timestamp\":123,\"symbol\":\"BTCUSDT\",\"orderId\":\"a3\",\"sign\":\"[redacted]\"}",
    ],
  });
});

test("mexc history and instrument specs cover success, fallback, and stubbed specs", async () => {
  const exchange = createExchange();

  exchange.client.get = async () => ({
    data: {
      success: true,
      data: [
        {
          id: "h1",
          symbol: "BTCUSDT",
          side: 3,
          type: 5,
          price: 64000,
          vol: 2,
          dealVol: 2,
          fee: -1.5,
          profit: 20,
          state: 4,
          cTime: 100,
          uTime: 101,
        },
      ],
    },
  });

  assert.deepEqual(await exchange.getOrderHistory("BTCUSDT", 5), [
    {
      orderId: "h1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "5",
      price: 64000,
      quantity: 2,
      filledQuantity: 2,
      fee: 1.5,
      realizedPnl: 20,
      status: "4",
      createdAt: 100,
      updatedAt: 101,
      raw: {
        id: "h1",
        symbol: "BTCUSDT",
        side: 3,
        type: 5,
        price: 64000,
        vol: 2,
        dealVol: 2,
        fee: -1.5,
        profit: 20,
        state: 4,
        cTime: 100,
        uTime: 101,
      },
    },
  ]);

  exchange.client.get = async () => ({ data: { success: false } });
  assert.deepEqual(await exchange.getOpenOrders(), []);
  assert.deepEqual(await exchange.getAlgoOrders(), []);
  assert.deepEqual(await exchange.getOrderHistory(), []);
  assert.deepEqual(await exchange.getInstrumentSpecs("BTCUSDT"), {
    ctVal: 1,
    lotSz: 1,
    minSz: 1,
    ctValCcy: "",
    tickSz: 0.01,
    qtyDecimals: 0,
    priceDecimals: 2,
  });
});
