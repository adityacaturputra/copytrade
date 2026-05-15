import { test } from "vitest";
import assert from "node:assert/strict";
import {
  actionToOrderSide,
  actionToSide,
  closeSideForPosition,
  isEntryAction,
  signalToExchangeOrderType,
} from "./enums";

test("enum helpers map entry actions and sides correctly", () => {
  assert.equal(isEntryAction("BUY"), true);
  assert.equal(isEntryAction("SELL"), true);
  assert.equal(isEntryAction("CLOSE"), false);

  assert.equal(actionToSide("BUY"), "LONG");
  assert.equal(actionToSide("SELL"), "SHORT");
  assert.equal(actionToOrderSide("BUY"), "BUY");
  assert.equal(actionToOrderSide("SELL"), "SELL");
  assert.equal(closeSideForPosition("LONG"), "SELL");
  assert.equal(closeSideForPosition("SHORT"), "BUY");
});

test("signalToExchangeOrderType defaults to market", () => {
  assert.equal(signalToExchangeOrderType("limit"), "LIMIT");
  assert.equal(signalToExchangeOrderType("market"), "MARKET");
  assert.equal(signalToExchangeOrderType(undefined), "MARKET");
  assert.equal(signalToExchangeOrderType("anything"), "MARKET");
});
