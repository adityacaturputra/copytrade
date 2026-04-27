import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { BinanceExchange } from "./BinanceExchange";
import { ExchangeOrderType, OrderSide } from "../enums";

type MockSpecs = Awaited<ReturnType<BinanceExchange["getInstrumentSpecs"]>>;
type RequestParams = Record<string, string | number | boolean | undefined>;
const DEFAULT_SPECS: MockSpecs = {
  ctVal: 1,
  lotSz: 0.001,
  minSz: 0.001,
  ctValCcy: "BTC",
  tickSz: 0.1,
  qtyDecimals: 3,
  priceDecimals: 1,
  marketLotSz: 1,
  marketMinSz: 1,
  marketQtyDecimals: 0,
};

function createExchange(specs: MockSpecs) {
  const exchange = new BinanceExchange("key", "secret") as any;

  exchange.getInstrumentSpecs = async () => specs;
  exchange.getTickerPrice = async () => 65000;

  return exchange as BinanceExchange;
}

test("market orders clamp quantity with MARKET_LOT_SIZE", async () => {
  const exchange = createExchange(DEFAULT_SPECS);

  let payload: RequestParams | undefined;
  (exchange as any).signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/order") {
      payload = params;
      return {
        orderId: 1,
        status: "NEW",
        origQty: String(params.quantity || ""),
      };
    }
    return {};
  };

  await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 2.789,
  });

  assert.equal(payload?.quantity, "2");
});

test("limit orders keep LOT_SIZE quantity precision and clamp price to tick size", async () => {
  const exchange = createExchange(DEFAULT_SPECS);

  let payload: RequestParams | undefined;
  (exchange as any).signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/order") {
      payload = params;
      return {
        orderId: 2,
        status: "NEW",
        price: String(params.price || ""),
        origQty: String(params.quantity || ""),
      };
    }
    return {};
  };

  await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.LIMIT,
    quantity: 2.789,
    price: 65234.56,
  });

  assert.equal(payload?.quantity, "2.789");
  assert.equal(payload?.price, "65234.5");
});

test("conditional algo orders use MARKET_LOT_SIZE and price tick precision", async () => {
  const exchange = createExchange(DEFAULT_SPECS);

  let payload: RequestParams | undefined;
  (exchange as any).signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/algoOrder") {
      payload = params;
      return { algoId: "algo-1" };
    }
    return {};
  };

  await exchange.placeStopLoss(
    "BTCUSDT",
    65234.56,
    65234.56,
    OrderSide.SELL,
    2.789,
  );

  assert.equal(payload?.quantity, "2");
  assert.equal(payload?.triggerPrice, "65234.5");
  assert.equal(payload?.algoType, "CONDITIONAL");
});

test("take-profit algo orders normalize symbols and trigger prices", async () => {
  const exchange = createExchange(DEFAULT_SPECS);

  let payload: RequestParams | undefined;
  (exchange as any).signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/algoOrder") {
      payload = params;
      return { algoId: "algo-tp-1" };
    }
    return {};
  };

  const orderId = await exchange.placeTakeProfit(
    "btc-usdt",
    70123.45,
    70123.45,
    OrderSide.SELL,
    2.345,
  );

  assert.equal(orderId, "algo-tp-1");
  assert.equal(payload?.symbol, "BTCUSDT");
  assert.equal(payload?.algoType, "CONDITIONAL");
  assert.equal(payload?.side, "SELL");
  assert.equal(payload?.workingType, "MARK_PRICE");
  assert.equal(payload?.quantity, "2");
  assert.equal(payload?.triggerPrice, "70123.4");
});

test("getAlgoOrders prefers Binance algo endpoint and normalizes rows", async () => {
  const exchange = createExchange(DEFAULT_SPECS);

  (exchange as any).signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/openAlgoOrders") {
      assert.equal(params.symbol, "BTCUSDT");
      assert.equal(params.algoType, "CONDITIONAL");
      return [
        {
          algoId: 123,
          symbol: "BTCUSDT",
          side: "SELL",
          type: "TAKE_PROFIT_MARKET",
          triggerPrice: "65234.5",
          quantity: "2",
          algoStatus: "NEW",
          updateTime: 1234567890,
        },
      ];
    }
    return [];
  };

  const orders = await exchange.getAlgoOrders("BTCUSDT");

  assert.deepEqual(orders, [
    {
      orderId: "123",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "tp",
      triggerPrice: 65234.5,
      executePrice: undefined,
      quantity: 2,
      status: "NEW",
      createdAt: 1234567890,
      raw: {
        algoId: 123,
        symbol: "BTCUSDT",
        side: "SELL",
        type: "TAKE_PROFIT_MARKET",
        triggerPrice: "65234.5",
        quantity: "2",
        algoStatus: "NEW",
        updateTime: 1234567890,
      },
    },
  ]);
});

