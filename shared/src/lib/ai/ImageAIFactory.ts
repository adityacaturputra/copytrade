import { VisionExtractionResult } from "./AIResponseNormalizer";
import { getGeminiVisionAnalyzer } from "./GeminiVisionAnalyzer";
import { getCodexPatunginVisionAnalyzer } from "./CodexPatunginVisionAnalyzer";
import { getGLMVisionAnalyzer } from "./GLMVisionAnalyzer";
import { getKimiVisionAnalyzer } from "./KimiVisionAnalyzer";
import { getKonektikaVisionAnalyzer } from "./KonektikaVisionAnalyzer";
import { getCodexPatunginConfig } from "./CodexPatunginConfig";

export type VisionAIProvider =
  | "gemini"
  | "codex"
  | "patungin"
  | "glm"
  | "kimi"
  | "konektika";

interface VisionSignalAnalyzer {
  provider: VisionAIProvider;
  isEnabled(): Promise<boolean>;
  analyzeImage(imageUrl: string): Promise<VisionExtractionResult>;
}

function normalizeVisionProvider(value: string | undefined): VisionAIProvider {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "codex" || normalized === "patungin") return "patungin";
  if (normalized === "gemini") return "gemini";
  if (normalized === "glm") return "glm";
  if (normalized === "kimi") return "kimi";
  if (normalized === "konektika") return "konektika";
  return "gemini";
}

function getVisionAnalyzerForProvider(
  provider: VisionAIProvider,
): VisionSignalAnalyzer | null {
  switch (provider) {
    case "patungin":
      return getCodexPatunginVisionAnalyzer();
    case "glm":
      return getGLMVisionAnalyzer();
    case "kimi":
      return getKimiVisionAnalyzer();
    case "konektika":
      return getKonektikaVisionAnalyzer();
    case "gemini":
    default:
      return getGeminiVisionAnalyzer();
  }
}

function getSelectedVisionProvider(): VisionAIProvider {
  const explicit =
    process.env.VISION_AI_PROVIDER || process.env.IMAGE_AI_PROVIDER;
  if (explicit) return normalizeVisionProvider(explicit);

  const aiProvider = normalizeVisionProvider(process.env.AI_PROVIDER);
  if (aiProvider === "patungin") return "patungin";
  if (aiProvider === "glm") return "glm";
  if (aiProvider === "kimi") return "kimi";
  if (aiProvider === "konektika") return "konektika";

  if (!process.env.AI_PROVIDER && getCodexPatunginConfig().apiKey) {
    return "patungin";
  }

  return "gemini";
}

/**
 * Parse comma-separated fallback providers from env.
 * e.g. VISION_AI_PROVIDER_FALLBACK="patungin,glm,kimi,gemini"
 */
function parseFallbackProviders(): VisionAIProvider[] {
  const raw =
    process.env.VISION_AI_PROVIDER_FALLBACK ||
    process.env.IMAGE_AI_PROVIDER_FALLBACK;
  if (!raw || !raw.trim()) return [];

  return raw
    .split(",")
    .map((s) => normalizeVisionProvider(s.trim()))
    .filter(Boolean);
}

/**
 * Build ordered list of vision providers: [primary, ...fallbacks (deduplicated)].
 */
function buildVisionProviderChain(): VisionAIProvider[] {
  const primary = getSelectedVisionProvider();
  const fallbacks = parseFallbackProviders();

  const seen = new Set<string>([primary]);
  const chain: VisionAIProvider[] = [primary];

  for (const fb of fallbacks) {
    if (!seen.has(fb)) {
      seen.add(fb);
      chain.push(fb);
    }
  }

  return chain;
}

export class ImageAIFactory {
  static getAnalyzer(provider?: VisionAIProvider): VisionSignalAnalyzer | null {
    const selectedProvider = provider || getSelectedVisionProvider();
    return getVisionAnalyzerForProvider(selectedProvider);
  }

  /**
   * Get all available vision analyzers in fallback order.
   * Returns analyzers that are successfully instantiated (have credentials).
   */
  static getAnalyzers(): VisionSignalAnalyzer[] {
    const chain = buildVisionProviderChain();
    const analyzers: VisionSignalAnalyzer[] = [];

    for (const provider of chain) {
      const analyzer = getVisionAnalyzerForProvider(provider);
      if (analyzer) {
        analyzers.push(analyzer);
      }
    }

    return analyzers;
  }
}

export async function preprocessImagesWithVision(
  content: string,
  imageUrls: string[],
): Promise<{
  enhancedContent: string;
  visionResults: VisionExtractionResult[];
}> {
  const analyzers = ImageAIFactory.getAnalyzers();

  if (analyzers.length === 0 || imageUrls.length === 0) {
    return { enhancedContent: content, visionResults: [] };
  }

  // Find first enabled analyzer
  let activeAnalyzer: VisionSignalAnalyzer | null = null;
  for (const analyzer of analyzers) {
    try {
      const enabled = await analyzer.isEnabled();
      if (enabled) {
        activeAnalyzer = analyzer;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!activeAnalyzer) {
    return { enhancedContent: content, visionResults: [] };
  }

  console.log(
    `[ImageAI:${activeAnalyzer.provider}] Processing ${imageUrls.length} image(s)...`,
  );

  const results: VisionExtractionResult[] = [];

  for (const url of imageUrls) {
    let handled = false;

    // Try current analyzer first, then fallback to others
    const tryAnalyzers = [
      activeAnalyzer,
      ...analyzers.filter((a) => a !== activeAnalyzer),
    ];

    for (const analyzer of tryAnalyzers) {
      try {
        const result = await analyzer.analyzeImage(url);
        results.push(result);
        handled = true;

        if (result.isSignal && result.extractedText) {
          console.log(
            `[ImageAI:${analyzer.provider}] Extracted: ${result.extractedText}`,
          );
        } else {
          console.log(
            `[ImageAI:${analyzer.provider}] Image does not contain a trading signal`,
          );
        }
        break; // success, move to next image
      } catch (error) {
        console.warn(
          `[ImageAI:${analyzer.provider}] Error processing image, trying next provider:`,
          error instanceof Error ? error.message : String(error),
        );
        continue; // try next provider
      }
    }

    if (!handled) {
      // All providers failed for this image
      console.error(`[ImageAI] All vision providers failed for image: ${url}`);
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
    `[ImageAI] Enhanced content with ${extractedTexts.length} extraction(s)`,
  );

  return { enhancedContent, visionResults: results };
}
