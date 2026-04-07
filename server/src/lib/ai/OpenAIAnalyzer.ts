import OpenAI from "openai";
import {
  AISignalAnalyzer,
  TradingSignal,
  PositionAnalysis,
  BulkSignalResult,
  BulkMessageInput,
} from "./types";
import {
  buildSignalParserPrompt,
  buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt,
} from "./AIFactory";
import { MarketCondition } from "../enums";

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

    try {
      const cleaned = response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      const parsed = JSON.parse(cleaned);

      if (!parsed || !parsed.action || !parsed.symbol) {
        return null;
      }

      return {
        ...parsed,
        rawSignal: message,
      } as TradingSignal;
    } catch {
      console.error("OpenAI: Failed to parse signal response:", response);
      return null;
    }
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

    try {
      const cleaned = response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      const parsed = JSON.parse(cleaned);

      // Build a map from AI response by messageId
      const responseMap = new Map<string, TradingSignal | null>();
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const msgId = item?.messageId || "";
          const signal = item?.signal
            ? this.toTradingSignal(item.signal)
            : null;
          responseMap.set(String(msgId), signal);
        }
      }

      // Map back using messageId, falling back to positional index
      const results: BulkSignalResult[] = messages.map((msg, i) => {
        const signal =
          responseMap.get(msg.messageId) ??
          responseMap.get(String(i + 1)) ?? // fallback: AI used 1-based index
          null;
        return { messageId: msg.messageId, signal };
      });

      // If mapping failed for all, try positional fallback
      if (
        results.every((r) => r.signal === null) &&
        Array.isArray(parsed) &&
        parsed.length > 0
      ) {
        return messages.map((msg, i) => {
          const item = parsed[i];
          const signal = item?.signal
            ? this.toTradingSignal(item.signal)
            : null;
          return { messageId: msg.messageId, signal };
        });
      }

      return results;
    } catch {
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
  }

  private toTradingSignal(
    parsed: Record<string, unknown>,
  ): TradingSignal | null {
    if (!parsed || !parsed.action || !parsed.symbol) return null;
    return {
      ...(parsed as Omit<TradingSignal, "rawSignal" | "messageId">),
    } as TradingSignal;
  }

  async analyzePosition(
    symbol: string,
    side: string,
    entryPrice: number,
    currentPrice: number,
    takeProfit?: number,
    stopLoss?: number,
    pnl?: number,
    quantity?: number,
  ): Promise<PositionAnalysis> {
    const systemPrompt = buildPositionAnalysisPrompt();
    const userMessage = `Analyze this position:
- Symbol: ${symbol}
- Side: ${side}
- Entry Price: ${entryPrice}
- Current Price: ${currentPrice}
- Take Profit: ${takeProfit || "Not set"}
- Stop Loss: ${stopLoss || "Not set"}
- Current PNL: ${pnl || 0} USDT
- Quantity: ${quantity || "Unknown"}
- Price change from entry: ${(((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2)}%`;

    const response = await this.callAPI(systemPrompt, userMessage);

    try {
      const cleaned = response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      return JSON.parse(cleaned) as PositionAnalysis;
    } catch {
      return {
        decision: "HOLD",
        symbol,
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
}