test("cancelAlgoOrders uses Binance bulk algo cancel endpoint", async () => {
  const exchange = createExchange(DEFAULT_SPECS);

  const calls: Array<{ path: string; params: RequestParams }> = [];
  (exchange as any).signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    calls.push({ path, params });
    if (path === "/fapi/v1/openAlgoOrders") {
      return [
        {
          algoId: 123,
          symbol: "BTCUSDT",
          side: "SELL",
          type: "STOP_MARKET",
          triggerPrice: "61234.5",
          quantity: "2",
          algoStatus: "NEW",
        },
      ];
    }
    if (path === "/fapi/v1/algoOpenOrders") {
      return { success: true };
    }
    return {};
  };

  const result = await exchange.cancelAlgoOrders("BTCUSDT");

  assert.deepEqual(result, { cancelled: ["123"], errors: [] });
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/fapi/v1/openAlgoOrders", "/fapi/v1/algoOpenOrders"],
  );
});

test("Binance getAlgoOrders skips malformed rows and cancelAlgoOrders returns early when nothing is open", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/openAlgoOrders") {
      assert.equal(params.symbol, undefined);
      assert.equal(params.algoType, "CONDITIONAL");
      return [
        {
          algoId: 321,
          symbol: "BTCUSDT",
          type: "STOP_MARKET",
          triggerPrice: "61000",
          quantity: "1",
        },
      ];
    }
    throw new Error(`Unexpected path ${path}`);
  };

  assert.deepEqual(await exchange.getAlgoOrders(), []);

  exchange.getAlgoOrders = async () => [];
  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: [],
    errors: [],
  });
});

test("reads account, ticker, klines, and open positions through normalized adapters", async () => {
  const exchange = new BinanceExchange("key", "secret") as any;

  exchange.signedRequest = async (_method: string, path: string) => {
    if (path === "/fapi/v2/account") {
      return {
        totalWalletBalance: "1000.5",
        availableBalance: "777.7",
        totalUnrealizedProfit: "-12.3",
      };
    }
    if (path === "/fapi/v2/positionRisk") {
      return [
        {
          symbol: "BTCUSDT",
          positionAmt: "0.5",
          entryPrice: "64000",
          markPrice: "65000",
          unRealizedProfit: "10",
          liquidationPrice: "50000",
          leverage: "8",
          isolated: true,
          isolatedWallet: "40",
          positionSide: "LONG",
        },
        {
          symbol: "ETHUSDT",
          positionAmt: "-1.25",
          entryPrice: "3000",
          markPrice: "2900",
          unRealizedProfit: "-15",
          liquidationPrice: "3500",
          leverage: "5",
          isolated: false,
          initialMargin: "55",
        },
        {
          symbol: "XRPUSDT",
          positionAmt: "0",
          entryPrice: "0",
          markPrice: "0",
          unRealizedProfit: "0",
          liquidationPrice: "0",
          leverage: "1",
          isolated: false,
        },
      ];
    }
    throw new Error(`Unexpected signedRequest path: ${path}`);
  };

  exchange.publicRequest = async (path: string) => {
    if (path === "/fapi/v1/ticker/price") {
      return { symbol: "BTCUSDT", price: "65000.25" };
    }
    if (path === "/fapi/v1/klines") {
      return [[1, "10", "12", "9", "11", "100"]];
    }
    throw new Error(`Unexpected publicRequest path: ${path}`);
  };

  assert.deepEqual(await exchange.getAccountInfo(), {
    totalBalance: 1000.5,
    availableBalance: 777.7,
    unrealizedPnl: -12.3,
    currency: "USDT",
  });
  assert.equal(await exchange.getTickerPrice("btc/usdt"), 65000.25);
  assert.deepEqual(await exchange.getKlines("btc_usdt"), [
    { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 },
  ]);
  assert.deepEqual(await exchange.getOpenPositions(), [
    {
      symbol: "BTCUSDT",
      positionId: "BTCUSDT:LONG",
      side: "LONG",
      leverage: 8,
      marginType: "isolated",
      entryPrice: 64000,
      quantity: 0.5,
      margin: 40,
      unrealizedPnl: 10,
      liquidationPrice: 50000,
      markPrice: 65000,
      raw: {
        symbol: "BTCUSDT",
        positionAmt: "0.5",
        entryPrice: "64000",
        markPrice: "65000",
        unRealizedProfit: "10",
        liquidationPrice: "50000",
        leverage: "8",
        isolated: true,
        isolatedWallet: "40",
        positionSide: "LONG",
      },
    },
    {
      symbol: "ETHUSDT",
      positionId: "ETHUSDT:BOTH",
      side: "SHORT",
      leverage: 5,
      marginType: "cross",
      entryPrice: 3000,
      quantity: 1.25,
      margin: 55,
      unrealizedPnl: -15,
      liquidationPrice: 3500,
      markPrice: 2900,
      raw: {
        symbol: "ETHUSDT",
        positionAmt: "-1.25",
        entryPrice: "3000",
        markPrice: "2900",
        unRealizedProfit: "-15",
        liquidationPrice: "3500",
        leverage: "5",
        isolated: false,
        initialMargin: "55",
      },
    },
  ]);
});

