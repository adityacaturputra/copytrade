import { getSignalConfig } from "../signal-config";
import { buildVisionExtractionPrompt } from "./PromptFactory";
import {
  parseVisionExtractionResponse,
  VisionExtractionResult,
} from "./AIResponseNormalizer";

const VISION_PROMPT = buildVisionExtractionPrompt();

export class GLMVisionAnalyzer {
  readonly provider = "glm" as const;
  private apiKeys: string[];
  private baseURL: string;
  private modelName: string;

  constructor() {
    const apiKey = process.env.GLM_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GLM_API_KEY is not set. Please add it to your .env file for vision analysis.",
      );
    }
    this.apiKeys = apiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.baseURL =
      process.env.GLM_BASE_URL || "https://api.z.ai/api/coding/paas/v4";
    this.modelName =
      process.env.GLM_VISION_MODEL || process.env.GLM_MODEL || "glm-5.1";
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
            `GLM Vision API error: ${response.status} - ${errText}`,
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
            `GLM Vision key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("GLMVisionAnalyzer error:", error);
        return { isSignal: false, extractedText: "", rawResponse: "" };
      }
    }

    console.warn(
      `GLM Vision failed for all keys: ${lastError?.message || "unknown error"}`,
    );
    throw new Error(
      `All GLM Vision API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}

let _instance: GLMVisionAnalyzer | null = null;

export function getGLMVisionAnalyzer(): GLMVisionAnalyzer | null {
  try {
    if (!_instance) {
      _instance = new GLMVisionAnalyzer();
    }
    return _instance;
  } catch {
    return null;
  }
}

export function resetGLMVisionAnalyzer(): void {
  _instance = null;
}
