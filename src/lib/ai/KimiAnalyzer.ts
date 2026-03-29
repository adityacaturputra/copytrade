import Anthropic from "@anthropic-ai/sdk";
import { AISignalAnalyzer, TradingSignal, PositionAnalysis } from "./types";
import {
  buildSignalParserPrompt,
  buildPositionAnalysisPrompt,
} from "./AIFactory";

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
      console.error("Kimi: Failed to parse signal response:", response);
      return null;
    }
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
        currentMarketCondition: "UNKNOWN",
      };
    }
  }

  private async callAPI(
    systemPrompt: string,
    userMessage: string,
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
          max_tokens: 2048,
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
}
