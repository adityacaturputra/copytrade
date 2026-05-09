import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const imageMocks = vi.hoisted(() => ({
  geminiAnalyzer: {
    provider: "gemini",
    isEnabled: vi.fn(),
    analyzeImage: vi.fn(),
  },
  patunginAnalyzer: {
    provider: "patungin",
    isEnabled: vi.fn(),
    analyzeImage: vi.fn(),
  },
  glmAnalyzer: {
    provider: "glm",
    isEnabled: vi.fn(),
    analyzeImage: vi.fn(),
  },
  kimiAnalyzer: {
    provider: "kimi",
    isEnabled: vi.fn(),
    analyzeImage: vi.fn(),
  },
  konektikaAnalyzer: {
    provider: "konektika",
    isEnabled: vi.fn(),
    analyzeImage: vi.fn(),
  },
  getGeminiVisionAnalyzer: vi.fn(),
  getCodexPatunginVisionAnalyzer: vi.fn(),
  getGLMVisionAnalyzer: vi.fn(),
  getKimiVisionAnalyzer: vi.fn(),
  getKonektikaVisionAnalyzer: vi.fn(),
  getCodexPatunginConfig: vi.fn(),
}));

vi.mock("./GeminiVisionAnalyzer", () => ({
  getGeminiVisionAnalyzer: imageMocks.getGeminiVisionAnalyzer,
}));

vi.mock("./CodexPatunginVisionAnalyzer", () => ({
  getCodexPatunginVisionAnalyzer: imageMocks.getCodexPatunginVisionAnalyzer,
}));

vi.mock("./GLMVisionAnalyzer", () => ({
  getGLMVisionAnalyzer: imageMocks.getGLMVisionAnalyzer,
}));

vi.mock("./KimiVisionAnalyzer", () => ({
  getKimiVisionAnalyzer: imageMocks.getKimiVisionAnalyzer,
}));

vi.mock("./KonektikaVisionAnalyzer", () => ({
  getKonektikaVisionAnalyzer: imageMocks.getKonektikaVisionAnalyzer,
}));

vi.mock("./CodexPatunginConfig", () => ({
  getCodexPatunginConfig: imageMocks.getCodexPatunginConfig,
}));

import { ImageAIFactory, preprocessImagesWithVision } from "./ImageAIFactory";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.VISION_AI_PROVIDER;
  delete process.env.IMAGE_AI_PROVIDER;
  delete process.env.AI_PROVIDER;
  delete process.env.VISION_AI_PROVIDER_FALLBACK;
  delete process.env.IMAGE_AI_PROVIDER_FALLBACK;

  imageMocks.geminiAnalyzer.isEnabled.mockReset();
  imageMocks.geminiAnalyzer.analyzeImage.mockReset();
  imageMocks.patunginAnalyzer.isEnabled.mockReset();
  imageMocks.patunginAnalyzer.analyzeImage.mockReset();
  imageMocks.glmAnalyzer.isEnabled.mockReset();
  imageMocks.glmAnalyzer.analyzeImage.mockReset();
  imageMocks.kimiAnalyzer.isEnabled.mockReset();
  imageMocks.kimiAnalyzer.analyzeImage.mockReset();
  imageMocks.konektikaAnalyzer.isEnabled.mockReset();
  imageMocks.konektikaAnalyzer.analyzeImage.mockReset();
  imageMocks.getGeminiVisionAnalyzer.mockReset();
  imageMocks.getCodexPatunginVisionAnalyzer.mockReset();
  imageMocks.getGLMVisionAnalyzer.mockReset();
  imageMocks.getKimiVisionAnalyzer.mockReset();
  imageMocks.getKonektikaVisionAnalyzer.mockReset();
  imageMocks.getCodexPatunginConfig.mockReset();

  imageMocks.getGeminiVisionAnalyzer.mockReturnValue(imageMocks.geminiAnalyzer);
  imageMocks.getCodexPatunginVisionAnalyzer.mockReturnValue(
    imageMocks.patunginAnalyzer,
  );
  imageMocks.getGLMVisionAnalyzer.mockReturnValue(imageMocks.glmAnalyzer);
  imageMocks.getKimiVisionAnalyzer.mockReturnValue(imageMocks.kimiAnalyzer);
  imageMocks.getKonektikaVisionAnalyzer.mockReturnValue(
    imageMocks.konektikaAnalyzer,
  );
  imageMocks.getCodexPatunginConfig.mockReturnValue({ apiKey: "" });
});