test("placeOrder validates quantity and limit price requirements", async () => {
  const exchange = createExchange(DEFAULT_SPECS);

  await assert.rejects(
    () =>
      exchange.placeOrder({
        symbol: "BTCUSDT",
        side: OrderSide.BUY,
        type: ExchangeOrderType.MARKET,
        quantity: 0.4,
      }),
    /Order quantity too small/,
  );

  await assert.rejects(
    () =>
      exchange.placeOrder({
        symbol: "BTCUSDT",
        side: OrderSide.BUY,
        type: ExchangeOrderType.LIMIT,
        quantity: 1,
      }),
    /LIMIT order requires a valid price/,
  );
});

test("closePosition filters by position side, clamps quantity, and errors when nothing is open", async () => {
  const exchange = createExchange({
    ...DEFAULT_SPECS,
    marketLotSz: 0.1,
    marketMinSz: 0.1,
    marketQtyDecimals: 1,
  }) as any;
  const orderPayloads: RequestParams[] = [];

  exchange.signedRequest = async (
    method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (method === "GET" && path === "/fapi/v2/positionRisk") {
      if (params.symbol === "MISSINGUSDT") return [];
      return [
        {
          symbol: "BTCUSDT",
          positionAmt: "1.9",
          positionSide: "LONG",
        },
        {
          symbol: "BTCUSDT",
          positionAmt: "-0.7",
          positionSide: "SHORT",
        },
      ];
    }
    if (method === "POST" && path === "/fapi/v1/order") {
      orderPayloads.push(params);
      return {};
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  await exchange.closePosition("BTCUSDT", "BTCUSDT:SHORT", 0.9);

  assert.deepEqual(orderPayloads, [
    {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: "0.7",
      reduceOnly: true,
      newOrderRespType: "RESULT",
      positionSide: "SHORT",
    },
  ]);

  await assert.rejects(
    () => exchange.closePosition("MISSINGUSDT"),
    /No open Binance position found/,
  );
});

test("closeAllPositions aggregates close failures and top-level fetch failures", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  exchange.getOpenPositions = async () => [
    { symbol: "BTCUSDT", side: "LONG", positionId: "BTCUSDT:LONG" },
    { symbol: "ETHUSDT", side: "SHORT", positionId: "ETHUSDT:SHORT" },
  ];
  exchange.closePosition = async (symbol: string) => {
    if (symbol === "ETHUSDT") throw new Error("reject");
  };

  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: ["BTCUSDT (LONG)"],
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

test("getOpenOrders and cancelOrder normalize responses and handle unknown-order failures", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  exchange.signedRequest = async (
    method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (method === "GET" && path === "/fapi/v1/openOrders") {
      assert.equal(params.symbol, "BTCUSDT");
      return [
        {
          orderId: 11,
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          price: "65000",
          origQty: "0.25",
          executedQty: "0.05",
          status: "NEW",
          time: 123,
        },
      ];
    }
    if (method === "DELETE" && path === "/fapi/v1/order") {
      if (params.orderId === "gone") {
        throw new Error("[Binance] DELETE /fapi/v1/order failed code=-2011: Unknown order");
      }
      if (params.orderId === "boom") {
        throw new Error("fatal");
      }
      return {};
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  assert.deepEqual(await exchange.getOpenOrders("btc-usdt"), [
    {
      orderId: "11",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: 65000,
      quantity: 0.25,
      filledQuantity: 0.05,
      status: "NEW",
      createdAt: 123,
      raw: {
        orderId: 11,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "65000",
        origQty: "0.25",
        executedQty: "0.05",
        status: "NEW",
        time: 123,
      },
    },
  ]);
  assert.equal(await exchange.cancelOrder("123", "BTCUSDT"), true);
  assert.equal(await exchange.cancelOrder("gone", "BTCUSDT"), false);
  await assert.rejects(() => exchange.cancelOrder("boom", "BTCUSDT"), /fatal/);
});

test("getAlgoOrders falls back to legacy open orders and cancelAlgoOrders falls back per order", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

  try {
    exchange.getOpenOrders = async () => [
      {
        orderId: "legacy-stop",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "STOP_MARKET",
        price: undefined,
        quantity: 1.5,
        filledQuantity: 0,
        status: "NEW",
        createdAt: 5,
        raw: { stopPrice: "61000", updateTime: 7 },
      },
      {
        orderId: "plain-limit",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: 62000,
        quantity: 1,
        filledQuantity: 0,
        status: "NEW",
        createdAt: 6,
        raw: {},
      },
    ];

    exchange.signedRequest = async (
      method: string,
      path: string,
      params: RequestParams = {},
    ) => {
      if (method === "GET" && path === "/fapi/v1/openAlgoOrders") {
        throw new Error("algo endpoint unavailable");
      }
      if (method === "DELETE" && path === "/fapi/v1/algoOpenOrders") {
        throw new Error("bulk delete failed");
      }
      if (method === "DELETE" && path === "/fapi/v1/algoOrder") {
        if (params.algoId === "legacy-stop") return {};
        throw new Error("single delete failed");
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    };

    assert.deepEqual(await exchange.getAlgoOrders("BTCUSDT"), [
      {
        orderId: "legacy-stop",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "sl",
        triggerPrice: 61000,
        executePrice: undefined,
        quantity: 1.5,
        status: "NEW",
        createdAt: 7,
        raw: { stopPrice: "61000", updateTime: 7 },
      },
    ]);

    assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
      cancelled: ["legacy-stop"],
      errors: [],
    });

    exchange.getOpenOrders = async () => [];
    assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
      cancelled: [],
      errors: [],
    });
    assert.equal(warnings.some((line) => line.includes("Falling back to legacy algo-order discovery")), true);
  } finally {
    console.warn = originalWarn;
  }
});

