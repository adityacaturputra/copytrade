import { getSignalConfig } from "../signal-config";
import { getCodexPatunginConfig } from "./CodexPatunginConfig";
import { VisionExtractionResult } from "./GeminiVisionAnalyzer";

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

        return parseVisionResponse(responseText.trim());
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
