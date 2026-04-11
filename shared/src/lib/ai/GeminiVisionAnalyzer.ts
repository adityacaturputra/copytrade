/**
 * Vision AI pre-layer used before the main signal parser.
 * Supports provider factory selection:
 * - gemini (default)
 * - codex / patungin (OpenAI-compatible via Patungin)
 */

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSignalConfig } from "../signal-config";
import { getCodexPatunginConfig } from "./CodexPatunginConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisionExtractionResult {
  /** Whether the image contains a trading signal/chart */
  isSignal: boolean;
  /** Extracted text description of price levels from the chart */
  extractedText: string;
  /** Raw model response for debugging */
  rawResponse: string;
}

export type VisionAIProvider = "gemini" | "codex" | "patungin";

interface VisionSignalAnalyzer {
  provider: VisionAIProvider;
  isEnabled(): Promise<boolean>;
  analyzeImage(imageUrl: string): Promise<VisionExtractionResult>;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const VISION_PROMPT = `You are a trading chart analyst. Analyze this image carefully.

Your task:
1. Determine if this image is a trading chart that contains signal information (entry, TP, SL price levels).
2. If it IS a trading signal chart, extract ALL visible price levels and trading details.

Look for:
- Entry price(s) (often marked with a horizontal line, arrow, or text label)
- Take Profit / TP levels (target prices, often above entry for longs, below for shorts)
- Stop Loss / SL level (usually a single price below entry for longs, above for shorts)
- Direction bias (LONG or SHORT) — look at the overall trade direction indicated
- Symbol / Pair (e.g., BTCUSDT, ETHUSDT)
- Any leverage or position size mentioned
- Any order block, supply/demand zones marked on the chart

IMPORTANT: Read the PRICE AXIS carefully. Look at the numbers on the right or left side of the chart to determine exact price values. Match horizontal lines to their corresponding price levels.

Respond in this EXACT JSON format:
{
  "isSignal": true/false,
  "extractedText": "If isSignal is true, write a clear text summary of ALL extracted trading details including exact prices. Format it like a signal message. If isSignal is false, write an empty string."
}

Examples of good extractedText:
- "LONG BTCUSDT | Entry: 67,500 | TP1: 68,500 | TP2: 69,500 | TP3: 70,500 | SL: 66,800 | Leverage: 20x"
- "SHORT ETHUSDT | Entry: 3,450 - 3,460 | TP1: 3,400 | TP2: 3,350 | SL: 3,520"
- "LONG SOLUSDT | Entry: 145.50 | TP: 155, 160, 165 | SL: 140 | Leverage: 10x"

If the image is NOT a trading chart (e.g., meme, screenshot of text, random photo), set isSignal to false and extractedText to empty string.

Respond ONLY with the JSON, no additional text.`;

function parseVisionResponse(responseText: string): VisionExtractionResult {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { isSignal: false, extractedText: "", rawResponse: responseText };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      isSignal?: boolean;
      extractedText?: string;
    };

    return {
      isSignal: parsed.isSignal === true,
      extractedText: parsed.extractedText || "",
      rawResponse: responseText,
    };
  } catch {
    return { isSignal: false, extractedText: "", rawResponse: responseText };
  }
}

async function isVisionEnabled(): Promise<boolean> {
  try {
    const config = await getSignalConfig();
    return config.visionAIEnabled === true;
  } catch {
    return false;
  }
}

// ─── Gemini Analyzer ──────────────────────────────────────────────────────────

class GeminiVisionAnalyzer implements VisionSignalAnalyzer {
  provider: VisionAIProvider = "gemini";
  private apiKey: string;
  private modelName: string;

  constructor() {
    const apiKey = process.env.GEMINI_VISION_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_VISION_API_KEY is not set.");
    }
    this.apiKey = apiKey;
    this.modelName = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
  }

  async isEnabled(): Promise<boolean> {
    return isVisionEnabled();
  }

  async analyzeImage(imageUrl: string): Promise<VisionExtractionResult> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({ model: this.modelName });

    try {
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
        { inlineData: { mimeType: contentType, data: base64Data } },
        VISION_PROMPT,
      ]);

      return parseVisionResponse(result.response.text().trim());
    } catch (error) {
      console.error(
        "[GeminiVision] Error analyzing image:",
        error instanceof Error ? error.message : String(error),
      );
      return { isSignal: false, extractedText: "", rawResponse: "" };
    }
  }
}

// ─── Codex/Patungin Analyzer ─────────────────────────────────────────────────

class CodexPatunginVisionAnalyzer implements VisionSignalAnalyzer {
  provider: VisionAIProvider = "patungin";
  private apiKeys: string[];
  private baseURL: string;
  private modelName: string;

