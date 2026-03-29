import OpenAI from "openai";
import { AISignalAnalyzer, TradingSignal, PositionAnalysis } from "./types";
import {
  buildSignalParserPrompt,
  buildPositionAnalysisPrompt,
} from "./AIFactory";

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
          max_tokens: 2048,
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
