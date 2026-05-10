import Anthropic from "@anthropic-ai/sdk";
import {
  AISignalAnalyzer,
  TradingSignal,
  PositionAnalysis,
  PositionAnalysisInput,
  BulkSignalResult,
  BulkMessageInput,
} from "./types";
import {
  buildSignalParserPrompt,
  buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt,
  buildPositionAnalysisUserMessage,
} from "./PromptFactory";
import { MarketCondition } from "../enums";
import {
  parseBulkSignalResponse,
  parseJsonResponse,
  parseSignalResponse,
} from "./AIResponseNormalizer";

export class KimiAnalyzer implements AISignalAnalyzer {
  private apiKeys: string[];
  private baseURL: string | undefined;
  private model: string;

  constructor() {
    this.apiKeys = (process.env.ANTHROPIC_API_KEY || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.baseURL = process.env.ANTHROPIC_BASE_URL;
    this.model = process.env.ANTHROPIC_MODEL || "kimi-latest";
  }

  async parseSignal(message: string): Promise<TradingSignal | null> {
    const systemPrompt = buildSignalParserPrompt();
    const response = await this.callAPI(systemPrompt, message);
    const signal = parseSignalResponse(response, message);

    if (!signal) {
      console.error("Kimi: Failed to parse signal response:", response);
      return null;
    }

    return signal;
  }

  async parseBulkSignals(
    messages: BulkMessageInput[],
  ): Promise<BulkSignalResult[]> {
    if (messages.length === 0) return [];

    const systemPrompt = buildBulkSignalParserPrompt();
    const userMessage = messages
      .map(
        (msg) =>
          `---MESSAGE ${msg.messageId}---\n${msg.content}\n---END MESSAGE ${msg.messageId}---`,
      )
      .join("\n\n");

    // Scale max_tokens based on batch size: ~512 tokens per message analysis
    const maxTokens = Math.min(16384, Math.max(2048, messages.length * 512));

    const response = await this.callAPI(systemPrompt, userMessage, maxTokens);

    const results = parseBulkSignalResponse(response, messages);
    if (!results) {
      console.error(
        "Kimi: Failed to parse bulk signal response:",
        response?.substring(0, 500),
      );
      // Fallback: process one-by-one
      console.warn(
        `Kimi: Bulk parse failed, falling back to individual parsing for ${messages.length} messages`,
      );
      const results: BulkSignalResult[] = [];
      for (const msg of messages) {
        try {
          const signal = await this.parseSignal(msg.content);
          results.push({ messageId: msg.messageId, signal });
        } catch {
          results.push({ messageId: msg.messageId, signal: null });
        }
      }
      return results;
    }

    return results;
  }

  async analyzePosition(input: PositionAnalysisInput): Promise<PositionAnalysis> {
    const systemPrompt = buildPositionAnalysisPrompt();
    const userMessage = buildPositionAnalysisUserMessage(input);

    const imageUrls = new Set<string>();
    if (input.discordContextMessages) {
      for (const msg of input.discordContextMessages) {
        if (msg.imageUrls) {
          for (const url of msg.imageUrls) {
            imageUrls.add(url);
          }
        }
      }
    }

    let response: string;
    if (imageUrls.size > 0) {
      const userContent: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      > = [{ type: "text", text: userMessage }];

      for (const url of imageUrls) {
        userContent.push({ type: "image_url", image_url: { url } });
      }

      response = await this.callAPIWithContent(systemPrompt, userContent);
    } else {
      response = await this.callAPI(systemPrompt, userMessage);
    }

    const analysis = parseJsonResponse<PositionAnalysis>(response);
    if (analysis) {
      return analysis;
    }

    {
      return {
        decision: "HOLD",
        symbol: input.symbol,
        reason: "Failed to parse AI analysis, defaulting to HOLD",
        confidence: 0,
        currentMarketCondition: MarketCondition.NEUTRAL,
      };
    }
  }

  private async callAPI(
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
  ): Promise<string> {
    if (this.apiKeys.length === 0) {
      throw new Error("No Anthropic/Kimi API keys configured.");
    }

    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const client = new Anthropic({
          baseURL: this.baseURL,
          apiKey: key,
        });

        const msg = await client.messages.create({
          model: this.model,
          max_tokens: maxTokens || 2048,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: userMessage,
            },
          ],
        });

        return msg.content[0].type === "text" ? msg.content[0].text : "";
      } catch (error: unknown) {
        lastError = error as Error;
        const err = error as { status?: number; message?: string };
        const errorMessage = err?.message?.toLowerCase() || "";
        const status = err?.status;

        if (
          status === 429 ||
          status === 402 ||
          errorMessage.includes("balance") ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("insufficient")
        ) {
          console.warn(
            `Kimi API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("Kimi Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All Kimi API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
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
      throw new Error("No Anthropic/Kimi API keys configured.");
    }

    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const client = new Anthropic({
          baseURL: this.baseURL,
          apiKey: key,
        });

        // Convert common multimodal structure to Anthropic structure
        const anthropicContent = userContent.map(part => {
          if (part.type === "text") {
            return { type: "text" as const, text: part.text };
          } else {
            // Anthropic handles images as base64 or URL via image type. 
            // Since we have a URL, Anthropic prefers base64. 
            // For Kimi (which might be an OpenAI proxy, let's just pass text for now or map it if it's openAI compatible)
            // Wait, Kimi uses Anthropic SDK in this codebase!
            return { 
              type: "image_url" as const, 
              image_url: part.image_url 
            };
          }
        });

        const msg = await client.messages.create({
          model: this.model,
          max_tokens: maxTokens || 2048,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: anthropicContent as any,
            },
          ],
        });

        return msg.content[0].type === "text" ? msg.content[0].text : "";
      } catch (error: unknown) {
        lastError = error as Error;
        const err = error as { status?: number; message?: string };
        const errorMessage = err?.message?.toLowerCase() || "";
        const status = err?.status;

        if (
          status === 429 ||
          status === 402 ||
          errorMessage.includes("balance") ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("insufficient")
        ) {
          console.warn(
            `Kimi Vision API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("Kimi Vision Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All Kimi API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}
