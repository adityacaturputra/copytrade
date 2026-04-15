import test from "node:test";
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
});