test("getOrderHistory returns empty for no symbols and sorts combined results by update time", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  exchange.getOpenPositions = async () => [];
  assert.deepEqual(await exchange.getOrderHistory(undefined, 10), []);

  exchange.getOpenPositions = async () => [
    { symbol: "BTCUSDT" },
    { symbol: "ETHUSDT" },
    { symbol: "BTCUSDT" },
  ];
  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    assert.equal(path, "/fapi/v1/allOrders");
    if (params.symbol === "BTCUSDT") {
      return [
        {
          orderId: 1,
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          price: "0",
          avgPrice: "65000",
          origQty: "1",
          executedQty: "1",
          status: "FILLED",
          time: 1,
          updateTime: 10,
        },
      ];
    }
    return [
      {
        orderId: 2,
        symbol: "ETHUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "3000",
        avgPrice: "0",
        origQty: "2",
        executedQty: "1",
        status: "PARTIALLY_FILLED",
        time: 2,
        updateTime: 5,
      },
    ];
  };

  assert.deepEqual(await exchange.getOrderHistory(undefined, 5), [
    {
      orderId: "1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      price: 65000,
      quantity: 1,
      filledQuantity: 1,
      fee: 0,
      status: "FILLED",
      createdAt: 1,
      updatedAt: 10,
      raw: {
        orderId: 1,
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        price: "0",
        avgPrice: "65000",
        origQty: "1",
        executedQty: "1",
        status: "FILLED",
        time: 1,
        updateTime: 10,
      },
    },
    {
      orderId: "2",
      symbol: "ETHUSDT",
      side: "SELL",
      type: "LIMIT",
      price: 3000,
      quantity: 2,
      filledQuantity: 1,
      fee: 0,
      status: "PARTIALLY_FILLED",
      createdAt: 2,
      updatedAt: 5,
      raw: {
        orderId: 2,
        symbol: "ETHUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "3000",
        avgPrice: "0",
        origQty: "2",
        executedQty: "1",
        status: "PARTIALLY_FILLED",
        time: 2,
        updateTime: 5,
      },
    },
  ]);
});