test("ImageAIFactory selects the correct analyzer from explicit and implicit provider settings", () => {
  process.env.VISION_AI_PROVIDER = "codex";
  const explicitPatungin = ImageAIFactory.getAnalyzer();

  process.env.VISION_AI_PROVIDER = "gemini";
  const explicitGemini = ImageAIFactory.getAnalyzer();

  process.env.VISION_AI_PROVIDER = "glm";
  const explicitGLM = ImageAIFactory.getAnalyzer();

  process.env.VISION_AI_PROVIDER = "kimi";
  const explicitKimi = ImageAIFactory.getAnalyzer();

  process.env.VISION_AI_PROVIDER = "konektika";
  const explicitKonektika = ImageAIFactory.getAnalyzer();

  delete process.env.VISION_AI_PROVIDER;
  process.env.AI_PROVIDER = "patungin";
  const inheritedPatungin = ImageAIFactory.getAnalyzer();

  delete process.env.AI_PROVIDER;
  imageMocks.getCodexPatunginConfig.mockReturnValue({ apiKey: "pat-key" });
  const configPatungin = ImageAIFactory.getAnalyzer();

  assert.equal(explicitPatungin, imageMocks.patunginAnalyzer);
  assert.equal(explicitGemini, imageMocks.geminiAnalyzer);
  assert.equal(explicitGLM, imageMocks.glmAnalyzer);
  assert.equal(explicitKimi, imageMocks.kimiAnalyzer);
  assert.equal(explicitKonektika, imageMocks.konektikaAnalyzer);
  assert.equal(inheritedPatungin, imageMocks.patunginAnalyzer);
  assert.equal(configPatungin, imageMocks.patunginAnalyzer);
});

test("ImageAIFactory getAnalyzers returns providers in fallback order", () => {
  process.env.VISION_AI_PROVIDER = "patungin";
  process.env.VISION_AI_PROVIDER_FALLBACK = "glm,kimi,gemini";

  const analyzers = ImageAIFactory.getAnalyzers();

  assert.equal(analyzers.length, 4);
  assert.equal(analyzers[0].provider, "patungin");
  assert.equal(analyzers[1].provider, "glm");
  assert.equal(analyzers[2].provider, "kimi");
  assert.equal(analyzers[3].provider, "gemini");
});

test("ImageAIFactory getAnalyzers deduplicates providers", () => {
  process.env.VISION_AI_PROVIDER = "gemini";
  process.env.VISION_AI_PROVIDER_FALLBACK = "gemini,glm,gemini";

  const analyzers = ImageAIFactory.getAnalyzers();

  assert.equal(analyzers.length, 2);
  assert.equal(analyzers[0].provider, "gemini");
  assert.equal(analyzers[1].provider, "glm");
});

test("ImageAIFactory getAnalyzers skips providers without credentials", () => {
  process.env.VISION_AI_PROVIDER = "glm";
  process.env.VISION_AI_PROVIDER_FALLBACK = "kimi,gemini";

  // Simulate kimi not having credentials
  imageMocks.getKimiVisionAnalyzer.mockReturnValue(null);

  const analyzers = ImageAIFactory.getAnalyzers();

  assert.equal(analyzers.length, 2);
  assert.equal(analyzers[0].provider, "glm");
  assert.equal(analyzers[1].provider, "gemini");
});

test("preprocessImagesWithVision returns the original content when disabled or no images are present", async () => {
  imageMocks.geminiAnalyzer.isEnabled.mockResolvedValue(false);

  const noImages = await preprocessImagesWithVision("hello", []);
  const disabled = await preprocessImagesWithVision("hello", ["https://img/1"]);

  assert.deepEqual(noImages, {
    enhancedContent: "hello",
    visionResults: [],
  });
  assert.deepEqual(disabled, {
    enhancedContent: "hello",
    visionResults: [],
  });
});

