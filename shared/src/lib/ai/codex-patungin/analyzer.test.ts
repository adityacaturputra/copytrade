import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { MarketCondition } from "../enums";

const patunginAnalyzerMocks = vi.hoisted(() => ({
  getCodexPatunginConfig: vi.fn(),
  parseSignalResponse: vi.fn(),
  parseBulkSignalResponse: vi.fn(),
  parseJsonResponse: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../codex-patungin/config", () => ({
  getCodexPatunginConfig: patunginAnalyzerMocks.getCodexPatunginConfig,
}));

vi.mock("../core/response-normalizer", () => ({
  parseSignalResponse: patunginAnalyzerMocks.parseSignalResponse,
  parseBulkSignalResponse: patunginAnalyzerMocks.parseBulkSignalResponse,
  parseJsonResponse: patunginAnalyzerMocks.parseJsonResponse,
}));

function jsonResponse(ok: boolean, body: unknown, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

beforeEach(() => {
  patunginAnalyzerMocks.getCodexPatunginConfig.mockReset();
  patunginAnalyzerMocks.parseSignalResponse.mockReset();
  patunginAnalyzerMocks.parseBulkSignalResponse.mockReset();
  patunginAnalyzerMocks.parseJsonResponse.mockReset();
  patunginAnalyzerMocks.fetch.mockReset();

  patunginAnalyzerMocks.getCodexPatunginConfig.mockReturnValue({
    apiKey: "key-1,key-2",
    baseURL: "https://patungin.example/v1/",
    model: "patungin-model",
    headers: { "X-Test": "1" },
  });

  vi.stubGlobal("fetch", patunginAnalyzerMocks.fetch);
});

test("CodexPatunginAnalyzer parses signals and returns null when normalization fails", async () => {
  patunginAnalyzerMocks.fetch
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: '{"action":"BUY"}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: '{"bad":true}' } }] }),
    );
  patunginAnalyzerMocks.parseSignalResponse
    .mockReturnValueOnce({ action: "BUY", symbol: "BTCUSDT" })
    .mockReturnValueOnce(null);

  const { CodexPatunginAnalyzer } = await import("../codex-patungin/analyzer");
  const analyzer = new CodexPatunginAnalyzer();

  const parsed = await analyzer.parseSignal("buy btc");
  const missing = await analyzer.parseSignal("ignore");

  assert.deepEqual(parsed, { action: "BUY", symbol: "BTCUSDT" });
  assert.equal(missing, null);
});

test("CodexPatunginAnalyzer bulk parsing falls back to per-message parsing and supports multimodal payloads", async () => {
  patunginAnalyzerMocks.fetch
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: '{"bulk":true}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: '{"action":"BUY"}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: '{"action":"SELL"}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: '{"bulk":true}' } }] }),
    );
  patunginAnalyzerMocks.parseBulkSignalResponse
    .mockReturnValueOnce(null)
    .mockReturnValueOnce([{ messageId: "3", signal: { action: "BUY" } }]);
  patunginAnalyzerMocks.parseSignalResponse
    .mockReturnValueOnce({ action: "BUY" })
    .mockReturnValueOnce(null);

  const { CodexPatunginAnalyzer } = await import("../codex-patungin/analyzer");
  const analyzer = new CodexPatunginAnalyzer();

  const fallback = await analyzer.parseBulkSignals([
    { messageId: "1", content: "buy btc" },
    { messageId: "2", content: "ignore" },
  ]);
  const withImages = await analyzer.parseBulkSignals([
    {
      messageId: "3",
      content: "chart",
      imageUrls: ["https://img/1", "https://img/1", "https://img/2"],
    },
  ]);

  assert.deepEqual(fallback, [
    { messageId: "1", signal: { action: "BUY" } },
    { messageId: "2", signal: null },
  ]);
  assert.deepEqual(withImages, [{ messageId: "3", signal: { action: "BUY" } }]);

  const requestBody = JSON.parse(
    String(patunginAnalyzerMocks.fetch.mock.calls[3]?.[1]?.body),
  );
  assert.deepEqual(requestBody.messages[1].content, [
    {
      type: "text",
      text: "---MESSAGE 3---\nchart\n[Attached Images: https://img/1, https://img/1, https://img/2]\n---END MESSAGE 3---",
    },
    { type: "image_url", image_url: { url: "https://img/1" } },
    { type: "image_url", image_url: { url: "https://img/2" } },
  ]);
});

