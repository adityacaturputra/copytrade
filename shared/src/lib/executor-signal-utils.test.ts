import { test } from "vitest";
import assert from "node:assert/strict";
import {
  autoCalculateSLFromRR,
  autoCalculateTPFromRR,
  buildRRTargetMultipliers,
  sanitizeLeverage,
} from "./executor-signal-utils";

test("buildRRTargetMultipliers keeps fractional RR target", () => {
  assert.deepEqual(buildRRTargetMultipliers(2.5), [1, 2, 2.5]);
  assert.deepEqual(buildRRTargetMultipliers(0.5), [0.5]);
  assert.deepEqual(buildRRTargetMultipliers(3), [1, 2, 3]);
});

test("autoCalculateTPFromRR supports decimal RR values", () => {
  const targets = autoCalculateTPFromRR(100, 90, 2.5, "LONG");
  assert.deepEqual(targets, [110, 120, 125]);
});

test("executor signal utils handle invalid RR, short-side calculations, and leverage sanitization", () => {
  assert.deepEqual(buildRRTargetMultipliers(0), []);
  assert.deepEqual(buildRRTargetMultipliers(Number.NaN), []);
  assert.deepEqual(autoCalculateTPFromRR(100, 110, 2, "SHORT"), [90, 80]);
  assert.equal(autoCalculateSLFromRR(100, 120, 2, "LONG"), 90);
  assert.equal(autoCalculateSLFromRR(100, 80, 4, "SHORT"), 105);

  assert.equal(sanitizeLeverage(undefined), null);
  assert.equal(sanitizeLeverage(null), null);
  assert.equal(sanitizeLeverage(25), 25);
  assert.equal(sanitizeLeverage(Number.NaN), null);
  assert.equal(sanitizeLeverage("10x"), 10);
  assert.equal(sanitizeLeverage("10-25x"), 10);
  assert.equal(sanitizeLeverage("spot"), null);
});
