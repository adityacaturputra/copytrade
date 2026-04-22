import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const geminiVisionMocks = vi.hoisted(() => ({
  getSignalConfig: vi.fn(),
  parseVisionExtractionResponse: vi.fn(),
  generateContent: vi.fn(),
  getGenerativeModel: vi.fn(),
  GoogleGenerativeAI: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class FakeGoogleGenerativeAI {
    constructor(apiKey: string) {
      geminiVisionMocks.GoogleGenerativeAI(apiKey);
    }

    getGenerativeModel(options: Record<string, unknown>) {
      geminiVisionMocks.getGenerativeModel(options);
      return {
        generateContent: geminiVisionMocks.generateContent,
      };
    }
  },
}));

vi.mock("../signal-config", () => ({
  getSignalConfig: geminiVisionMocks.getSignalConfig,
}));

vi.mock("./AIResponseNormalizer", () => ({
  parseVisionExtractionResponse: geminiVisionMocks.parseVisionExtractionResponse,
}));

const originalEnv = { ...process.env };

function createImageResponse(
  ok: boolean,
  options: {
    status?: number;
    statusText?: string;
    contentType?: string;
    bytes?: number[];
  } = {},
) {
  return {
    ok,
    status: options.status || 200,
    statusText: options.statusText || "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? options.contentType || "image/png"
          : null,
    },
    arrayBuffer: async () =>
      Uint8Array.from(options.bytes || [65, 66, 67]).buffer,
  };
}

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.GEMINI_VISION_API_KEY = "gem-key";
  delete process.env.GEMINI_VISION_MODEL;

  geminiVisionMocks.getSignalConfig.mockReset();
  geminiVisionMocks.parseVisionExtractionResponse.mockReset();
  geminiVisionMocks.generateContent.mockReset();
  geminiVisionMocks.getGenerativeModel.mockReset();
  geminiVisionMocks.GoogleGenerativeAI.mockReset();
  geminiVisionMocks.fetch.mockReset();

  vi.stubGlobal("fetch", geminiVisionMocks.fetch);
});

test("GeminiVisionAnalyzer returns false when signal config lookup fails", async () => {
  geminiVisionMocks.getSignalConfig.mockRejectedValueOnce(new Error("db down"));
  vi.resetModules();
  const { GeminiVisionAnalyzer } = await import("./GeminiVisionAnalyzer");

  const analyzer = new GeminiVisionAnalyzer();
  const enabled = await analyzer.isEnabled();

  assert.equal(enabled, false);
});

test("GeminiVisionAnalyzer analyzes images and normalizes extracted chart data", async () => {
  geminiVisionMocks.fetch.mockResolvedValueOnce(
    createImageResponse(true, { contentType: "image/jpeg", bytes: [1, 2, 3] }),
  );
  geminiVisionMocks.generateContent.mockResolvedValueOnce({
    response: {
      text: () => ' {"isSignal":true} ',
    },
  });
  geminiVisionMocks.parseVisionExtractionResponse.mockReturnValueOnce({
    isSignal: true,
    extractedText: "BUY BTCUSDT",
    rawResponse: '{"isSignal":true}',
  });

  vi.resetModules();
  const { GeminiVisionAnalyzer } = await import("./GeminiVisionAnalyzer");
  const analyzer = new GeminiVisionAnalyzer();

  const result = await analyzer.analyzeImage("https://img/1");

  assert.deepEqual(result, {
    isSignal: true,
    extractedText: "BUY BTCUSDT",
    rawResponse: '{"isSignal":true}',
  });
  assert.deepEqual(geminiVisionMocks.GoogleGenerativeAI.mock.calls, [["gem-key"]]);
  assert.deepEqual(geminiVisionMocks.getGenerativeModel.mock.calls, [
    [{ model: "gemini-2.5-flash" }],
  ]);
});

test("GeminiVisionAnalyzer handles fetch failures and aggregate analysis results", async () => {
  geminiVisionMocks.fetch
    .mockResolvedValueOnce(
      createImageResponse(false, { status: 404, statusText: "Not Found" }),
    )
    .mockResolvedValueOnce(createImageResponse(true))
    .mockRejectedValueOnce(new Error("network failed"));
  geminiVisionMocks.generateContent.mockResolvedValueOnce({
    response: {
      text: () => '{"ok":true}',
    },
  });
  geminiVisionMocks.parseVisionExtractionResponse.mockReturnValueOnce({
    isSignal: true,
    extractedText: "SELL ETHUSDT",
    rawResponse: '{"ok":true}',
  });

  vi.resetModules();
  const { GeminiVisionAnalyzer } = await import("./GeminiVisionAnalyzer");
  const analyzer = new GeminiVisionAnalyzer();

  const missing = await analyzer.analyzeImage("https://img/missing");
  const combined = await analyzer.analyzeImages([
    "https://img/ok",
    "https://img/error",
  ]);

  assert.deepEqual(missing, {
    isSignal: false,
    extractedText: "",
    rawResponse: "",
  });
  assert.deepEqual(combined, {
    isSignal: true,
    extractedText: "SELL ETHUSDT",
    rawResponse: '{"ok":true}\n---\n',
  });
});