test("preprocessImagesWithVision enhances content with extracted signal text and captures failures", async () => {
  imageMocks.geminiAnalyzer.isEnabled.mockResolvedValue(true);
  imageMocks.geminiAnalyzer.analyzeImage
    .mockResolvedValueOnce({
      isSignal: true,
      extractedText: "BUY BTCUSDT 10x",
      rawResponse: "raw-1",
    })
    .mockResolvedValueOnce({
      isSignal: false,
      extractedText: "",
      rawResponse: "raw-2",
    })
    .mockRejectedValueOnce(new Error("vision failed"));

  const result = await preprocessImagesWithVision("base", [
    "https://img/1",
    "https://img/2",
    "https://img/3",
  ]);

  assert.equal(
    result.enhancedContent,
    "base\n\n[Chart Image Analysis]:\nBUY BTCUSDT 10x",
  );
  assert.deepEqual(result.visionResults, [
    {
      isSignal: true,
      extractedText: "BUY BTCUSDT 10x",
      rawResponse: "raw-1",
    },
    {
      isSignal: false,
      extractedText: "",
      rawResponse: "raw-2",
    },
    {
      isSignal: false,
      extractedText: "",
      rawResponse: "",
    },
  ]);
});

test("preprocessImagesWithVision preserves content when vision is enabled but finds no signal text", async () => {
  imageMocks.geminiAnalyzer.isEnabled.mockResolvedValue(true);
  imageMocks.geminiAnalyzer.analyzeImage.mockResolvedValue({
    isSignal: false,
    extractedText: "",
    rawResponse: "raw-none",
  });

  const result = await preprocessImagesWithVision("plain", [
    "https://img/none",
  ]);

  assert.deepEqual(result, {
    enhancedContent: "plain",
    visionResults: [
      {
        isSignal: false,
        extractedText: "",
        rawResponse: "raw-none",
      },
    ],
  });
});

test("preprocessImagesWithVision falls back to next provider when primary fails", async () => {
  // Primary: gemini fails, fallback: glm succeeds
  imageMocks.geminiAnalyzer.isEnabled.mockResolvedValue(true);
  imageMocks.geminiAnalyzer.analyzeImage.mockRejectedValueOnce(
    new Error("gemini failed"),
  );
  imageMocks.glmAnalyzer.analyzeImage.mockResolvedValueOnce({
    isSignal: true,
    extractedText: "BUY ETHUSDT 5x",
    rawResponse: "glm-raw",
  });

  process.env.VISION_AI_PROVIDER = "gemini";
  process.env.VISION_AI_PROVIDER_FALLBACK = "glm";

  const result = await preprocessImagesWithVision("base", ["https://img/1"]);

  assert.equal(
    result.enhancedContent,
    "base\n\n[Chart Image Analysis]:\nBUY ETHUSDT 5x",
  );
  assert.deepEqual(result.visionResults, [
    {
      isSignal: true,
      extractedText: "BUY ETHUSDT 5x",
      rawResponse: "glm-raw",
    },
  ]);
});

test("preprocessImagesWithVision returns empty result when all providers fail", async () => {
  imageMocks.geminiAnalyzer.isEnabled.mockResolvedValue(true);
  imageMocks.geminiAnalyzer.analyzeImage.mockRejectedValue(
    new Error("gemini down"),
  );
  imageMocks.glmAnalyzer.analyzeImage.mockRejectedValue(new Error("glm down"));

  process.env.VISION_AI_PROVIDER = "gemini";
  process.env.VISION_AI_PROVIDER_FALLBACK = "glm";

  const result = await preprocessImagesWithVision("base", ["https://img/1"]);

  assert.equal(result.enhancedContent, "base");
  assert.deepEqual(result.visionResults, [
    { isSignal: false, extractedText: "", rawResponse: "" },
  ]);
});
