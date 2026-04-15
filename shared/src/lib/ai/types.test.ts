import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTradingSignal } from "./SignalNormalizer";

test("normalizeTradingSignal drops result status messages", () => {
  const signal = normalizeTradingSignal({
    messageType: "result_status",
    action: "BUY",
    symbol: "BTCUSDT",
    reasoning: "running 1R",
  });

  assert.equal(signal, null);
});

test("normalizeTradingSignal infers new_entry for BUY when messageType is absent", () => {
  const signal = normalizeTradingSignal({
    action: "BUY",
    symbol: "BTCUSDT",
    entryPrice: 95000,
  });

  assert.ok(signal);
  assert.equal(signal?.messageType, "new_entry");
  assert.equal(signal?.action, "BUY");
  assert.equal(signal?.symbol, "BTCUSDT");
});
