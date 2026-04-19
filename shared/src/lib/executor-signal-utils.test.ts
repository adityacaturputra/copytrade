import test from "node:test";
import assert from "node:assert/strict";
import {
  autoCalculateTPFromRR,
  buildRRTargetMultipliers,
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
