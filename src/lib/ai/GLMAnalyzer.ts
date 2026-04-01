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

  async parseBulkSignals(
    messages: BulkMessageInput[],
  ): Promise<BulkSignalResult[]> {
    if (messages.length === 0) return [];

    const systemPrompt = buildBulkSignalParserPrompt();

    // Build user message content — include image URLs if present
    const userMessage = messages
      .map((msg) => {
        let block = `---MESSAGE ${msg.messageId}---\n${msg.content}`;
        if (msg.imageUrls && msg.imageUrls.length > 0) {
          block += `\n[Attached Images: ${msg.imageUrls.join(", ")}]`;
        }
        block += `\n---END MESSAGE ${msg.messageId}---`;
        return block;
      })
      .join("\n\n");

    // Check if any messages have images — if so, use vision API
    const hasImages = messages.some(
      (msg) => msg.imageUrls && msg.imageUrls.length > 0,
    );

    // Scale max_tokens based on batch size: ~512 tokens per message analysis
    const maxTokens = Math.min(16384, Math.max(2048, messages.length * 512));

    let response: string;
    if (hasImages) {
      // Build multimodal content parts for vision API
      const userContent: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      > = [];

      // Add text portion
      userContent.push({ type: "text", text: userMessage });

      // Add each unique image as a separate content part
      const seenUrls = new Set<string>();
      for (const msg of messages) {
        if (msg.imageUrls) {
          for (const url of msg.imageUrls) {
            if (!seenUrls.has(url)) {
              seenUrls.add(url);
              userContent.push({
                type: "image_url",
                image_url: { url },
              });
            }
          }
        }
      }

      response = await this.callAPIWithContent(
        systemPrompt,
        userContent,
        maxTokens,
      );
    } else {
      response = await this.callAPI(systemPrompt, userMessage, maxTokens);
    }

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
        "GLM: Failed to parse bulk signal response:",
        response?.substring(0, 500),
      );
      // Fallback: process one-by-one
      console.warn(
        `GLM: Bulk parse failed, falling back to individual parsing for ${messages.length} messages`,
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
        currentMarketCondition: "UNKNOWN",
      };
    }
  }

  private async callAPI(
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
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
              max_tokens: maxTokens || 2048,
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

  /**
   * Call the GLM vision API with multimodal content (text + images).
   * Used when messages include image URLs that need to be sent as image_url parts.
   */
  private async callAPIWithContent(
    systemPrompt: string,
    userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >,
    maxTokens?: number,
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
            message: `GLM Vision API error: ${response.status} - ${errText}`,
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
            `GLM Vision API Key ${key.substring(0, 8)}... failed (Balance/Rate Limit). Trying next key...`,
          );
          continue;
        }

        console.error("GLM Vision Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All GLM API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }
}
