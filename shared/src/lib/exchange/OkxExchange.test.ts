import { test } from "vitest";
import assert from "node:assert/strict";
import { OkxExchange } from "./OkxExchange";
import { ExchangeOrderType, OrderSide } from "../enums";

test("okx order failures include payload in thrown error messages", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  exchange.accountConfigCache = {
    posMode: "long_short_mode",
    ts: Date.now(),
  };

  exchange.validateInstrument = async () => ({
    instId: "BTC-USDT-SWAP",
    ctVal: "1",
    lotSz: "1",
    minSz: "1",
  });
  exchange.setLeverage = async () => {};

  exchange.client.post = async () => ({
    data: {
      code: "1",
      msg: "Parameter error",
      data: [{ sCode: "51001", sMsg: "General parameter error" }],
    },
  });

  await assert.rejects(
    exchange.placeOrder({
      symbol: "BTCUSDT",
      side: OrderSide.BUY,
      type: ExchangeOrderType.MARKET,
      quantity: 1,
      leverage: 5,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /OKX order failed: \[51001\] General parameter error/);
      assert.match(
        error.message,
        /\| payload=\{"instId":"BTC-USDT-SWAP","tdMode":"isolated","side":"buy","ordType":"market","sz":"1","posSide":"long"\}/,
      );
      return true;
    },
  );
});

test("okx posSide errors trigger auto-fix retry", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  exchange.accountConfigCache = {
    posMode: "long_short_mode",
    ts: Date.now(),
  };

  exchange.validateInstrument = async () => ({
    instId: "BTC-USDT-SWAP",
    ctVal: "1",
    lotSz: "1",
    minSz: "1",
  });
  exchange.setLeverage = async () => {};
  exchange.getTickerPrice = async () => 65000;

  let ensured = 0;
  exchange.ensureAccountConfigured = async () => {
    ensured += 1;
  };

  let postCalls = 0;
  exchange.client.post = async () => {
    postCalls += 1;
    if (postCalls === 1) {
      return {
        data: {
          code: "1",
          msg: "Parameter error",
          data: [{ sCode: "51000", sMsg: "Parameter posSide error" }],
        },
      };
    }

    return {
      data: {
        code: "0",
        data: [{ sCode: "0", ordId: "order-123" }],
      },
    };
  };

  const result = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 1,
    leverage: 5,
  });

  assert.equal(ensured, 1);
  assert.equal(result.orderId, "order-123");
});

test("okx net mode omits posSide from order payload", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.accountConfigCache = {
    posMode: "net_mode",
    ts: Date.now(),
  };
  exchange.validateInstrument = async () => ({
    instId: "BTC-USDT-SWAP",
    ctVal: "1",
    lotSz: "1",
    minSz: "1",
  });
  exchange.setLeverage = async (symbol: string, leverage: number) => leverage;
  exchange.getTickerPrice = async () => 65000;

  let payload: Record<string, string> | undefined;
  exchange.client.post = async (_path: string, body: string) => {
    payload = JSON.parse(body);
    return {
      data: {
        code: "0",
        data: [{ sCode: "0", ordId: "order-net-1" }],
      },
    };
  };

  const result = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 1,
    leverage: 5,
  });

  assert.equal(result.orderId, "order-net-1");
  assert.ok(payload);
  assert.equal(payload?.instId, "BTC-USDT-SWAP");
  assert.equal(payload?.side, "buy");
  assert.equal("posSide" in (payload || {}), false);
});
