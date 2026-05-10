import OpenAI from "openai";
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

export class OpenAIAnalyzer implements AISignalAnalyzer {
  private apiKeys: string[];
  private baseURL: string;
  private model: string;

  constructor() {
    this.apiKeys = (process.env.OPENAI_API_KEY || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  async parseSignal(message: string): Promise<TradingSignal | null> {
    const systemPrompt = buildSignalParserPrompt();
    const response = await this.callAPI(systemPrompt, message);
    const signal = parseSignalResponse(response, message);

    if (!signal) {
      console.error("OpenAI: Failed to parse signal response:", response);
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
        "OpenAI: Failed to parse bulk signal response:",
        response?.substring(0, 500),
      );
      // Fallback: process one-by-one
      console.warn(
        `OpenAI: Bulk parse failed, falling back to individual parsing for ${messages.length} messages`,
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
      throw new Error("OPENAI_API_KEY is missing in environment variables.");
    }

    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const client = new OpenAI({
          apiKey: key,
          baseURL: this.baseURL,
        });

        const completion = await client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          max_tokens: maxTokens || 2048,
          response_format: { type: "json_object" },
        });

        const content = completion.choices?.[0]?.message?.content;
        return content || "";
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
          errorMessage.includes("quota")
        ) {
          console.warn(
            `OpenAI API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("OpenAI Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All OpenAI API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
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
      throw new Error("OPENAI_API_KEY is missing in environment variables.");
    }

    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const client = new OpenAI({
          apiKey: key,
          baseURL: this.baseURL,
        });

        const completion = await client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent as any },
          ],
          max_tokens: maxTokens || 2048,
          // GPT-4V / vision models usually don't support JSON mode when using images on all versions, 
          // but newer versions do. We'll disable it for safety or rely on the prompt.
          // Since this is for position analysis, let's keep JSON format if supported.
          // Wait, OpenAI SDK supports json_object even with images for newer models.
          // However, to be safe and match CodexPatungin which had `enforceJsonObject=true` as an option,
          // we will try without response_format or just trust the system prompt.
        });

        const content = completion.choices?.[0]?.message?.content;
        return content || "";
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
          errorMessage.includes("quota")
        ) {
          console.warn(
            `OpenAI Vision API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("OpenAI Vision Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All OpenAI API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}
