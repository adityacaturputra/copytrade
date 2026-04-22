import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { MarketCondition } from "../enums";

const openAiAnalyzerMocks = vi.hoisted(() => ({
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

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = {
      completions: {
        create: openAiAnalyzerMocks.create,
      },
    };

    constructor(options: Record<string, unknown>) {
      openAiAnalyzerMocks.clients.push(options);
    }
  },
}));

vi.mock("./PromptFactory", () => ({
  buildSignalParserPrompt: openAiAnalyzerMocks.buildSignalParserPrompt,
  buildBulkSignalParserPrompt: openAiAnalyzerMocks.buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt: openAiAnalyzerMocks.buildPositionAnalysisPrompt,
  buildPositionAnalysisUserMessage:
    openAiAnalyzerMocks.buildPositionAnalysisUserMessage,
}));

vi.mock("./AIResponseNormalizer", () => ({
  parseSignalResponse: openAiAnalyzerMocks.parseSignalResponse,
  parseBulkSignalResponse: openAiAnalyzerMocks.parseBulkSignalResponse,
  parseJsonResponse: openAiAnalyzerMocks.parseJsonResponse,
}));

import { OpenAIAnalyzer } from "./OpenAIAnalyzer";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.OPENAI_API_KEY = "key-1";
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;

  openAiAnalyzerMocks.clients.length = 0;
  openAiAnalyzerMocks.create.mockReset();
  openAiAnalyzerMocks.buildSignalParserPrompt.mockClear();
  openAiAnalyzerMocks.buildBulkSignalParserPrompt.mockClear();
  openAiAnalyzerMocks.buildPositionAnalysisPrompt.mockClear();
  openAiAnalyzerMocks.buildPositionAnalysisUserMessage.mockClear();
  openAiAnalyzerMocks.parseSignalResponse.mockReset();
  openAiAnalyzerMocks.parseBulkSignalResponse.mockReset();
  openAiAnalyzerMocks.parseJsonResponse.mockReset();
});

test("OpenAIAnalyzer parses signals and returns null on unparseable responses", async () => {
  openAiAnalyzerMocks.create
    .mockResolvedValueOnce({
      choices: [{ message: { content: '{"action":"BUY"}' } }],
    })
    .mockResolvedValueOnce({
      choices: [{ message: { content: '{"bad":true}' } }],
    });
  openAiAnalyzerMocks.parseSignalResponse
    .mockReturnValueOnce({ action: "BUY", symbol: "BTCUSDT" })
    .mockReturnValueOnce(null);

  const analyzer = new OpenAIAnalyzer();
  const parsed = await analyzer.parseSignal("buy btc");
  const missing = await analyzer.parseSignal("nonsense");

  assert.deepEqual(parsed, { action: "BUY", symbol: "BTCUSDT" });
  assert.equal(missing, null);
  assert.equal(openAiAnalyzerMocks.create.mock.calls.length, 2);
  assert.equal(
    openAiAnalyzerMocks.create.mock.calls[0]?.[0]?.response_format?.type,
    "json_object",
  );
});

test("OpenAIAnalyzer bulk parsing falls back to one-by-one parsing when bulk normalization fails", async () => {
  openAiAnalyzerMocks.create
    .mockResolvedValueOnce({
      choices: [{ message: { content: '{"bulk":true}' } }],
    })
    .mockResolvedValueOnce({
      choices: [{ message: { content: '{"action":"BUY"}' } }],
    })
    .mockResolvedValueOnce({
      choices: [{ message: { content: '{"action":"SELL"}' } }],
    });
  openAiAnalyzerMocks.parseBulkSignalResponse.mockReturnValueOnce(null);
  openAiAnalyzerMocks.parseSignalResponse
    .mockReturnValueOnce({ action: "BUY" })
    .mockReturnValueOnce(null);

  const analyzer = new OpenAIAnalyzer();
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
  assert.equal(openAiAnalyzerMocks.create.mock.calls.length, 3);
  assert.match(
    String(openAiAnalyzerMocks.create.mock.calls[0]?.[0]?.messages?.[1]?.content),
    /---MESSAGE 1---/,
  );
});

test("OpenAIAnalyzer analyzePosition returns parsed JSON or a HOLD fallback", async () => {
  openAiAnalyzerMocks.create
    .mockResolvedValueOnce({
      choices: [{ message: { content: '{"decision":"CLOSE"}' } }],
    })
    .mockResolvedValueOnce({
      choices: [{ message: { content: 'not-json' } }],
    });
  openAiAnalyzerMocks.parseJsonResponse
    .mockReturnValueOnce({
      decision: "CLOSE",
      symbol: "BTCUSDT",
      reason: "breakdown",
      confidence: 88,
      currentMarketCondition: MarketCondition.BEARISH,
    })
    .mockReturnValueOnce(null);

  const analyzer = new OpenAIAnalyzer();
  const parsed = await analyzer.analyzePosition({
    symbol: "BTCUSDT",
  } as never);
  const fallback = await analyzer.analyzePosition({
    symbol: "ETHUSDT",
  } as never);

  assert.equal(parsed.decision, "CLOSE");
  assert.deepEqual(fallback, {
    decision: "HOLD",
    symbol: "ETHUSDT",
    reason: "Failed to parse AI analysis, defaulting to HOLD",
    confidence: 0,
    currentMarketCondition: MarketCondition.NEUTRAL,
  });
});

test("OpenAIAnalyzer rotates API keys on rate limits and uses env overrides", async () => {
  process.env.OPENAI_API_KEY = "bad-key,good-key";
  process.env.OPENAI_BASE_URL = "https://proxy.example/v1";
  process.env.OPENAI_MODEL = "gpt-test";

  openAiAnalyzerMocks.create
    .mockRejectedValueOnce({ status: 429, message: "rate limit" })
    .mockResolvedValueOnce({
      choices: [{ message: { content: '{"action":"BUY"}' } }],
    });
  openAiAnalyzerMocks.parseSignalResponse.mockReturnValueOnce({
    action: "BUY",
    symbol: "SOLUSDT",
  });

  const analyzer = new OpenAIAnalyzer();
  const result = await analyzer.parseSignal("buy sol");

  assert.deepEqual(result, { action: "BUY", symbol: "SOLUSDT" });
  assert.deepEqual(openAiAnalyzerMocks.clients, [
    { apiKey: "bad-key", baseURL: "https://proxy.example/v1" },
    { apiKey: "good-key", baseURL: "https://proxy.example/v1" },
  ]);
  assert.equal(openAiAnalyzerMocks.create.mock.calls[1]?.[0]?.model, "gpt-test");
});
