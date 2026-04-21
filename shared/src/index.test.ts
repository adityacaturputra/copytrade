import { test } from "vitest";
import assert from "node:assert/strict";
import * as shared from "./index";

test("shared index re-exports AIFactory surface", () => {
  assert.equal(typeof shared.AIFactory.getAnalyzer, "function");
  assert.equal(typeof shared.AIFactory.reset, "function");
});
