import { test } from "vitest";
import assert from "node:assert/strict";
import {
  parseBulkSignalResponse,
  parseJsonResponse,
  parseSignalResponse,
  parseVisionExtractionResponse,
} from "./AIResponseNormalizer";

test("parseJsonResponse handles fenced and embedded JSON", () => {
  assert.deepEqual(
    parseJsonResponse<{ action: string }>("```json\n{\"action\":\"BUY\"}\n```"),
    { action: "BUY" },
  );
  assert.deepEqual(
    parseJsonResponse<Array<{ messageId: number }>>(
      "AI output:\n[{\"messageId\":1}]",
    ),
    [{ messageId: 1 }],
  );
  assert.equal(parseJsonResponse("not json"), null);
});

test("parseSignalResponse normalizes a signal and preserves rawSignal", () => {
  const result = parseSignalResponse(
    "{\"action\":\"TAKE_PROFIT\",\"symbol\":\"BTCUSDT\",\"orderType\":\"market\"}",
    "tp raw message",
  );

  assert.equal(result?.action, "TP");
  assert.equal(result?.messageType, "position_update");
  assert.equal(result?.orderType, "market");
  assert.equal(result?.rawSignal, "tp raw message");
});

test("parseBulkSignalResponse maps results by messageId and index fallback", () => {
  const messages = [
    { messageId: "first", content: "buy" },
    { messageId: "second", content: "sell" },
  ];

  const direct = parseBulkSignalResponse(
    JSON.stringify([
      { messageId: "first", signal: { action: "BUY", symbol: "BTCUSDT" } },
      { messageId: 2, signal: { action: "SELL", symbol: "ETHUSDT" } },
    ]),
    messages,
  );

  assert.equal(direct?.[0].signal?.action, "BUY");
  assert.equal(direct?.[1].signal?.action, "SELL");
});

test("parseBulkSignalResponse falls back to sequential mapping when ids do not match", () => {
  const messages = [
    { messageId: "first", content: "buy" },
    { messageId: "second", content: "ignore" },
  ];

  const result = parseBulkSignalResponse(
    JSON.stringify([
      { messageId: "x", signal: { action: "BUY", symbol: "BTCUSDT" } },
      { messageId: "y", signal: { messageType: "ignore", action: "SELL", symbol: "ETHUSDT" } },
    ]),
    messages,
  );

  assert.equal(result?.[0].signal?.action, "BUY");
  assert.equal(result?.[1].signal, null);
  assert.equal(parseBulkSignalResponse("{\"bad\":true}", messages), null);
});

test("parseVisionExtractionResponse suppresses ignored message types", () => {
  assert.deepEqual(
    parseVisionExtractionResponse(
      "{\"isSignal\":true,\"messageType\":\"position_update\",\"extractedText\":\"Move SL to 62000\"}",
    ),
    {
      isSignal: true,
      messageType: "position_update",
      extractedText: "Move SL to 62000",
      rawResponse:
        "{\"isSignal\":true,\"messageType\":\"position_update\",\"extractedText\":\"Move SL to 62000\"}",
    },
  );

  const ignored = parseVisionExtractionResponse(
    "{\"isSignal\":true,\"messageType\":\"ignore\",\"extractedText\":\"chat only\"}",
  );
  assert.equal(ignored.isSignal, false);
  assert.equal(ignored.extractedText, "");
});
