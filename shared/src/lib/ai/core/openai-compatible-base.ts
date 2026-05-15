import {
  AISignalAnalyzer,
  BulkMessageInput,
  BulkSignalResult,
  PositionAnalysis,
  PositionAnalysisInput,
  TradingSignal,
} from "./types";
import {
  buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt,
  buildPositionAnalysisUserMessage,
  buildSignalParserPrompt,
} from "./prompt-factory";
import {
  buildBulkUserMessage,
  buildImageUserContent,
  collectPositionContextImageUrls,
  collectUniqueImageUrls,
} from "./multimodal";
import { MarketCondition } from "../../enums/index";
import {
  parseBulkSignalResponse,
  parseJsonResponse,
  parseSignalResponse,
} from "./response-normalizer";

export interface OpenAICompatibleProviderRuntimeConfig {
  providerName: string;
  apiKeys: string[];
  baseURL: string;
  model: string;
}

export type OpenAICompatibleMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export abstract class OpenAICompatibleAnalyzerBase
  implements AISignalAnalyzer
{
  protected readonly providerName: string;
  protected readonly apiKeys: string[];
  protected readonly baseURL: string;
  protected readonly model: string;

  constructor(config: OpenAICompatibleProviderRuntimeConfig) {
    this.providerName = config.providerName;
    this.apiKeys = config.apiKeys;
    this.baseURL = config.baseURL;
    this.model = config.model;
  }

  async parseSignal(message: string): Promise<TradingSignal | null> {
    const response = await this.callTextCompletion(
      buildSignalParserPrompt(),
      message,
    );
    const signal = parseSignalResponse(response, message);
    if (!signal) {
      console.error(
        `${this.providerName}: Failed to parse signal response:`,
        response,
      );
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
      (message) => message.imageUrls && message.imageUrls.length > 0,
    );
    const maxTokens = Math.min(
      16384,
      Math.max(2048, messages.length * 512),
    );

    const response = hasImages
      ? await this.callVisionCompletion(
          systemPrompt,
          buildImageUserContent(userMessage, collectUniqueImageUrls(messages)),
          maxTokens,
        )
      : await this.callTextCompletion(systemPrompt, userMessage, maxTokens);

    const results = parseBulkSignalResponse(response, messages);
    if (results) return results;

    console.error(
      `${this.providerName}: Failed to parse bulk signal response:`,
      response?.substring(0, 500),
    );
    console.warn(
      `${this.providerName}: Bulk parse failed, falling back to individual parsing for ${messages.length} messages`,
    );

    const fallbackResults: BulkSignalResult[] = [];
    for (const message of messages) {
      try {
        const signal = await this.parseSignal(message.content);
        fallbackResults.push({ messageId: message.messageId, signal });
      } catch {
        fallbackResults.push({ messageId: message.messageId, signal: null });
      }
    }
    return fallbackResults;
  }

  async analyzePosition(
    input: PositionAnalysisInput,
  ): Promise<PositionAnalysis> {
    const systemPrompt = buildPositionAnalysisPrompt();
    const userMessage = buildPositionAnalysisUserMessage(input);
    const imageUrls = collectPositionContextImageUrls(input);

    const response =
      imageUrls.length > 0
        ? await this.callVisionCompletion(
            systemPrompt,
            buildImageUserContent(userMessage, imageUrls),
          )
        : await this.callTextCompletion(systemPrompt, userMessage);

    const analysis = parseJsonResponse<PositionAnalysis>(response);
    if (analysis) return analysis;

    return {
      decision: "HOLD",
      symbol: input.symbol,
      reason: "Failed to parse AI analysis, defaulting to HOLD",
      confidence: 0,
      currentMarketCondition: MarketCondition.NEUTRAL,
    };
  }

  protected assertApiKeysConfigured(): void {
    if (this.apiKeys.length === 0) {
      throw new Error(
        `${this.providerName.toUpperCase()}_API_KEY is missing in environment variables.`,
      );
    }
  }

  protected async callTextCompletion(
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
  ): Promise<string> {
    return this.callOpenAICompatibleCompletion(
      systemPrompt,
      userMessage,
      maxTokens,
      "text",
    );
  }

  protected async callVisionCompletion(
    systemPrompt: string,
    userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >,
    maxTokens?: number,
  ): Promise<string> {
    return this.callOpenAICompatibleCompletion(
      systemPrompt,
      userContent,
      maxTokens,
      "vision",
    );
  }

  protected getRetryableStatuses(): number[] {
    return [429, 402, 500];
  }

  protected getRetryableMessagePatterns(): string[] {
    return ["rate limit", "insufficient", "quota"];
  }

  protected getRequestHeaders(apiKey: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  protected buildRequestBody(
    systemPrompt: string,
    userContent: OpenAICompatibleMessageContent,
    maxTokens?: number,
  ): Record<string, unknown> {
    return {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: maxTokens || 2048,
    };
  }

  protected async callOpenAICompatibleCompletion(
    systemPrompt: string,
    userContent: OpenAICompatibleMessageContent,
    maxTokens: number | undefined,
    mode: "text" | "vision",
  ): Promise<string> {
    this.assertApiKeysConfigured();

    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const response = await fetch(
          `${this.baseURL.replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: this.getRequestHeaders(key),
            body: JSON.stringify(
              this.buildRequestBody(systemPrompt, userContent, maxTokens),
            ),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          throw {
            status: response.status,
            message: `${this.providerName} ${mode === "vision" ? "Vision " : ""}API error: ${response.status} - ${errText}`,
          };
        }

        const data = await response.json() as any;
        return data.choices?.[0]?.message?.content || "";
      } catch (error: unknown) {
        lastError = error as Error;
        const err = error as { status?: number; message?: string };
        const errorMessage = err?.message?.toLowerCase() || "";
        const status = err?.status;
        const retryableStatuses = this.getRetryableStatuses();
        const retryableMessages = this.getRetryableMessagePatterns();

        if (
          (typeof status === "number" && retryableStatuses.includes(status)) ||
          retryableMessages.some((pattern) => errorMessage.includes(pattern))
        ) {
          console.warn(
            `${this.providerName} ${mode === "vision" ? "Vision " : ""}API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error(
          `${this.providerName} ${mode === "vision" ? "Vision " : ""}Analyzer Error:`,
          error,
        );
        throw error;
      }
    }

    throw new Error(
      `All ${this.providerName} API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}
