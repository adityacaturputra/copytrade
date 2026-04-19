import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildBulkSignalParserPrompt,
  buildSignalParserPrompt,
  buildVisionExtractionPrompt,
} from "./PromptFactory";

test("signal parser prompt includes stale chart guardrails", () => {
  const prompt = buildSignalParserPrompt();

  assert.match(prompt, /stale-chart rules/i);
  assert.match(prompt, /already hit TP\/SL/i);
  assert.match(prompt, /do NOT create a new entry/i);
  assert.match(prompt, /ngacir/i);
  assert.match(prompt, /\[Chart Image Analysis\]/i);
});

test("bulk parser prompt prioritizes text freshness over old chart snapshots", () => {
  const prompt = buildBulkSignalParserPrompt();

  assert.match(prompt, /attached chart images may be OLD snapshots/i);
  assert.match(prompt, /text says the trade already ran/i);
  assert.match(prompt, /do NOT convert the old chart into a new entry/i);
});

test("vision extraction prompt rejects charts that already ran through TP", () => {
  const prompt = buildVisionExtractionPrompt();

  assert.match(prompt, /Freshness rules for chart images/i);
  assert.match(prompt, /especially above the final TP/i);
  assert.match(prompt, /especially below the final TP/i);
  assert.match(prompt, /not "new_entry"/i);
});