test("Binance cancelAlgoOrders records per-order fallback errors and getOrderHistory supports an explicit symbol", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  exchange.getAlgoOrders = async () => [
    {
      orderId: "algo-bad-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "sl",
      triggerPrice: 61000,
      quantity: 1,
      status: "NEW",
    },
  ];
  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/algoOpenOrders") {
      throw new Error("bulk delete failed");
    }
    if (path === "/fapi/v1/algoOrder") {
      throw "single delete raw failure";
    }
    if (path === "/fapi/v1/allOrders") {
      assert.equal(params.symbol, "BTCUSDT");
      assert.equal(params.limit, 1);
      return [
        {
          orderId: 99,
          symbol: "BTCUSDT",
          side: "SELL",
          type: "LIMIT",
          price: "62000",
          avgPrice: "0",
          origQty: "0.5",
          executedQty: "0.1",
          status: "NEW",
          time: 7,
          updateTime: 8,
        },
      ];
    }
    throw new Error(`Unexpected path ${path}`);
  };

  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: [],
    errors: ["algo-bad-1: Unknown error"],
  });
  assert.deepEqual(await exchange.getOrderHistory("btc-usdt", 1), [
    {
      orderId: "99",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: 62000,
      quantity: 0.5,
      filledQuantity: 0.1,
      fee: 0,
      status: "NEW",
      createdAt: 7,
      updatedAt: 8,
      raw: {
        orderId: 99,
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "62000",
        avgPrice: "0",
        origQty: "0.5",
        executedQty: "0.1",
        status: "NEW",
        time: 7,
        updateTime: 8,
      },
    },
  ]);
});

test("instrument specs cache and missing-instrument branches work as expected", async () => {
  const exchange = new BinanceExchange("key", "secret") as any;
  let calls = 0;

  exchange.publicRequest = async (_path: string, params: RequestParams = {}) => {
    calls += 1;
    if (params.symbol === "BTCUSDT") {
      return {
        symbols: [
          {
            symbol: "BTCUSDT",
            baseAsset: "BTC",
            quantityPrecision: 3,
            pricePrecision: 1,
            filters: [
              { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001" },
              { filterType: "PRICE_FILTER", tickSize: "0.1" },
            ],
          },
        ],
      };
    }
    return { symbols: [] };
  };

  const first = await exchange.getInstrumentSpecs("BTCUSDT");
  const second = await exchange.getInstrumentSpecs("BTCUSDT");

  assert.equal(first, second);
  assert.equal(calls, 1);
  await assert.rejects(
    () => exchange.getInstrumentSpecs("DOGEUSDT"),
    /Instrument not found on Binance: DOGEUSDT/,
  );
});

test("signed requests include payload in the Binance error message for DB logs", async () => {
  const exchange = createExchange({
    ctVal: 1,
    lotSz: 0.001,
    minSz: 0.001,
    ctValCcy: "BTC",
    tickSz: 0.1,
    qtyDecimals: 3,
    priceDecimals: 1,
    marketLotSz: 1,
    marketMinSz: 1,
    marketQtyDecimals: 0,
  }) as any;

  exchange.client.request = async () => {
    throw {
      isAxiosError: true,
      message: "Request failed with status code 400",
      response: {
        status: 400,
        data: {
          code: -4300,
          msg: "Higher leverage not yet available",
        },
      },
    };
  };

  const originalLog = console.log;
  const originalError = console.error;
  const errorLogs: string[] = [];
  console.log = () => {};
  console.error = (message?: unknown, ...optionalParams: unknown[]) => {
    errorLogs.push([message, ...optionalParams].map(String).join(" "));
  };

  try {
    await assert.rejects(async () => {
      await exchange.signedRequest("POST", "/fapi/v1/leverage", {
        symbol: "AVAXUSDT",
        leverage: 25,
      });
    }, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /code=-4300/);
      assert.match(
        error.message,
        /\| payload=\{"symbol":"AVAXUSDT","leverage":25\}/,
      );
      return true;
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.match(
    errorLogs.join("\n"),
    /Payload: \{"symbol":"AVAXUSDT","leverage":25\}/,
  );
  assert.match(errorLogs.join("\n"), /"code":-4300/);
});

test("instrument specs prefer filter precision over exchange precision fields", async () => {
  const exchange = new BinanceExchange("key", "secret") as any;

  exchange.publicRequest = async () => ({
    symbols: [
      {
        symbol: "STBLUSDT",
        baseAsset: "STBL",
        quantityPrecision: 3,
        pricePrecision: 2,
        filters: [
          {
            filterType: "LOT_SIZE",
            stepSize: "0.001",
            minQty: "0.001",
          },
          {
            filterType: "MARKET_LOT_SIZE",
            stepSize: "1.00000000",
            minQty: "1.00000000",
          },
          {
            filterType: "PRICE_FILTER",
            tickSize: "0.00001",
          },
        ],
      },
    ],
  });

  const specs = await exchange.getInstrumentSpecs("STBLUSDT");

  assert.equal(specs.qtyDecimals, 3);
  assert.equal(specs.marketQtyDecimals, 0);
  assert.equal(specs.priceDecimals, 5);
});

test("setLeverage falls back to 20x when Binance blocks higher leverage for new accounts", async () => {
  const exchange = createExchange({
    ctVal: 1,
    lotSz: 0.001,
    minSz: 0.001,
    ctValCcy: "BTC",
    tickSz: 0.1,
    qtyDecimals: 3,
    priceDecimals: 1,
    marketLotSz: 1,
    marketMinSz: 1,
    marketQtyDecimals: 0,
  }) as any;

  const attempts: number[] = [];

  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/marginType") {
      return {};
    }
    if (path === "/fapi/v1/leverage") {
      attempts.push(Number(params.leverage));
      if (attempts.length === 1) {
        throw new Error(
          "[Binance] POST /fapi/v1/leverage failed code=-4300: higher leverage available later",
        );
      }
      return {};
    }
    return {};
  };

  const applied = await exchange.setLeverage("UNIUSDT", 31);

  assert.equal(applied, 20);
  assert.deepEqual(attempts, [31, 20]);
});