test("GeminiVisionAnalyzer singleton returns null when credentials are missing", async () => {
  delete process.env.GEMINI_VISION_API_KEY;

  vi.resetModules();
  const module = await import("./GeminiVisionAnalyzer");

  assert.equal(module.getGeminiVisionAnalyzer(), null);
});

test("GeminiVisionAnalyzer constructor requires an API key and singleton instances are reused", async () => {
  delete process.env.GEMINI_VISION_API_KEY;

  vi.resetModules();
  const missingModule = await import("./GeminiVisionAnalyzer");
  assert.throws(
    () => new missingModule.GeminiVisionAnalyzer(),
    /GEMINI_VISION_API_KEY is not set/,
  );

  process.env.GEMINI_VISION_API_KEY = "gem-key";
  vi.resetModules();
  const module = await import("./GeminiVisionAnalyzer");

  const first = module.getGeminiVisionAnalyzer();
  const second = module.getGeminiVisionAnalyzer();

  assert.ok(first);
  assert.equal(first, second);
});

test("GeminiVisionAnalyzer analyzeImages handles empty arrays and per-image exceptions", async () => {
  vi.resetModules();
  const { GeminiVisionAnalyzer } = await import("./GeminiVisionAnalyzer");
  const analyzer = new GeminiVisionAnalyzer() as any;

  analyzer.analyzeImage = vi
    .fn()
    .mockResolvedValueOnce({
      isSignal: true,
      extractedText: "BUY SOLUSDT",
      rawResponse: "first",
    })
    .mockRejectedValueOnce(new Error("bad image"));

  const empty = await analyzer.analyzeImages([]);
  const combined = await analyzer.analyzeImages(["https://img/1", "https://img/2"]);

  assert.deepEqual(empty, {
    isSignal: false,
    extractedText: "",
    rawResponse: "",
  });
  assert.deepEqual(combined, {
    isSignal: true,
    extractedText: "BUY SOLUSDT",
    rawResponse: "first",
  });
});

test("preprocessImagesWithVision returns original content when unavailable or disabled", async () => {
  process.env.GEMINI_VISION_API_KEY = "gem-key";

  vi.resetModules();
  const module = await import("./GeminiVisionAnalyzer");

  assert.deepEqual(
    await module.preprocessImagesWithVision("hello", []),
    { enhancedContent: "hello", visionResults: [] },
  );

  const analyzer = module.getGeminiVisionAnalyzer() as any;
  analyzer.isEnabled = vi.fn().mockResolvedValue(false);

  assert.deepEqual(
    await module.preprocessImagesWithVision("hello", ["https://img/1"]),
    { enhancedContent: "hello", visionResults: [] },
  );
});

test("preprocessImagesWithVision appends extracted text and records failures as empty results", async () => {
  process.env.GEMINI_VISION_API_KEY = "gem-key";

  vi.resetModules();
  const module = await import("./GeminiVisionAnalyzer");
  const analyzer = module.getGeminiVisionAnalyzer() as any;
  analyzer.isEnabled = vi.fn().mockResolvedValue(true);
  analyzer.analyzeImage = vi
    .fn()
    .mockResolvedValueOnce({
      isSignal: true,
      extractedText: "BUY BTCUSDT",
      rawResponse: "one",
    })
    .mockResolvedValueOnce({
      isSignal: false,
      extractedText: "",
      rawResponse: "two",
    })
    .mockRejectedValueOnce(new Error("vision boom"));

  const result = await module.preprocessImagesWithVision("base message", [
    "https://img/1",
    "https://img/2",
    "https://img/3",
  ]);

  assert.deepEqual(result, {
    enhancedContent: "base message\n\n[Chart Image Analysis]:\nBUY BTCUSDT",
    visionResults: [
      { isSignal: true, extractedText: "BUY BTCUSDT", rawResponse: "one" },
      { isSignal: false, extractedText: "", rawResponse: "two" },
      { isSignal: false, extractedText: "", rawResponse: "" },
    ],
  });
});
