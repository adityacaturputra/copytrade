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
  getGeminiVisionAnalyzer: vi.fn(),
  getCodexPatunginVisionAnalyzer: vi.fn(),
  getCodexPatunginConfig: vi.fn(),
}));

vi.mock("./GeminiVisionAnalyzer", () => ({
  getGeminiVisionAnalyzer: imageMocks.getGeminiVisionAnalyzer,
}));

vi.mock("./CodexPatunginVisionAnalyzer", () => ({
  getCodexPatunginVisionAnalyzer:
    imageMocks.getCodexPatunginVisionAnalyzer,
}));

vi.mock("./CodexPatunginConfig", () => ({
  getCodexPatunginConfig: imageMocks.getCodexPatunginConfig,
}));

import {
  ImageAIFactory,
  preprocessImagesWithVision,
} from "./ImageAIFactory";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.VISION_AI_PROVIDER;
  delete process.env.IMAGE_AI_PROVIDER;
  delete process.env.AI_PROVIDER;

  imageMocks.geminiAnalyzer.isEnabled.mockReset();
  imageMocks.geminiAnalyzer.analyzeImage.mockReset();
  imageMocks.patunginAnalyzer.isEnabled.mockReset();
  imageMocks.patunginAnalyzer.analyzeImage.mockReset();
  imageMocks.getGeminiVisionAnalyzer.mockReset();
  imageMocks.getCodexPatunginVisionAnalyzer.mockReset();
  imageMocks.getCodexPatunginConfig.mockReset();

  imageMocks.getGeminiVisionAnalyzer.mockReturnValue(imageMocks.geminiAnalyzer);
  imageMocks.getCodexPatunginVisionAnalyzer.mockReturnValue(
    imageMocks.patunginAnalyzer,
  );
  imageMocks.getCodexPatunginConfig.mockReturnValue({ apiKey: "" });
});

test("ImageAIFactory selects the correct analyzer from explicit and implicit provider settings", () => {
  process.env.VISION_AI_PROVIDER = "codex";
  const explicitPatungin = ImageAIFactory.getAnalyzer();

  process.env.VISION_AI_PROVIDER = "gemini";
  const explicitGemini = ImageAIFactory.getAnalyzer();

  delete process.env.VISION_AI_PROVIDER;
  process.env.AI_PROVIDER = "patungin";
  const inheritedPatungin = ImageAIFactory.getAnalyzer();

  delete process.env.AI_PROVIDER;
  imageMocks.getCodexPatunginConfig.mockReturnValue({ apiKey: "pat-key" });
  const configPatungin = ImageAIFactory.getAnalyzer();

  assert.equal(explicitPatungin, imageMocks.patunginAnalyzer);
  assert.equal(explicitGemini, imageMocks.geminiAnalyzer);
  assert.equal(inheritedPatungin, imageMocks.patunginAnalyzer);
  assert.equal(configPatungin, imageMocks.patunginAnalyzer);
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

  const result = await preprocessImagesWithVision("plain", ["https://img/none"]);

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
