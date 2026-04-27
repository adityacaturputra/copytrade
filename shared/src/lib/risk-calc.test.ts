import { test } from "vitest";
import assert from "node:assert/strict";
import { calculateMaxSafeLeverage, calculateRisk } from "./risk-calc";

test("calculateRisk preserves small crypto quantities", () => {
  const result = calculateRisk({
    accountBalance: 100.04,
    riskPerTradePercent: 1,
    entryPrice: 67082,
    stopLossPrice: 64875,
    minLeverage: 1,
    maxLeverage: 100,
  });

  assert.equal(result.marginUsdt, 1);
  assert.equal(result.notionalSize, 30.41);
  assert.ok(result.quantity > 0);
  assert.ok(result.quantity < 0.001);
  assert.equal(result.quantity, 0.000453285002266);
  assert.equal(result.leverage, 23);
});

test("calculateMaxSafeLeverage handles short-side fallback denominators safely", () => {
  assert.equal(calculateMaxSafeLeverage(100, 100.05, "SHORT", 0.0005), 1);
  assert.equal(calculateMaxSafeLeverage(0, 50, "LONG"), 1);
});
