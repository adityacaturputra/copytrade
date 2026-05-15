import { test } from "vitest";
import assert from "node:assert/strict";
import { BinanceExchange } from "./binance/index";
import { BybitExchange } from "./bybit/index";
import { MetaTraderExchange } from "./metatrader/index";
import { MexcExchange } from "./mexc/index";
import { OkxExchange } from "./okx/index";
import { PaperExchange } from "./paper/index";
import {
  exchangeSupportsDirectAlgoCancel,
  getExchangeProviderRuntime,
} from "./provider-runtime";

test("provider runtimes create the expected exchange clients", () => {
  assert.ok(getExchangeProviderRuntime("paper")?.createClient() instanceof PaperExchange);
  assert.ok(
    getExchangeProviderRuntime("binance")?.createClient({
      provider: "binance",
      apiKey: "key",
      secretKey: "secret",
      simulated: true,
    }) instanceof BinanceExchange,
  );
  assert.ok(
    getExchangeProviderRuntime("bybit")?.createClient({
      provider: "bybit",
      apiKey: "key",
      secretKey: "secret",
    }) instanceof BybitExchange,
  );
  assert.ok(
    getExchangeProviderRuntime("okx")?.createClient({
      provider: "okx",
      apiKey: "key",
      secretKey: "secret",
      passphrase: "pass",
    }) instanceof OkxExchange,
  );
  assert.ok(
    getExchangeProviderRuntime("mexc")?.createClient({
      provider: "mexc",
      apiKey: "key",
      secretKey: "secret",
    }) instanceof MexcExchange,
  );
  assert.ok(
    getExchangeProviderRuntime("metatrader")?.createClient({
      provider: "metatrader",
      baseUrl: "http://localhost:4000",
      login: "123",
      password: "pass",
      server: "broker",
      platform: "mt5",
    }) instanceof MetaTraderExchange,
  );
});

test("provider runtimes validate required credentials and capabilities", () => {
  assert.equal(getExchangeProviderRuntime("invalid"), null);
  assert.equal(exchangeSupportsDirectAlgoCancel("binance"), true);
  assert.equal(exchangeSupportsDirectAlgoCancel("paper"), false);

  assert.throws(
    () =>
      getExchangeProviderRuntime("okx")?.createClient({
        provider: "okx",
        apiKey: "key",
      } as never),
    /OKX secretKey, passphrase must be configured/,
  );
});
