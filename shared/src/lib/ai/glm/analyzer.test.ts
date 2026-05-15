import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { MarketCondition } from "../enums";

const glmMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  buildSignalParserPrompt: vi.fn(() => "signal-prompt"),
  buildBulkSignalParserPrompt: vi.fn(() => "bulk-prompt"),
  buildPositionAnalysisPrompt: vi.fn(() => "position-prompt"),
  buildPositionAnalysisUserMessage: vi.fn((input: { symbol: string }) => `position:${input.symbol}`),
  parseSignalResponse: vi.fn(),
  parseBulkSignalResponse: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

vi.mock("../core/prompt-factory", () => ({
  buildSignalParserPrompt: glmMocks.buildSignalParserPrompt,
  buildBulkSignalParserPrompt: glmMocks.buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt: glmMocks.buildPositionAnalysisPrompt,
  buildPositionAnalysisUserMessage: glmMocks.buildPositionAnalysisUserMessage,
}));

vi.mock("../core/response-normalizer", () => ({
  parseSignalResponse: glmMocks.parseSignalResponse,
  parseBulkSignalResponse: glmMocks.parseBulkSignalResponse,
  parseJsonResponse: glmMocks.parseJsonResponse,
}));

import { GLMAnalyzer } from "../glm/analyzer";

const originalEnv = { ...process.env };

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.GLM_API_KEY = "key-1";
  delete process.env.GLM_BASE_URL;
  delete process.env.GLM_MODEL;

  glmMocks.fetch.mockReset();
  glmMocks.buildSignalParserPrompt.mockClear();
  glmMocks.buildBulkSignalParserPrompt.mockClear();
  glmMocks.buildPositionAnalysisPrompt.mockClear();
  glmMocks.buildPositionAnalysisUserMessage.mockClear();
  glmMocks.parseSignalResponse.mockReset();
  glmMocks.parseBulkSignalResponse.mockReset();
  glmMocks.parseJsonResponse.mockReset();

  vi.stubGlobal("fetch", glmMocks.fetch);
});

test("GLMAnalyzer parses signals and returns null when normalization fails", async () => {
  glmMocks.fetch
    .mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"action":"BUY"}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"bad":true}' } }] }),
    );
  glmMocks.parseSignalResponse
    .mockReturnValueOnce({ action: "BUY", symbol: "BTCUSDT" })
    .mockReturnValueOnce(null);

  const analyzer = new GLMAnalyzer();
  const parsed = await analyzer.parseSignal("buy btc");
  const missing = await analyzer.parseSignal("nonsense");

  assert.deepEqual(parsed, { action: "BUY", symbol: "BTCUSDT" });
  assert.equal(missing, null);
  assert.match(String(glmMocks.fetch.mock.calls[0]?.[0]), /chat\/completions$/);
});

test("GLMAnalyzer bulk parsing falls back to per-message parsing when normalization fails", async () => {
  glmMocks.fetch
    .mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"bulk":true}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"action":"BUY"}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"action":"SELL"}' } }] }),
    );
  glmMocks.parseBulkSignalResponse.mockReturnValueOnce(null);
  glmMocks.parseSignalResponse
    .mockReturnValueOnce({ action: "BUY" })
    .mockReturnValueOnce(null);

  const analyzer = new GLMAnalyzer();
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
});

test("GLMAnalyzer bulk fallback records null when one-by-one parsing throws", async () => {
  glmMocks.fetch.mockResolvedValueOnce(
    jsonResponse({ choices: [{ message: { content: '{"bulk":true}' } }] }),
  );
  glmMocks.parseBulkSignalResponse.mockReturnValueOnce(null);

  const analyzer = new GLMAnalyzer();
  const parseSignalSpy = vi
    .spyOn(analyzer, "parseSignal")
    .mockRejectedValueOnce(new Error("parse blew up"));

  const fallback = await analyzer.parseBulkSignals([
    { messageId: "1", content: "buy btc" },
  ]);

  assert.deepEqual(fallback, [{ messageId: "1", signal: null }]);
  assert.equal(parseSignalSpy.mock.calls.length, 1);
});