test("CodexPatunginAnalyzer bulk parsing fallback returns null when per-message parsing throws", async () => {
  patunginAnalyzerMocks.fetch.mockResolvedValueOnce(
    jsonResponse(true, { choices: [{ message: { content: '{"bulk":true}' } }] }),
  );
  patunginAnalyzerMocks.parseBulkSignalResponse.mockReturnValueOnce(null);

  const { CodexPatunginAnalyzer } = await import("../codex-patungin/analyzer");
  const analyzer = new CodexPatunginAnalyzer();
  const parseSignalSpy = vi
    .spyOn(analyzer, "parseSignal")
    .mockRejectedValueOnce(new Error("bad parse"));

  const result = await analyzer.parseBulkSignals([
    { messageId: "1", content: "broken message" },
  ]);

  assert.deepEqual(result, [{ messageId: "1", signal: null }]);
  assert.equal(parseSignalSpy.mock.calls.length, 1);
});

test("CodexPatunginAnalyzer analyzePosition returns parsed results or HOLD fallback", async () => {
  patunginAnalyzerMocks.fetch
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: '{"decision":"CLOSE"}' } }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: 'not-json' } }] }),
    );
  patunginAnalyzerMocks.parseJsonResponse
    .mockReturnValueOnce({
      decision: "CLOSE",
      symbol: "BTCUSDT",
      reason: "breakdown",
      confidence: 81,
      currentMarketCondition: MarketCondition.BEARISH,
    })
    .mockReturnValueOnce(null);

  const { CodexPatunginAnalyzer } = await import("../codex-patungin/analyzer");
  const analyzer = new CodexPatunginAnalyzer();

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

test("CodexPatunginAnalyzer rotates retryable API key failures and preserves configured headers", async () => {
  patunginAnalyzerMocks.fetch
    .mockResolvedValueOnce(jsonResponse(false, { error: "quota" }, 429))
    .mockResolvedValueOnce(
      jsonResponse(true, { choices: [{ message: { content: '{"action":"BUY"}' } }] }),
    );
  patunginAnalyzerMocks.parseSignalResponse.mockReturnValueOnce({
    action: "BUY",
    symbol: "SOLUSDT",
  });

  const { CodexPatunginAnalyzer } = await import("../codex-patungin/analyzer");
  const analyzer = new CodexPatunginAnalyzer();

  const result = await analyzer.parseSignal("buy sol");

  assert.deepEqual(result, { action: "BUY", symbol: "SOLUSDT" });
  assert.equal(patunginAnalyzerMocks.fetch.mock.calls.length, 2);
  assert.deepEqual(patunginAnalyzerMocks.fetch.mock.calls[1]?.[1]?.headers, {
    "X-Test": "1",
    "Content-Type": "application/json",
    Authorization: "Bearer key-2",
  });
});

test("CodexPatunginAnalyzer multimodal requests reject immediately when no API key is configured", async () => {
  patunginAnalyzerMocks.getCodexPatunginConfig.mockReturnValue({
    apiKey: "",
    baseURL: "https://patungin.example/v1/",
    model: "patungin-model",
    headers: {},
  });

  const { CodexPatunginAnalyzer } = await import("../codex-patungin/analyzer");
  const analyzer = new CodexPatunginAnalyzer();

  await assert.rejects(
    analyzer.parseBulkSignals([
      { messageId: "1", content: "chart", imageUrls: ["https://img/1"] },
    ]),
    /PATUNGIN API key is missing/,
  );
});

test("CodexPatunginAnalyzer multimodal requests rethrow non-retryable API errors", async () => {
  patunginAnalyzerMocks.fetch.mockResolvedValueOnce(
    jsonResponse(false, { error: "teapot" }, 418),
  );

  const { CodexPatunginAnalyzer } = await import("../codex-patungin/analyzer");
  const analyzer = new CodexPatunginAnalyzer();

  await assert.rejects(
    analyzer.parseBulkSignals([
      { messageId: "1", content: "chart", imageUrls: ["https://img/1"] },
    ]),
    /Patungin API error: 418/,
  );
});

test("CodexPatunginAnalyzer multimodal requests exhaust retryable API keys and surface the last error", async () => {
  patunginAnalyzerMocks.fetch
    .mockResolvedValueOnce(jsonResponse(false, { error: "quota" }, 429))
    .mockResolvedValueOnce(jsonResponse(false, { error: "balance" }, 402));

  const { CodexPatunginAnalyzer } = await import("../codex-patungin/analyzer");
  const analyzer = new CodexPatunginAnalyzer();

  await assert.rejects(
    analyzer.parseBulkSignals([
      { messageId: "1", content: "chart", imageUrls: ["https://img/1"] },
    ]),
    /All CodexPatungin API keys failed/,
  );
  assert.equal(patunginAnalyzerMocks.fetch.mock.calls.length, 2);
});
