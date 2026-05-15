import {
  AISignalAnalyzer,
  TradingSignal,
  PositionAnalysis,
  PositionAnalysisInput,
  BulkSignalResult,
  BulkMessageInput,
} from "../core/types";
import {
  buildSignalParserPrompt,
  buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt,
  buildPositionAnalysisUserMessage,
} from "../core/prompt-factory";
import { MarketCondition } from "../../enums/index";
import {
  parseBulkSignalResponse,
  parseJsonResponse,
  parseSignalResponse,
} from "../core/response-normalizer";
import {
  buildBulkUserMessage,
  buildImageUserContent,
  collectPositionContextImageUrls,
  collectUniqueImageUrls,
  fallbackBulkSignalParsing,
} from "../core/multimodal";

export class KonektikaAnalyzer implements AISignalAnalyzer {
  private baseURL: string;
  private apiKeys: string[];
  private model: string;

  constructor() {
    const apiKey = process.env.KONEKTIKA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "KONEKTIKA_API_KEY is not set. Please add it to your .env file.",
      );
    }
    this.baseURL =
      process.env.KONEKTIKA_BASE_URL || "https://konektikacloud.web.id/v1";
    this.apiKeys = apiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.model = process.env.KONEKTIKA_MODEL || "konektika-pro";
  }

  async parseSignal(message: string): Promise<TradingSignal | null> {
    const prompt = buildSignalParserPrompt();
    const response = await this.callAPI(prompt, message);
    const signal = parseSignalResponse(response, message);

    if (!signal) {
      console.error("Konektika: Failed to parse signal response:", response);
      return null;
    }

    return signal;
  }

  async parseBulkSignals(
    messages: BulkMessageInput[],
  ): Promise<BulkSignalResult[]> {
    if (messages.length === 0) return [];

    const systemPrompt = buildBulkSignalParserPrompt();

    const userMessage = buildBulkUserMessage(messages);

    const hasImages = messages.some(
      (msg) => msg.imageUrls && msg.imageUrls.length > 0,
    );

    const maxTokens = Math.min(16384, Math.max(2048, messages.length * 512));

    let response: string;
    if (hasImages) {
      const userContent = buildImageUserContent(
        userMessage,
        collectUniqueImageUrls(messages),
      );

      response = await this.callAPIWithContent(
        systemPrompt,
        userContent,
        maxTokens,
      );
    } else {
      response = await this.callAPI(systemPrompt, userMessage, maxTokens);
    }

    const results = parseBulkSignalResponse(response, messages);
    if (!results) {
      console.error(
        "Konektika: Failed to parse bulk signal response:",
        response?.substring(0, 500),
      );
      console.warn(
        `Konektika: Bulk parse failed, falling back to individual parsing for ${messages.length} messages`,
      );
      return fallbackBulkSignalParsing(messages, (message) => this.parseSignal(message));
    }

    return results;
  }

  async analyzePosition(
    input: PositionAnalysisInput,
  ): Promise<PositionAnalysis> {
    const systemPrompt = buildPositionAnalysisPrompt();
    const userMessage = buildPositionAnalysisUserMessage(input);

    const imageUrls = collectPositionContextImageUrls(input);

    let response: string;
    if (imageUrls.length > 0) {
      response = await this.callAPIWithContent(
        systemPrompt,
        buildImageUserContent(userMessage, imageUrls),
      );
    } else {
      response = await this.callAPI(systemPrompt, userMessage);
    }

    const analysis = parseJsonResponse<PositionAnalysis>(response);
    if (analysis) {
      return analysis;
    }

    return {
      decision: "HOLD",
      symbol: input.symbol,
      reason: "Failed to parse AI analysis, defaulting to HOLD",
      confidence: 0,
      currentMarketCondition: MarketCondition.NEUTRAL,
    };
  }

  private async callAPI(
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
  ): Promise<string> {
    if (this.apiKeys.length === 0) {
      throw new Error("KONEKTIKA_API_KEY is missing in environment variables.");
    }

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
              model: this.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
              ],
              max_tokens: maxTokens || 2048,
            }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          throw {
            status: response.status,
            message: `Konektika API error: ${response.status} - ${errText}`,
          };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        return content || "";
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
            `Konektika API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("Konektika Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All Konektika API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }

  private async callAPIWithContent(
    systemPrompt: string,
    userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >,
    maxTokens?: number,
  ): Promise<string> {
    if (this.apiKeys.length === 0) {
      throw new Error("KONEKTIKA_API_KEY is missing in environment variables.");
    }

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
              model: this.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
              ],
              max_tokens: maxTokens || 2048,
            }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          throw {
            status: response.status,
            message: `Konektika Vision API error: ${response.status} - ${errText}`,
          };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        return content || "";
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
            `Konektika Vision API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("Konektika Vision Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All Konektika API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}