test("GLMAnalyzer uses multimodal content and de-duplicates image URLs for bulk image parsing", async () => {
  glmMocks.fetch.mockResolvedValueOnce(
    jsonResponse({ choices: [{ message: { content: '{"bulk":true}' } }] }),
  );
  glmMocks.parseBulkSignalResponse.mockReturnValueOnce([
    { messageId: "1", signal: { action: "BUY" } },
  ]);

  const analyzer = new GLMAnalyzer();
  const result = await analyzer.parseBulkSignals([
    {
      messageId: "1",
      content: "chart",
      imageUrls: ["https://img/1", "https://img/1", "https://img/2"],
    },
  ]);

  assert.deepEqual(result, [{ messageId: "1", signal: { action: "BUY" } }]);
  const requestBody = JSON.parse(String(glmMocks.fetch.mock.calls[0]?.[1]?.body));
  assert.deepEqual(requestBody.messages[1].content, [
    {
      type: "text",
      text: "---MESSAGE 1---\nchart\n[Attached Images: https://img/1, https://img/1, https://img/2]\n---END MESSAGE 1---",
    },
    { type: "image_url", image_url: { url: "https://img/1" } },
    { type: "image_url", image_url: { url: "https://img/2" } },
  ]);
});

test("GLMAnalyzer analyzePosition returns parsed JSON or a HOLD fallback", async () => {
  glmMocks.fetch
    .mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"decision":"CLOSE"}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: 'not-json' } }] }),
    );
  glmMocks.parseJsonResponse
    .mockReturnValueOnce({
      decision: "CLOSE",
      symbol: "BTCUSDT",
      reason: "breakdown",
      confidence: 80,
      currentMarketCondition: MarketCondition.BEARISH,
    })
    .mockReturnValueOnce(null);

  const analyzer = new GLMAnalyzer();
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

test("GLMAnalyzer rotates API keys on retryable API failures and respects env overrides", async () => {
  process.env.GLM_API_KEY = "bad-key,good-key";
  process.env.GLM_BASE_URL = "https://glm.example/base/";
  process.env.GLM_MODEL = "glm-test";

  glmMocks.fetch
    .mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limit",
      json: async () => ({}),
    })
    .mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '{"action":"BUY"}' } }] }),
    );
  glmMocks.parseSignalResponse.mockReturnValueOnce({
    action: "BUY",
    symbol: "SOLUSDT",
  });

  const analyzer = new GLMAnalyzer();
  const result = await analyzer.parseSignal("buy sol");

  assert.deepEqual(result, { action: "BUY", symbol: "SOLUSDT" });
  assert.equal(glmMocks.fetch.mock.calls.length, 2);
  assert.equal(glmMocks.fetch.mock.calls[0]?.[0], "https://glm.example/base/chat/completions");
  const secondBody = JSON.parse(String(glmMocks.fetch.mock.calls[1]?.[1]?.body));
  assert.equal(secondBody.model, "glm-test");
});

test("GLMAnalyzer rejects when no API key is configured", async () => {
  delete process.env.GLM_API_KEY;

  const analyzer = new GLMAnalyzer();

  await assert.rejects(analyzer.parseSignal("buy btc"), /GLM_API_KEY is missing/);
});

test("GLMAnalyzer rethrows non-retryable API failures", async () => {
  glmMocks.fetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    text: async () => "unauthorized",
    json: async () => ({}),
  });

  const analyzer = new GLMAnalyzer();

  await assert.rejects(analyzer.parseSignal("buy btc"), (error) => {
    assert.deepEqual(error, {
      status: 401,
      message: "GLM API error: 401 - unauthorized",
    });
    return true;
  });
});

test("GLMAnalyzer multimodal requests reject when no API key is configured", async () => {
  delete process.env.GLM_API_KEY;

  const analyzer = new GLMAnalyzer();

  await assert.rejects(
    analyzer.parseBulkSignals([
      { messageId: "1", content: "chart", imageUrls: ["https://img/1"] },
    ]),
    /GLM_API_KEY is missing/,
  );
});

test("GLMAnalyzer multimodal requests rethrow non-retryable API failures", async () => {
  glmMocks.fetch.mockResolvedValueOnce({
    ok: false,
    status: 418,
    text: async () => "teapot",
    json: async () => ({}),
  });

  const analyzer = new GLMAnalyzer();

  await assert.rejects(
    analyzer.parseBulkSignals([
      { messageId: "1", content: "chart", imageUrls: ["https://img/1"] },
    ]),
    (error) => {
      assert.deepEqual(error, {
        status: 418,
        message: "GLM Vision API error: 418 - teapot",
      });
      return true;
    },
  );
});

test("GLMAnalyzer multimodal requests surface an aggregate error when all retryable keys fail", async () => {
  process.env.GLM_API_KEY = "key-1,key-2";
  glmMocks.fetch
    .mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limit",
      json: async () => ({}),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => "balance",
      json: async () => ({}),
    });

  const analyzer = new GLMAnalyzer();

  await assert.rejects(
    analyzer.parseBulkSignals([
      { messageId: "1", content: "chart", imageUrls: ["https://img/1"] },
    ]),
    /All GLM API keys failed/,
  );
});
