import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { MarketCondition } from "../enums";

const kimiMocks = vi.hoisted(() => ({
  clients: [] as Array<Record<string, unknown>>,
  create: vi.fn(),
  buildSignalParserPrompt: vi.fn(() => "signal-prompt"),
  buildBulkSignalParserPrompt: vi.fn(() => "bulk-prompt"),
  buildPositionAnalysisPrompt: vi.fn(() => "position-prompt"),
  buildPositionAnalysisUserMessage: vi.fn((input: { symbol: string }) => `position:${input.symbol}`),
  parseSignalResponse: vi.fn(),
  parseBulkSignalResponse: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = {
      create: kimiMocks.create,
    };

    constructor(options: Record<string, unknown>) {
      kimiMocks.clients.push(options);
    }
  },
}));

vi.mock("../core/prompt-factory", () => ({
  buildSignalParserPrompt: kimiMocks.buildSignalParserPrompt,
  buildBulkSignalParserPrompt: kimiMocks.buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt: kimiMocks.buildPositionAnalysisPrompt,
  buildPositionAnalysisUserMessage: kimiMocks.buildPositionAnalysisUserMessage,
}));

vi.mock("../core/response-normalizer", () => ({
  parseSignalResponse: kimiMocks.parseSignalResponse,
  parseBulkSignalResponse: kimiMocks.parseBulkSignalResponse,
  parseJsonResponse: kimiMocks.parseJsonResponse,
}));

import { KimiAnalyzer } from "../kimi/analyzer";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.ANTHROPIC_API_KEY = "key-1";
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_MODEL;

  kimiMocks.clients.length = 0;
  kimiMocks.create.mockReset();
  kimiMocks.buildSignalParserPrompt.mockClear();
  kimiMocks.buildBulkSignalParserPrompt.mockClear();
  kimiMocks.buildPositionAnalysisPrompt.mockClear();
  kimiMocks.buildPositionAnalysisUserMessage.mockClear();
  kimiMocks.parseSignalResponse.mockReset();
  kimiMocks.parseBulkSignalResponse.mockReset();
  kimiMocks.parseJsonResponse.mockReset();
});

test("KimiAnalyzer parses signals and returns null when normalization fails", async () => {
  kimiMocks.create
    .mockResolvedValueOnce({
      content: [{ type: "text", text: '{"action":"BUY"}' }],
    })
    .mockResolvedValueOnce({
      content: [{ type: "text", text: '{"bad":true}' }],
    });
  kimiMocks.parseSignalResponse
    .mockReturnValueOnce({ action: "BUY", symbol: "BTCUSDT" })
    .mockReturnValueOnce(null);

  const analyzer = new KimiAnalyzer();
  const parsed = await analyzer.parseSignal("buy btc");
  const missing = await analyzer.parseSignal("nonsense");

  assert.deepEqual(parsed, { action: "BUY", symbol: "BTCUSDT" });
  assert.equal(missing, null);
  assert.equal(kimiMocks.create.mock.calls.length, 2);
});

test("KimiAnalyzer bulk parsing falls back to per-message parsing on invalid bulk responses", async () => {
  kimiMocks.create
    .mockResolvedValueOnce({
      content: [{ type: "text", text: '{"bulk":true}' }],
    })
    .mockResolvedValueOnce({
      content: [{ type: "text", text: '{"action":"BUY"}' }],
    })
    .mockResolvedValueOnce({
      content: [{ type: "text", text: '{"action":"SELL"}' }],
    });
  kimiMocks.parseBulkSignalResponse.mockReturnValueOnce(null);
  kimiMocks.parseSignalResponse
    .mockReturnValueOnce({ action: "BUY" })
    .mockReturnValueOnce(null);

  const analyzer = new KimiAnalyzer();
  const empty = await analyzer.parseBulkSignals([]);
  const fallback = await analyzer.parseBulkSignals([
    { messageId: "1", content: "buy btc" },
    { messageId: "2", content: "ignore" },
  ]);

  assert.deepEqual(empty, []);
  assert.deepEqual(fallback, [
    { messageId: "1", signal: { action: "BUY" } },
    { messageId: "2", signal: null },
  ]);
  assert.match(
    String(kimiMocks.create.mock.calls[0]?.[0]?.messages?.[0]?.content),
    /---MESSAGE 1---/,
  );
});

