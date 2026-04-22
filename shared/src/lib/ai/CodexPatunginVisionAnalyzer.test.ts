import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const patunginVisionMocks = vi.hoisted(() => ({
  getSignalConfig: vi.fn(),
  getCodexPatunginConfig: vi.fn(),
  parseVisionExtractionResponse: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("../signal-config", () => ({
  getSignalConfig: patunginVisionMocks.getSignalConfig,
}));

vi.mock("./CodexPatunginConfig", () => ({
  getCodexPatunginConfig: patunginVisionMocks.getCodexPatunginConfig,
}));

vi.mock("./AIResponseNormalizer", () => ({
  parseVisionExtractionResponse:
    patunginVisionMocks.parseVisionExtractionResponse,
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
  process.env.PATUNGIN_VISION_MODEL = "vision-model";

  patunginVisionMocks.getSignalConfig.mockReset();
  patunginVisionMocks.getCodexPatunginConfig.mockReset();
  patunginVisionMocks.parseVisionExtractionResponse.mockReset();
  patunginVisionMocks.fetch.mockReset();

  patunginVisionMocks.getCodexPatunginConfig.mockReturnValue({
    apiKey: "key-1,key-2",
    baseURL: "https://patungin.example/v1/",
    model: "fallback-model",
    headers: { "X-Test": "1" },
  });

  vi.stubGlobal("fetch", patunginVisionMocks.fetch);
});

test("CodexPatunginVisionAnalyzer reads enablement from signal config", async () => {
  patunginVisionMocks.getSignalConfig
    .mockResolvedValueOnce({ visionAIEnabled: true })
    .mockRejectedValueOnce(new Error("db down"));

  vi.resetModules();
  const { CodexPatunginVisionAnalyzer } = await import(
    "./CodexPatunginVisionAnalyzer"
  );
  const analyzer = new CodexPatunginVisionAnalyzer();

  assert.equal(await analyzer.isEnabled(), true);
  assert.equal(await analyzer.isEnabled(), false);
});

test("CodexPatunginVisionAnalyzer retries retryable key failures and parses a successful response", async () => {
  patunginVisionMocks.fetch
    .mockResolvedValueOnce(jsonResponse(false, { error: "rate limit" }, 429))
    .mockResolvedValueOnce(
      jsonResponse(true, {
        choices: [{ message: { content: '{"signal":true}' } }],
      }),
    );
  patunginVisionMocks.parseVisionExtractionResponse.mockReturnValueOnce({
    isSignal: true,
    extractedText: "BUY BTCUSDT",
    rawResponse: '{"signal":true}',
  });

  vi.resetModules();
  const { CodexPatunginVisionAnalyzer } = await import(
    "./CodexPatunginVisionAnalyzer"
  );
  const analyzer = new CodexPatunginVisionAnalyzer();

  const result = await analyzer.analyzeImage("https://img/1");

  assert.deepEqual(result, {
    isSignal: true,
    extractedText: "BUY BTCUSDT",
    rawResponse: '{"signal":true}',
  });
  assert.equal(patunginVisionMocks.fetch.mock.calls.length, 2);
  assert.equal(
    patunginVisionMocks.fetch.mock.calls[0]?.[0],
    "https://patungin.example/v1/chat/completions",
  );
});

test("CodexPatunginVisionAnalyzer returns safe fallbacks on non-retryable and all-key failures", async () => {
  patunginVisionMocks.fetch
    .mockResolvedValueOnce(jsonResponse(false, { error: "bad request" }, 400))
    .mockResolvedValueOnce(jsonResponse(false, { error: "quota" }, 402))
    .mockResolvedValueOnce(jsonResponse(false, { error: "quota" }, 402));

  vi.resetModules();
  const module = await import("./CodexPatunginVisionAnalyzer");
  const analyzer = new module.CodexPatunginVisionAnalyzer();

  const nonRetryable = await analyzer.analyzeImage("https://img/bad");
  const allFailed = await analyzer.analyzeImage("https://img/quota");

  assert.deepEqual(nonRetryable, {
    isSignal: false,
    extractedText: "",
    rawResponse: "",
  });
  assert.deepEqual(allFailed, {
    isSignal: false,
    extractedText: "",
    rawResponse: "",
  });
});

test("CodexPatunginVisionAnalyzer singleton returns null when config has no API keys", async () => {
  patunginVisionMocks.getCodexPatunginConfig.mockReturnValueOnce({
    apiKey: "",
    baseURL: "https://patungin.example/v1",
    model: "fallback-model",
    headers: {},
  });

  vi.resetModules();
  const module = await import("./CodexPatunginVisionAnalyzer");

  assert.equal(module.getCodexPatunginVisionAnalyzer(), null);
});
