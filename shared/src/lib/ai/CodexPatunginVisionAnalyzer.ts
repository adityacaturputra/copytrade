import { getSignalConfig } from "../signal-config";
import { getCodexPatunginConfig } from "./CodexPatunginConfig";
import { buildVisionExtractionPrompt } from "./PromptFactory";
import {
  parseVisionExtractionResponse,
  VisionExtractionResult,
} from "./AIResponseNormalizer";

const VISION_PROMPT = buildVisionExtractionPrompt();

export class CodexPatunginVisionAnalyzer {
  readonly provider = "patungin" as const;
  private apiKeys: string[];
  private baseURL: string;
  private modelName: string;
  private headers: Record<string, string>;

  constructor() {
    const cfg = getCodexPatunginConfig();

    this.apiKeys = cfg.apiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.baseURL = cfg.baseURL;
    this.modelName = process.env.PATUNGIN_VISION_MODEL || cfg.model;
    this.headers = cfg.headers;

    if (this.apiKeys.length === 0) {
      throw new Error(
        "PATUNGIN API key is missing. Set PATUNGIN_API_KEY or configure ~/.codex/config.toml.",
      );
    }
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
        const responseText = await this.createCompletion(key, {
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

  private buildRequestHeaders(apiKey: string): Record<string, string> {
    return {
      ...this.headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  private async createCompletion(
    apiKey: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const response = await fetch(
      `${this.baseURL.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: this.buildRequestHeaders(apiKey),
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      const apiError = new Error(
        `Patungin Vision API error: ${response.status} - ${errText}`,
      ) as Error & { status?: number };
      apiError.status = response.status;
      throw apiError;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return data.choices?.[0]?.message?.content || "";
  }
}

let _instance: CodexPatunginVisionAnalyzer | null = null;

export function getCodexPatunginVisionAnalyzer(): CodexPatunginVisionAnalyzer | null {
  try {
    if (!_instance) {
      _instance = new CodexPatunginVisionAnalyzer();
    }
    return _instance;
  } catch {
    return null;
  }
}
