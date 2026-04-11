import {
  getGeminiVisionAnalyzer,
  VisionExtractionResult,
} from "./GeminiVisionAnalyzer";
import { getCodexPatunginVisionAnalyzer } from "./CodexPatunginVisionAnalyzer";
import { getCodexPatunginConfig } from "./CodexPatunginConfig";

export type VisionAIProvider = "gemini" | "codex" | "patungin";

interface VisionSignalAnalyzer {
  provider: VisionAIProvider;
  isEnabled(): Promise<boolean>;
  analyzeImage(imageUrl: string): Promise<VisionExtractionResult>;
}

function normalizeVisionProvider(value: string | undefined): VisionAIProvider {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "codex" || normalized === "patungin") return "patungin";
  if (normalized === "gemini") return "gemini";
  return "gemini";
}

function getSelectedVisionProvider(): VisionAIProvider {
  const explicit =
    process.env.VISION_AI_PROVIDER || process.env.IMAGE_AI_PROVIDER;
  if (explicit) return normalizeVisionProvider(explicit);

  const aiProvider = normalizeVisionProvider(process.env.AI_PROVIDER);
  if (aiProvider === "patungin") return "patungin";

  if (!process.env.AI_PROVIDER && getCodexPatunginConfig().apiKey) {
    return "patungin";
  }

  return "gemini";
}

export class ImageAIFactory {
  static getAnalyzer(provider?: VisionAIProvider): VisionSignalAnalyzer | null {
    const selectedProvider = provider || getSelectedVisionProvider();

    if (selectedProvider === "patungin") {
      return getCodexPatunginVisionAnalyzer();
    }

    return getGeminiVisionAnalyzer();
  }
}

export async function preprocessImagesWithVision(
  content: string,
  imageUrls: string[],
): Promise<{
  enhancedContent: string;
  visionResults: VisionExtractionResult[];
}> {
  const analyzer = ImageAIFactory.getAnalyzer();

  if (!analyzer || imageUrls.length === 0) {
    return { enhancedContent: content, visionResults: [] };
  }

  const enabled = await analyzer.isEnabled();
  if (!enabled) {
    return { enhancedContent: content, visionResults: [] };
  }

  console.log(
    `[ImageAI:${analyzer.provider}] Processing ${imageUrls.length} image(s)...`,
  );

  const results: VisionExtractionResult[] = [];

  for (const url of imageUrls) {
    try {
      const result = await analyzer.analyzeImage(url);
      results.push(result);

      if (result.isSignal && result.extractedText) {
        console.log(
          `[ImageAI:${analyzer.provider}] Extracted: ${result.extractedText}`,
        );
      } else {
        console.log(
          `[ImageAI:${analyzer.provider}] Image does not contain a trading signal`,
        );
      }
    } catch (error) {
      console.error(
        `[ImageAI:${analyzer.provider}] Error processing image:`,
        error instanceof Error ? error.message : String(error),
      );
      results.push({ isSignal: false, extractedText: "", rawResponse: "" });
    }
  }

  const extractedTexts = results
    .filter((r) => r.isSignal && r.extractedText)
    .map((r) => r.extractedText);

  if (extractedTexts.length === 0) {
    return { enhancedContent: content, visionResults: results };
  }

  const visionText = extractedTexts.join("\n");
  const enhancedContent = `${content}\n\n[Chart Image Analysis]:\n${visionText}`;

  console.log(
    `[ImageAI:${analyzer.provider}] Enhanced content with ${extractedTexts.length} extraction(s)`,
  );

  return { enhancedContent, visionResults: results };
}
