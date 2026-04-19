import { test } from "vitest";
import assert from "node:assert/strict";
import { BinanceExchange } from "./BinanceExchange";
import { ExchangeOrderType, OrderSide } from "../enums";

type MockSpecs = Awaited<ReturnType<BinanceExchange["getInstrumentSpecs"]>>;
type RequestParams = Record<string, string | number | boolean | undefined>;

function createExchange(specs: MockSpecs) {
  const exchange = new BinanceExchange("key", "secret") as any;

  exchange.getInstrumentSpecs = async () => specs;
  exchange.getTickerPrice = async () => 65000;

  return exchange as BinanceExchange;
}

test("market orders clamp quantity with MARKET_LOT_SIZE", async () => {
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
  });

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
  });

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
  });

  let payload: RequestParams | undefined;
  (exchange as any).signedRequest = async (
    _method: string,
    path: string,
    params: RequestParams = {},
  ) => {
    if (path === "/fapi/v1/order") {
      payload = params;
      return { orderId: "algo-1" };
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
  assert.equal(payload?.stopPrice, "65234.5");
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