test("setLeverage treats marginType -4046 as informational and still applies leverage", async () => {
  const exchange = createExchange({
    ctVal: 1,
    lotSz: 0.001,
    minSz: 0.001,
    ctValCcy: "BTC",
    tickSz: 0.1,
    qtyDecimals: 3,
    priceDecimals: 1,
    marketLotSz: 1,
    marketMinSz: 1,
    marketQtyDecimals: 0,
  }) as any;

  const infoLogs: string[] = [];
  const errorLogs: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]) => infoLogs.push(args.join(" "));
  console.error = (...args: unknown[]) => errorLogs.push(args.join(" "));

  try {
    exchange.client.request = async (config: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
    }) => {
      if (config.url?.startsWith("/fapi/v1/marginType?")) {
        const err: any = new Error("Request failed with status code 400");
        err.response = {
          status: 400,
          data: { code: -4046, msg: "No need to change margin type." },
        };
        throw err;
      }

      if (config.url?.startsWith("/fapi/v1/leverage?")) {
        return { data: {} };
      }

      throw new Error(`Unexpected request: ${config.method} ${config.url}`);
    };

    const applied = await exchange.setLeverage("BTCUSDT", 23);
    assert.equal(applied, 23);
    assert.equal(errorLogs.length, 0);
    assert.ok(infoLogs.some((line) => line.includes("/fapi/v1/marginType skipped")));
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});

test("Binance private helpers cover precision parsing, algo parsing, and payload-free normalization", () => {
  const exchange = new BinanceExchange("key", "secret") as any;

  assert.equal(exchange.countDecimals(Number.NaN), 0);
  assert.equal(exchange.countDecimals(0.000001), 6);
  assert.equal(exchange.countDecimals(1e-7), 7);
  assert.equal(exchange.precisionFromStepString(undefined), undefined);
  assert.equal(exchange.precisionFromStepString("1"), 0);
  assert.equal(exchange.precisionFromStepString("0.001000"), 3);
  assert.equal(exchange.pickPrecision(undefined, "0.0100", 1), 2);
  assert.equal(exchange.pickPrecision(4, undefined, 1), 4);
  assert.equal(exchange.pickPrecision(undefined, undefined, 0.125), 3);

  assert.equal(exchange.parseAlgoType("TRAILING_STOP_MARKET"), "sl");
  assert.equal(exchange.parseAlgoType("LIMIT"), "conditional");
  assert.equal(exchange.parseAlgoOrderId({ algoId: "", clientAlgoId: "" }), null);
  assert.equal(exchange.parseAlgoOrderId({ clientAlgoId: "client-1" }), "client-1");

  assert.match(
    exchange.normalizeError(new Error("boom"), "GET /x").message,
    /\[Binance\] GET \/x failed: boom/,
  );
  assert.match(
    exchange.normalizeError(
      {
        isAxiosError: true,
        message: "axios boom",
        response: { data: { code: -1000 } },
      },
      "POST /y",
    ).message,
    /\[Binance\] POST \/y failed code=-1000: axios boom/,
  );
  assert.equal(
    exchange.isIgnorableMarginTypeError(
      { response: { data: { msg: "No need to change margin type." } } },
      "/fapi/v1/marginType",
    ),
    true,
  );
  assert.equal(
    exchange.isIgnorableMarginTypeError(
      { isAxiosError: true, response: { data: { code: -4046 } } },
      "/fapi/v1/marginType",
    ),
    true,
  );
  assert.equal(
    exchange.isIgnorableMarginTypeError(
      { isAxiosError: true, response: { data: { code: -9999 } } },
      "/fapi/v1/marginType",
    ),
    false,
  );
  assert.equal(
    exchange.isIgnorableMarginTypeError(
      { response: {} },
      "/fapi/v1/marginType",
    ),
    false,
  );
});

