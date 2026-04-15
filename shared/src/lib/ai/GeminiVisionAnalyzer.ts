/**
 * GeminiVisionAnalyzer — Pre-layer AI that uses Gemini 2.5 Flash to read
 * trading chart images and extract price levels (Entry, TP, SL).
 *
 * This runs BEFORE the main signal AI, so extracted text gets appended to the
 * Discord message content before it's sent to the primary analyzer.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSignalConfig } from "../signal-config";
import { buildVisionExtractionPrompt } from "./PromptFactory";
import {
  parseVisionExtractionResponse,
  VisionExtractionResult,
} from "./AIResponseNormalizer";

// ─── Prompt ───────────────────────────────────────────────────────────────────

const VISION_PROMPT = buildVisionExtractionPrompt();

// ─── Analyzer Class ───────────────────────────────────────────────────────────

export class GeminiVisionAnalyzer {
  readonly provider = "gemini" as const;
  private apiKey: string;
  private modelName: string;

  constructor() {
    const apiKey = process.env.GEMINI_VISION_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_VISION_API_KEY is not set. Please add it to your .env file.",
      );
    }
    this.apiKey = apiKey;
    this.modelName = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
  }

  /**
   * Check if the Gemini Vision AI is enabled in signal config.
   */
  async isEnabled(): Promise<boolean> {
    try {
      const config = await getSignalConfig();
      return config.visionAIEnabled === true;
    } catch {
      return false;
    }
  }

  /**
   * Analyze a single image URL and extract trading signal data.
   */
  async analyzeImage(imageUrl: string): Promise<VisionExtractionResult> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({ model: this.modelName });

    try {
      // Fetch the image and convert to base64
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        console.warn(
          `[GeminiVision] Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`,
        );
        return { isSignal: false, extractedText: "", rawResponse: "" };
      }

      const contentType =
        imageResponse.headers.get("content-type") || "image/png";
      const arrayBuffer = await imageResponse.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString("base64");

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: contentType,
            data: base64Data,
          },
        },
        VISION_PROMPT,
      ]);

      const responseText = result.response.text().trim();
      return parseVisionExtractionResponse(responseText);
    } catch (error) {
      console.error(
        "[GeminiVision] Error analyzing image:",
        error instanceof Error ? error.message : String(error),
      );
      return { isSignal: false, extractedText: "", rawResponse: "" };
    }
  }

  /**
   * Analyze multiple image URLs and combine extracted text.
   * Returns combined extracted text from all images that contain trading signals.
   */
  async analyzeImages(imageUrls: string[]): Promise<VisionExtractionResult> {
    if (!imageUrls.length) {
      return { isSignal: false, extractedText: "", rawResponse: "" };
    }

    const results: VisionExtractionResult[] = [];

    for (const url of imageUrls) {
      try {
        const result = await this.analyzeImage(url);
        results.push(result);
      } catch (error) {
        console.error(
          `[GeminiVision] Error processing image ${url}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // Combine all extracted texts
    const extractedTexts = results
      .filter((r) => r.isSignal && r.extractedText)
      .map((r) => r.extractedText);

    const combinedText = extractedTexts.join("\n");
    const isAnySignal = results.some((r) => r.isSignal);

    return {
      isSignal: isAnySignal,
      extractedText: combinedText,
      rawResponse: results.map((r) => r.rawResponse).join("\n---\n"),
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

let _instance: GeminiVisionAnalyzer | null = null;

/**
 * Get or create the GeminiVisionAnalyzer singleton.
 * Returns null if GEMINI_VISION_API_KEY is not configured.
 */
export function getGeminiVisionAnalyzer(): GeminiVisionAnalyzer | null {
  try {
    if (!_instance) {
      _instance = new GeminiVisionAnalyzer();
    }
    return _instance;
  } catch {
    return null;
  }
}

/**
 * Preprocess Discord message images through Gemini Vision.
 * If vision AI is disabled or not configured, returns the original content unchanged.
 *
 * @param content - The original Discord message text
 * @param imageUrls - Array of image URLs from the Discord message
 * @returns Enhanced content with image-extracted text appended
 */
export async function preprocessImagesWithVision(
  content: string,
  imageUrls: string[],
): Promise<{
  enhancedContent: string;
  visionResults: VisionExtractionResult[];
}> {
  const analyzer = getGeminiVisionAnalyzer();

  // If no analyzer or no images, return original content
  if (!analyzer || !imageUrls.length) {
    return { enhancedContent: content, visionResults: [] };
  }

  // Check if vision AI is enabled
  const enabled = await analyzer.isEnabled();
  if (!enabled) {
    return { enhancedContent: content, visionResults: [] };
  }

  console.log(
    `[GeminiVision] Processing ${imageUrls.length} image(s) through Gemini Vision...`,
  );

  const results: VisionExtractionResult[] = [];

  for (const url of imageUrls) {
    try {
      const result = await analyzer.analyzeImage(url);
      results.push(result);

      if (result.isSignal && result.extractedText) {
        console.log(
          `[GeminiVision] Extracted from image: ${result.extractedText}`,
        );
      } else {
        console.log(`[GeminiVision] Image does not contain a trading signal`);
      }
    } catch (error) {
      console.error(
        `[GeminiVision] Error processing image:`,
        error instanceof Error ? error.message : String(error),
      );
      results.push({ isSignal: false, extractedText: "", rawResponse: "" });
    }
  }

  // Combine extracted texts from all signal images
  const extractedTexts = results
    .filter((r) => r.isSignal && r.extractedText)
    .map((r) => r.extractedText);

  if (extractedTexts.length === 0) {
    return { enhancedContent: content, visionResults: results };
  }

  // Append extracted chart data to the original message content
  const visionText = extractedTexts.join("\n");
  const enhancedContent = `${content}\n\n[Chart Image Analysis]:\n${visionText}`;

  console.log(
    `[GeminiVision] Enhanced content with ${extractedTexts.length} image extraction(s)`,
  );

  return { enhancedContent, visionResults: results };
}
