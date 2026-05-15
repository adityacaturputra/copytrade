import { test } from "vitest";
import assert from "node:assert/strict";
import { normalizeTradingSignal } from "./signal-normalizer";

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

test("normalizeTradingSignal canonicalizes action aliases from AI responses", () => {
  const tpSignal = normalizeTradingSignal({
    action: "TAKE_PROFIT",
    symbol: "BTCUSDT",
  });
  const slSignal = normalizeTradingSignal({
    action: "MOVE_STOP_LOSS",
    symbol: "BTCUSDT",
  });

  assert.equal(tpSignal?.action, "TP");
  assert.equal(tpSignal?.messageType, "position_update");
  assert.equal(slSignal?.action, "UPDATE_SL");
  assert.equal(slSignal?.messageType, "position_update");
});