test("KimiAnalyzer bulk fallback records null when one-by-one parsing throws", async () => {
  kimiMocks.create.mockResolvedValueOnce({
    content: [{ type: "text", text: '{"bulk":true}' }],
  });
  kimiMocks.parseBulkSignalResponse.mockReturnValueOnce(null);

  const analyzer = new KimiAnalyzer();
  const parseSignalSpy = vi
    .spyOn(analyzer, "parseSignal")
    .mockRejectedValueOnce(new Error("parse blew up"));

  const fallback = await analyzer.parseBulkSignals([
    { messageId: "1", content: "buy btc" },
  ]);

  assert.deepEqual(fallback, [{ messageId: "1", signal: null }]);
  assert.equal(parseSignalSpy.mock.calls.length, 1);
});

test("KimiAnalyzer analyzePosition returns parsed results or a HOLD fallback", async () => {
  kimiMocks.create
    .mockResolvedValueOnce({
      content: [{ type: "text", text: '{"decision":"CLOSE"}' }],
    })
    .mockResolvedValueOnce({
      content: [{ type: "text", text: 'not-json' }],
    });
  kimiMocks.parseJsonResponse
    .mockReturnValueOnce({
      decision: "CLOSE",
      symbol: "BTCUSDT",
      reason: "breakdown",
      confidence: 80,
      currentMarketCondition: MarketCondition.BEARISH,
    })
    .mockReturnValueOnce(null);

  const analyzer = new KimiAnalyzer();
  const parsed = await analyzer.analyzePosition({ symbol: "BTCUSDT" } as never);
  const fallback = await analyzer.analyzePosition({ symbol: "ETHUSDT" } as never);

  assert.equal(parsed.decision, "CLOSE");
  assert.deepEqual(fallback, {
    decision: "HOLD",
    symbol: "ETHUSDT",
    reason: "Failed to parse AI analysis, defaulting to HOLD",
    confidence: 0,
    currentMarketCondition: MarketCondition.NEUTRAL,
  });
});

test("KimiAnalyzer rotates API keys on retryable failures and honors env overrides", async () => {
  process.env.ANTHROPIC_API_KEY = "bad-key,good-key";
  process.env.ANTHROPIC_BASE_URL = "https://kimi.example";
  process.env.ANTHROPIC_MODEL = "kimi-test";

  kimiMocks.create
    .mockRejectedValueOnce({ status: 429, message: "rate limit" })
    .mockResolvedValueOnce({
      content: [{ type: "text", text: '{"action":"BUY"}' }],
    });
  kimiMocks.parseSignalResponse.mockReturnValueOnce({
    action: "BUY",
    symbol: "SOLUSDT",
  });

  const analyzer = new KimiAnalyzer();
  const result = await analyzer.parseSignal("buy sol");

  assert.deepEqual(result, { action: "BUY", symbol: "SOLUSDT" });
  assert.deepEqual(kimiMocks.clients, [
    { apiKey: "bad-key", baseURL: "https://kimi.example" },
    { apiKey: "good-key", baseURL: "https://kimi.example" },
  ]);
  assert.equal(kimiMocks.create.mock.calls[1]?.[0]?.model, "kimi-test");
});

test("KimiAnalyzer rejects when no API key is configured", async () => {
  delete process.env.ANTHROPIC_API_KEY;

  const analyzer = new KimiAnalyzer();

  await assert.rejects(
    analyzer.parseSignal("buy btc"),
    /No Anthropic\/Kimi API keys configured/,
  );
});

test("KimiAnalyzer rethrows non-retryable API failures", async () => {
  kimiMocks.create.mockRejectedValueOnce({
    status: 401,
    message: "unauthorized",
  });

  const analyzer = new KimiAnalyzer();

  await assert.rejects(analyzer.parseSignal("buy btc"), (error) => {
    assert.deepEqual(error, { status: 401, message: "unauthorized" });
    return true;
  });
});

test("KimiAnalyzer surfaces an aggregate error when all retryable keys fail", async () => {
  process.env.ANTHROPIC_API_KEY = "key-1,key-2";
  kimiMocks.create
    .mockRejectedValueOnce({ status: 429, message: "rate limit" })
    .mockRejectedValueOnce({ status: 402, message: "balance exceeded" });

  const analyzer = new KimiAnalyzer();

  await assert.rejects(
    analyzer.parseSignal("buy btc"),
    /All Kimi API keys failed/,
  );
});
