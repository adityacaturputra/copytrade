import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeRiskConfigOverrides,
  type RiskConfig,
} from "./risk";

const baseConfig: RiskConfig = {
  riskPerTradePercent: 1,
  maxLeverage: 100,
  minLeverage: 1,
  skipNoSL: true,
  defaultRR: 3,
  defaultPositionSize: 50,
  defaultLeverage: 10,
  maxPositions: 5,
};

test("account risk overrides replace global config", () => {
  const merged = mergeRiskConfigOverrides(baseConfig, {
    riskPerTradePercent: 2.5,
  });

  assert.equal(merged.riskPerTradePercent, 2.5);
  assert.equal(merged.sources.riskPerTradePercent, "account");
  assert.equal(merged.defaultLeverage, 10);
});

test("source chat risk overrides replace account and global config", () => {
  const merged = mergeRiskConfigOverrides(
    baseConfig,
    {
      riskPerTradePercent: 2,
      defaultLeverage: 12,
    },
    {
      riskPerTradePercent: 3.5,
    },
  );

  assert.equal(merged.riskPerTradePercent, 3.5);
  assert.equal(merged.defaultLeverage, 12);
  assert.equal(merged.sources.riskPerTradePercent, "source_chat");
  assert.equal(merged.sources.defaultLeverage, "account");
});
