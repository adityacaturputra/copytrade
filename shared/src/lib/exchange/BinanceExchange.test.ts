import { test } from "vitest";
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
