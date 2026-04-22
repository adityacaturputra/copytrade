import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt,
  buildPositionAnalysisUserMessage,
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

test("position analysis prompt and user message include management rules and serialized context", () => {
  const prompt = buildPositionAnalysisPrompt();
  const message = buildPositionAnalysisUserMessage({
    currentTime: "2026-04-21T14:00:00.000Z",
    symbol: "BTCUSDT",
    side: "LONG",
    entryPrice: 100,
    currentPrice: 110,
    takeProfitTargets: [115, 120],
    stopLoss: 95,
    pnl: 12.5,
    quantity: 0.25,
    accountName: "VIP account",
    tradingPlatform: "bybit",
    sourceMessageId: "msg-1",
    sourceChannelId: "chan-1",
    sourceMessageUrl: "https://discord.com/channels/test/1",
    accountOpenPositions: [{ symbol: "ETHUSDT", side: "SHORT" }],
    discordContextMessages: [{ content: "Move SL to breakeven" }],
  } as never);
  const emptyMessage = buildPositionAnalysisUserMessage({
    currentTime: "2026-04-21T14:00:00.000Z",
    symbol: "ETHUSDT",
    side: "SHORT",
    entryPrice: 200,
    currentPrice: 180,
  } as never);

  assert.match(prompt, /Take partial profits at key levels/i);
  assert.match(prompt, /If PNL is positive >10%, recommend .* breakeven/i);
  assert.match(prompt, /If Discord context clearly says cancel\/close\/exit the trade/i);

  assert.match(message, /Price change from entry: 10\.00%/i);
  assert.match(message, /VIP account/i);
  assert.match(message, /bybit/i);
  assert.match(message, /"symbol": "ETHUSDT"/i);
  assert.match(message, /Move SL to breakeven/i);

  assert.match(emptyMessage, /Take Profit Targets: Not set/i);
  assert.match(emptyMessage, /Stop Loss: Not set/i);
  assert.match(emptyMessage, /Quantity: Unknown/i);
  assert.match(emptyMessage, /ACCOUNT OPEN POSITIONS:\s+\[\]/i);
  assert.match(emptyMessage, /DISCORD CONTEXT MESSAGES:\s+\[\]/i);
});
