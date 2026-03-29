import { AISignalAnalyzer, TradingSignal, PositionAnalysis } from "./types";
import {
  buildSignalParserPrompt,
  buildPositionAnalysisPrompt,
} from "./AIFactory";

export class GLMAnalyzer implements AISignalAnalyzer {
  private baseURL: string;
  private apiKeys: string[];
  private model: string;

  constructor() {
    this.baseURL =
      process.env.GLM_BASE_URL || "https://api.z.ai/api/coding/paas/v4";
    this.apiKeys = (process.env.GLM_API_KEY || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.model = process.env.GLM_MODEL || "glm-5.1";
  }

  async parseSignal(message: string): Promise<TradingSignal | null> {
    const prompt = buildSignalParserPrompt();
    const response = await this.callAPI(prompt, message);

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
      console.error("GLM: Failed to parse signal response:", response);
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
      throw new Error("GLM_API_KEY is missing in environment variables.");
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
              max_tokens: 2048,
            }),
          },
        );

        if (!response.ok) {
          const errText = await response.text();
          throw {
            status: response.status,
            message: `GLM API error: ${response.status} - ${errText}`,
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
          status === 429 ||
          status === 402 ||
          errorMessage.includes("balance") ||
          errorMessage.includes("1113")
        ) {
          console.warn(
            `GLM API Key ${key.substring(0, 8)}... failed (Balance/Rate Limit). Trying next key...`,
          );
          continue;
        }

        console.error("GLM Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All GLM API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}
