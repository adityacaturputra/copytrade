import { getSignalConfig } from "../signal-config";
import { buildVisionExtractionPrompt } from "./PromptFactory";
import {
  parseVisionExtractionResponse,
  VisionExtractionResult,
} from "./AIResponseNormalizer";

const VISION_PROMPT = buildVisionExtractionPrompt();

export class KonektikaVisionAnalyzer {
  readonly provider = "konektika" as const;
  private apiKeys: string[];
  private baseURL: string;
  private modelName: string;

  constructor() {
    const apiKey = process.env.KONEKTIKA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "KONEKTIKA_API_KEY is not set. Please add it to your .env file for vision analysis.",
      );
    }
    this.apiKeys = apiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.baseURL =
      process.env.KONEKTIKA_BASE_URL || "https://konektikacloud.web.id/v1";
    this.modelName =
      process.env.KONEKTIKA_VISION_MODEL ||
      process.env.KONEKTIKA_MODEL ||
      "konektika-pro";
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
        const response = await fetch(
          `${this.baseURL.replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: this.modelName,
              messages: [
                { role: "system", content: VISION_PROMPT },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Analyze this trading chart image." },
                    { type: "image_url", image_url: { url: imageUrl } },
                  ],
                },
              ],
              max_tokens: 1200,
              response_format: { type: "json_object" },
            }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          const apiError = new Error(
            `Konektika Vision API error: ${response.status} - ${errText}`,
          ) as Error & { status?: number };
          apiError.status = response.status;
          throw apiError;
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        const responseText = data.choices?.[0]?.message?.content || "";
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
            `Konektika Vision key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("KonektikaVisionAnalyzer error:", error);
        return { isSignal: false, extractedText: "", rawResponse: "" };
      }
    }

    console.warn(
      `Konektika Vision failed for all keys: ${lastError?.message || "unknown error"}`,
    );
    throw new Error(
      `All Konektika Vision API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}

let _instance: KonektikaVisionAnalyzer | null = null;

export function getKonektikaVisionAnalyzer(): KonektikaVisionAnalyzer | null {
  try {
    if (!_instance) {
      _instance = new KonektikaVisionAnalyzer();
    }
    return _instance;
  } catch {
    return null;
  }
}

export function resetKonektikaVisionAnalyzer(): void {
  _instance = null;
}