test("Binance constructor proxy interceptor attaches agents and tolerates proxy lookup failures", async () => {
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

    const { BinanceExchange: MockedBinanceExchange } = await import("./BinanceExchange");
    const exchange = new MockedBinanceExchange(" key ", " secret ") as any;
    const interceptor = exchange.client.interceptors.request.handlers[0];

    const first = await interceptor.fulfilled({ headers: {} });
    assert.equal(first.httpsAgent, proxyAgent);
    assert.equal(first.httpAgent, proxyAgent);

    const second = await interceptor.fulfilled({ headers: {} });
    assert.equal(second.httpsAgent, undefined);
    assert.equal(second.httpAgent, undefined);
    assert.equal(exchange.apiKey, "key");
    assert.equal(exchange.secretKey, "secret");
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

test("Binance request logging covers axios messages without bodies and non-axios failures", () => {
  const exchange = new BinanceExchange("key", "secret") as any;
  const errorLogs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errorLogs.push(args.join(" "));

  try {
    exchange.logSignedRequestError(
      {
        isAxiosError: true,
        message: "timeout",
        response: { status: 504 },
      },
      "POST",
      "/fapi/v1/order",
      { symbol: "BTCUSDT" },
    );
    exchange.logSignedRequestError(
      "plain failure",
      "DELETE",
      "/fapi/v1/order",
      { symbol: "BTCUSDT" },
    );

    assert.equal(errorLogs.some((line) => line.includes("timeout")), true);
    assert.equal(errorLogs.some((line) => line.includes("plain failure")), true);
  } finally {
    console.error = originalError;
  }
});

test("Binance helper requests and leverage bracket logic cover success and error branches", async () => {
  const exchange = new BinanceExchange("key", "secret") as any;

  exchange.client.get = async (path: string, config?: { params?: RequestParams }) => {
    if (path === "/public-ok") {
      assert.deepEqual(config?.params, { symbol: "BTCUSDT" });
      return { data: { ok: true } };
    }
    throw new Error("public down");
  };

  assert.deepEqual(await exchange.publicRequest("/public-ok", { symbol: "BTCUSDT" }), {
    ok: true,
  });
  await assert.rejects(
    () => exchange.publicRequest("/public-bad"),
    /\[Binance\] GET \/public-bad failed: public down/,
  );

  exchange.signedRequest = async (_method: string, path: string) => {
    if (path === "/fapi/v1/leverageBracket") {
      return [
        {
          symbol: "ETHUSDT",
          brackets: [{ initialLeverage: "7" }, { initialLeverage: "21" }],
        },
      ];
    }
    throw new Error("bracket down");
  };

  assert.equal(await exchange.getMaxAllowedLeverage("ETHUSDT"), 21);

  exchange.signedRequest = async () => {
    throw new Error("bracket down");
  };
  assert.equal(await exchange.getMaxAllowedLeverage("ETHUSDT"), null);
});

test("Binance conditional and market order fallbacks cover missing algo ids and local quantity fallback", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  exchange.signedRequest = async (_method: string, path: string, params: RequestParams = {}) => {
    if (path === "/fapi/v1/algoOrder") {
      return { symbol: params.symbol };
    }
    if (path === "/fapi/v1/order") {
      return {
        orderId: 55,
        status: "NEW",
        avgPrice: "0",
        price: "0",
      };
    }
    throw new Error(`Unexpected path ${path}`);
  };
  exchange.getTickerPrice = async () => 64000;

  await assert.rejects(
    () => exchange.placeStopLoss("BTCUSDT", 61000, 61000, OrderSide.SELL, 2),
    /Conditional order accepted but no algoId returned/,
  );

  const result = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 2.789,
  });

  assert.deepEqual(result, {
    orderId: "55",
    price: 64000,
    quantity: 2,
    status: "NEW",
    raw: {
      orderId: 55,
      status: "NEW",
      avgPrice: "0",
      price: "0",
    },
  });
});

