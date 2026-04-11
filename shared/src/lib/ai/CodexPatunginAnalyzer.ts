import {
  AISignalAnalyzer,
  BulkMessageInput,
  BulkSignalResult,
  PositionAnalysis,
  TradingSignal,
} from "./types";
import {
  buildBulkSignalParserPrompt,
  buildPositionAnalysisPrompt,
  buildSignalParserPrompt,
} from "./AIFactory";
import { MarketCondition } from "../enums";
import { getCodexPatunginConfig } from "./CodexPatunginConfig";

type OpenAIUserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export class CodexPatunginAnalyzer implements AISignalAnalyzer {
  private apiKeys: string[];
  private baseURL: string;
  private model: string;
  private headers: Record<string, string>;

  constructor() {
    const cfg = getCodexPatunginConfig();
    this.apiKeys = cfg.apiKey
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    this.baseURL = cfg.baseURL;
    this.model = cfg.model;
    this.headers = cfg.headers;
  }

  async parseSignal(message: string): Promise<TradingSignal | null> {
    const systemPrompt = buildSignalParserPrompt();
    const response = await this.callAPI(systemPrompt, message, undefined, true);

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
      console.error("CodexPatungin: Failed to parse signal response:", response);
      return null;
    }
  }

  async parseBulkSignals(
    messages: BulkMessageInput[],
  ): Promise<BulkSignalResult[]> {
    if (messages.length === 0) return [];

    const systemPrompt = buildBulkSignalParserPrompt();
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

    const maxTokens = Math.min(16384, Math.max(2048, messages.length * 512));

    const hasImages = messages.some(
      (msg) => msg.imageUrls && msg.imageUrls.length > 0,
    );

    let response: string;
    if (hasImages) {
      const userContent: OpenAIUserContentPart[] = [{ type: "text", text: userMessage }];
      const seenUrls = new Set<string>();
      for (const msg of messages) {
        if (msg.imageUrls) {
          for (const url of msg.imageUrls) {
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            userContent.push({ type: "image_url", image_url: { url } });
          }
        }
      }

      response = await this.callAPIWithContent(
        systemPrompt,
        userContent,
        maxTokens,
      );
    } else {
      response = await this.callAPI(systemPrompt, userMessage, maxTokens, false);
    }

    try {
      const cleaned = response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      const parsed = JSON.parse(cleaned);

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

      const results: BulkSignalResult[] = messages.map((msg, i) => {
        const signal =
          responseMap.get(msg.messageId) ??
          responseMap.get(String(i + 1)) ??
          null;
        return { messageId: msg.messageId, signal };
      });

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
        "CodexPatungin: Failed to parse bulk signal response:",
        response?.substring(0, 500),
      );
      console.warn(
        `CodexPatungin: Bulk parse failed, falling back to individual parsing for ${messages.length} messages`,
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

    const response = await this.callAPI(systemPrompt, userMessage, undefined, true);

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
    enforceJsonObject = true,
  ): Promise<string> {
    if (this.apiKeys.length === 0) {
      throw new Error(
        "PATUNGIN API key is missing. Set PATUNGIN_API_KEY or configure ~/.codex/config.toml.",
      );
    }

    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const completionPayload: Record<string, unknown> = {
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          max_tokens: maxTokens || 2048,
        };
        if (enforceJsonObject) {
          completionPayload.response_format = { type: "json_object" as const };
        }

        return await this.createCompletion(key, completionPayload);
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
            `CodexPatungin API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("CodexPatungin Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All CodexPatungin API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
  }

  private async callAPIWithContent(
    systemPrompt: string,
    userContent: OpenAIUserContentPart[],
    maxTokens?: number,
  ): Promise<string> {
    if (this.apiKeys.length === 0) {
      throw new Error(
        "PATUNGIN API key is missing. Set PATUNGIN_API_KEY or configure ~/.codex/config.toml.",
      );
    }

    let lastError: Error | null = null;

    for (const key of this.apiKeys) {
      try {
        const completionPayload = {
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent as never },
          ],
          max_tokens: maxTokens || 2048,
        };
        return await this.createCompletion(key, completionPayload);
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
            `CodexPatungin Vision API Key ${key.substring(0, 8)}... failed. Trying next key...`,
          );
          continue;
        }

        console.error("CodexPatungin Vision Analyzer Error:", error);
        throw error;
      }
    }

    throw new Error(
      `All CodexPatungin API keys failed. Last error: ${lastError?.message || "Unknown error"}`,
    );
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
        `Patungin API error: ${response.status} - ${errText}`,
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
