import Anthropic from "@anthropic-ai/sdk";
import { getSignalConfig } from "../signal-config";
import { buildVisionExtractionPrompt } from "./PromptFactory";
import {
  parseVisionExtractionResponse,
  VisionExtractionResult,
} from "./AIResponseNormalizer";

const VISION_PROMPT = buildVisionExtractionPrompt();

export class KimiVisionAnalyzer {
  readonly provider = "kimi" as const;
  private apiKeys: string[];
  private baseURL: string | undefined;
  private modelName: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Please add it to your .env file for vision analysis.",
      );
    }
    this.apiKeys = apiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.baseURL = process.env.ANTHROPIC_BASE_URL;
    this.modelName =
      process.env.ANTHROPIC_VISION_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      "kimi-latest";
  }

  async isEnabled(): Promise<boolean> {
    try {
      const config = await getSignalConfig();
      return config.visionAIEnabled === true;
    } catch {
      return false;
    }
  }

  async analyzeImage(imageUrl: string): Promise<VisionExtractionResult> {
    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const client = new Anthropic({
          baseURL: this.baseURL,
          apiKey: key,
        });

        const msg = await client.messages.create({
          model: this.modelName,
          max_tokens: 1200,
          system: VISION_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "url",
                    url: imageUrl,
                  },
                },
                {
                  type: "text",
                  text: "Analyze this trading chart image.",
                },
              ],
            },
          ],
        });

        const responseText =
          msg.content[0].type === "text" ? msg.content[0].text : "";
        return parseVisionExtractionResponse(responseText.trim());
      } catch (error: unknown) {
        lastError = error as Error;
        const err = error as { status?: number; message?: string };
        const errorMessage = err?.message?.toLowerCase() || "";
        const status = err?.status;

        if (
          status === 401 ||
          status === 403 ||
          status === 429 ||
          status === 402 ||
          status === 500 ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("insufficient") ||
          errorMessage.includes("quota") ||
          errorMessage.includes("balance") ||
          errorMessage.includes("blocked") ||
          errorMessage.includes("permission")
        ) {
          console.warn(
            `Kimi Vision key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("KimiVisionAnalyzer error:", error);
        return { isSignal: false, extractedText: "", rawResponse: "" };
      }
    }

    console.warn(
      `Kimi Vision failed for all keys: ${lastError?.message || "unknown error"}`,
    );
    throw new Error(
      `All Kimi Vision API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}

let _instance: KimiVisionAnalyzer | null = null;

export function getKimiVisionAnalyzer(): KimiVisionAnalyzer | null {
  try {
    if (!_instance) {
      _instance = new KimiVisionAnalyzer();
    }
    return _instance;
  } catch {
    return null;
  }
}

export function resetKimiVisionAnalyzer(): void {
  _instance = null;
}