test("setLeverage falls back to the reported max leverage when bracket data is available", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;
  const attempts: number[] = [];

  exchange.getMaxAllowedLeverage = async () => 17;
  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/marginType") {
      return {};
    }
    if (path === "/fapi/v1/leverage") {
      attempts.push(Number(params.leverage));
      if (attempts.length === 1) {
        throw new Error(
          "[Binance] POST /fapi/v1/leverage failed code=-4028: leverage adjustment not allowed",
        );
      }
      return {};
    }
    throw new Error(`Unexpected path ${path}`);
  };

  const applied = await exchange.setLeverage("XRPUSDT", 25);

  assert.equal(applied, 17);
  assert.deepEqual(attempts, [25, 17]);
});

test("Binance leverage fallback covers 20x, 10x, and unrecoverable failures", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;

  const attempts20: number[] = [];
  exchange.getMaxAllowedLeverage = async () => null;
  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/marginType") return {};
    if (path === "/fapi/v1/leverage") {
      attempts20.push(Number(params.leverage));
      if (attempts20.length === 1) {
        throw new Error(
          "[Binance] POST /fapi/v1/leverage failed code=-4028: leverage adjustment not allowed",
        );
      }
      return {};
    }
    throw new Error(`Unexpected path ${path}`);
  };
  assert.equal(await exchange.setLeverage("BTCUSDT", 25), 20);
  assert.deepEqual(attempts20, [25, 20]);

  const attempts10: number[] = [];
  exchange.signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/marginType") return {};
    if (path === "/fapi/v1/leverage") {
      attempts10.push(Number(params.leverage));
      if (attempts10.length === 1) {
        throw new Error(
          "[Binance] POST /fapi/v1/leverage failed code=-4028: leverage adjustment not allowed",
        );
      }
      return {};
    }
    throw new Error(`Unexpected path ${path}`);
  };
  assert.equal(await exchange.setLeverage("ETHUSDT", 15), 10);
  assert.deepEqual(attempts10, [15, 10]);

  exchange.signedRequest = async (_method: string, path: string) => {
    if (path === "/fapi/v1/marginType") return {};
    throw new Error("hard fail");
  };
  await assert.rejects(() => exchange.setLeverage("XRPUSDT", 5), /hard fail/);
});

test("Binance placeOrder applies leverage when requested and algo cancel fallback can surface only the bulk error", async () => {
  const exchange = createExchange(DEFAULT_SPECS) as any;
  const leverageCalls: Array<{ symbol: string; leverage: number }> = [];

  exchange.setLeverage = async (symbol: string, leverage: number) => {
    leverageCalls.push({ symbol, leverage });
    return leverage;
  };
  exchange.signedRequest = async (_method: string, path: string, params: RequestParams = {}) => {
    if (path === "/fapi/v1/order") {
      return {
        orderId: 321,
        status: "FILLED",
        price: "65010",
        origQty: String(params.quantity || ""),
      };
    }
    throw new Error(`Unexpected path ${path}`);
  };

  const order = await exchange.placeOrder({
    symbol: "btcusdt",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 2.4,
    leverage: 6,
  });

  assert.deepEqual(leverageCalls, [{ symbol: "BTCUSDT", leverage: 6 }]);
  assert.equal(order.orderId, "321");

  const weirdAlgoOrders: any = [{ orderId: "ghost-1" }];
  weirdAlgoOrders[Symbol.iterator] = function* () {};
  exchange.getAlgoOrders = async () => weirdAlgoOrders;
  exchange.signedRequest = async (_method: string, path: string) => {
    if (path === "/fapi/v1/algoOpenOrders") {
      throw "bulk cancelled nothing";
    }
    throw new Error(`Unexpected path ${path}`);
  };

  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: [],
    errors: ["Unknown error"],
  });
});