  constructor() {
    const cfg = getCodexPatunginConfig();

    this.apiKeys = cfg.apiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.baseURL = cfg.baseURL;
    this.modelName = process.env.PATUNGIN_VISION_MODEL || cfg.model;

    if (this.apiKeys.length === 0) {
      throw new Error(
        "PATUNGIN API key is missing. Set PATUNGIN_API_KEY or configure ~/.codex/config.toml.",
      );
    }
  }

  async isEnabled(): Promise<boolean> {
    return isVisionEnabled();
  }

  async analyzeImage(imageUrl: string): Promise<VisionExtractionResult> {
    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const client = new OpenAI({
          apiKey: key,
          baseURL: this.baseURL,
        });

        const completion = await client.chat.completions.create({
          model: this.modelName,
          messages: [
            { role: "system", content: VISION_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Analyze this trading chart image." },
                { type: "image_url", image_url: { url: imageUrl } },
              ] as never,
            },
          ],
          max_tokens: 1200,
          response_format: { type: "json_object" },
        });

        const responseText = completion.choices?.[0]?.message?.content || "";
        return parseVisionResponse(responseText.trim());
      } catch (error: unknown) {
        lastError = error as Error;
        const err = error as { status?: number; message?: string };
        const errorMessage = err?.message?.toLowerCase() || "";
        const status = err?.status;

        if (
          status === 429 ||
          status === 402 ||
          status === 500 ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("insufficient") ||
          errorMessage.includes("quota") ||
          errorMessage.includes("balance")
        ) {
          console.warn(
            `CodexPatungin Vision key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("CodexPatunginVision error:", error);
        return { isSignal: false, extractedText: "", rawResponse: "" };
      }
    }

    console.warn(
      `CodexPatungin Vision failed for all keys: ${lastError?.message || "unknown error"}`,
    );
    return { isSignal: false, extractedText: "", rawResponse: "" };
  }
}

// ─── Vision Factory ───────────────────────────────────────────────────────────

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

export class VisionAIFactory {
  private static instances = new Map<VisionAIProvider, VisionSignalAnalyzer>();

  static getAnalyzer(
    provider?: VisionAIProvider,
  ): VisionSignalAnalyzer | null {
    const selectedProvider = provider || getSelectedVisionProvider();

    if (VisionAIFactory.instances.has(selectedProvider)) {
      return VisionAIFactory.instances.get(selectedProvider) || null;
    }

    try {
      const analyzer =
        selectedProvider === "patungin"
          ? new CodexPatunginVisionAnalyzer()
          : new GeminiVisionAnalyzer();

      VisionAIFactory.instances.set(selectedProvider, analyzer);
      return analyzer;
    } catch (error) {
      console.warn(
        `[VisionAIFactory] Failed to initialize ${selectedProvider} analyzer: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  static reset(): void {
    VisionAIFactory.instances.clear();
  }
}

/**
 * Backward-compatible helper retained for existing imports.
 */
export function getGeminiVisionAnalyzer(): VisionSignalAnalyzer | null {
  return VisionAIFactory.getAnalyzer("gemini");
}

/**
 * Preprocess Discord message images through the selected vision AI provider.
 * If disabled or not configured, returns original content unchanged.
 */
export async function preprocessImagesWithVision(
  content: string,
  imageUrls: string[],
): Promise<{
  enhancedContent: string;
  visionResults: VisionExtractionResult[];
}> {
  const analyzer = VisionAIFactory.getAnalyzer();

  if (!analyzer || imageUrls.length === 0) {
    return { enhancedContent: content, visionResults: [] };
  }

  const enabled = await analyzer.isEnabled();
  if (!enabled) {
    return { enhancedContent: content, visionResults: [] };
  }

  console.log(
    `[VisionAI:${analyzer.provider}] Processing ${imageUrls.length} image(s)...`,
  );

  const results: VisionExtractionResult[] = [];

  for (const url of imageUrls) {
    try {
      const result = await analyzer.analyzeImage(url);
      results.push(result);

      if (result.isSignal && result.extractedText) {
        console.log(
          `[VisionAI:${analyzer.provider}] Extracted: ${result.extractedText}`,
        );
      } else {
        console.log(
          `[VisionAI:${analyzer.provider}] Image does not contain a trading signal`,
        );
      }
    } catch (error) {
      console.error(
        `[VisionAI:${analyzer.provider}] Error processing image:`,
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
    `[VisionAI:${analyzer.provider}] Enhanced content with ${extractedTexts.length} extraction(s)`,
  );

  return { enhancedContent, visionResults: results };
}
