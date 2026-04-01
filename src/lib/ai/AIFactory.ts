import { AISignalAnalyzer } from "./types";
import { GLMAnalyzer } from "./GLMAnalyzer";
import { KimiAnalyzer } from "./KimiAnalyzer";
import { OpenAIAnalyzer } from "./OpenAIAnalyzer";

export type AIProvider = "glm" | "kimi" | "openai";

/**
 * Build the shared system prompt for signal parsing.
 * Only the transport layer differs between providers — the prompt stays the same.
 */
export function buildSignalParserPrompt(): string {
  return `You are an expert crypto trading signal analyzer. Parse the given Discord message and extract trading signal information.

Return a JSON object with this exact structure. If the message is NOT a trading signal, return null.

{
  "action": "BUY" | "SELL" | "CLOSE" | "CANCEL" | "HOLD" | "TP" | "SL" | "UPDATE_SL" | "UPDATE_TP" | "ADD_TP",
  "symbol": "BTCUSDT" (always uppercase with USDT suffix, e.g. ETHUSDT, SOLUSDT),
  "entryPrice": number or null,
  "takeProfitTargets": [number] or null,
  "stopLoss": number or null,
  "leverage": number or null (default 10 if not specified),
  "positionSize": number or null (in USDT),
  "orderType": "market" | "limit" or null,
  "timeframe": "string" or null,
  "confidence": 0-100,
  "reasoning": "brief explanation of the signal",
  "rawSignal": "the original signal text"
}

Important rules:
- Symbol MUST end with USDT (e.g., BTC → BTCUSDT, ETH → ETHUSDT)
- If multiple TP targets, list them all in takeProfitTargets array
- Distinguish between UPDATE_TP (replacing/modifying an existing TP) and ADD_TP (adding a new TP level, e.g. "pasang TP2 di 70K" means ADD_TP because TP1 already exists)
- If someone says they reached a TP level and sets a new one (e.g. "sudah TP1, TP2 di 70K"), use ADD_TP with the new TP price in takeProfitTargets
- Leverage: use x notation (e.g., 10x, 20x). Default 10x if not mentioned
- Confidence: how certain you are this is a valid trading signal (0-100)
- If the message is general chat, not a signal, return null
- If the message mentions "spot" explicitly, set leverage to 1
- Handle abbreviations: BTC=BTCUSDT, ETH=ETHUSDT, SOL=SOLUSDT, etc.
- Entry zones expressed as ranges should use the midpoint as entryPrice

IMPORTANT — Detect cancel/close requests in reply messages:
- If someone replies to a signal saying they want to cancel, close, or invalidate it (e.g., "lupa cancel", "close aja", "bisa sl+ atau close posisi", "should be cancelled"), return action: "CANCEL" with the symbol from the quoted signal
- Phrases indicating cancellation intent: "lupa cancel", "cancel aja", "close posisi", "bisa close", "should cancel", "forget to cancel", "jangan masuk", "skip aja"
- Set confidence based on how clear the cancel request is
- Copy the symbol from the quoted signal into the symbol field

CRITICAL — Ignore these types of messages (return null):
- Replies that are purely casual conversation with NO reference to trading actions (e.g., just chatting, saying thanks, asking questions)
- Messages that are ONLY commentary or personal updates without any actionable request
- Messages containing ONLY role pings (<@&...>) without any signal or cancel request

OUTPUT ONLY THE RAW JSON OBJECT. No markdown, no backticks, no explanations.`;
}

export function buildPositionAnalysisPrompt(): string {
  return `You are an expert crypto trading position manager. Analyze the current position and market data to make a decision.

Return a JSON object with this exact structure:
{
  "decision": "CLOSE" | "HOLD" | "MOVE_SL" | "PARTIAL_CLOSE" | "UPDATE_TP",
  "symbol": "string",
  "reason": "detailed explanation for the decision",
  "newStopLoss": number or null,
  "newTakeProfit": number or null,
  "closePercentage": number or null (only for PARTIAL_CLOSE, e.g. 50),
  "confidence": 0-100,
  "currentMarketCondition": "BULLISH" | "BEARISH" | "NEUTRAL" | "VOLATILE"
}

Decision guidelines:
- CLOSE: Take profit hit, stop loss hit, or strong reversal signal against position
- HOLD: Position is healthy, within expected range, trend continuing
- MOVE_SL: Move stop loss to breakeven or trailing to lock in profits
- PARTIAL_CLOSE: Take partial profits at key levels
- UPDATE_TP: Adjust take profit based on market conditions

RULES:
- If price is within 2% of TP, recommend CLOSE or PARTIAL_CLOSE(50)
- If price is within 2% of SL, recommend CLOSE immediately
- If PNL is positive >10%, recommend MOVE_SL to breakeven
- Be conservative - prefer protecting capital over maximizing gains

OUTPUT ONLY THE RAW JSON OBJECT. No markdown, no backticks, no explanations.`;
}

export class AIFactory {
  private static instance: AISignalAnalyzer | null = null;

  static getAnalyzer(provider?: AIProvider): AISignalAnalyzer {
    const selectedProvider =
      provider || (process.env.AI_PROVIDER as AIProvider) || "glm";

    if (AIFactory.instance) {
      return AIFactory.instance;
    }

    const analyzer = AIFactory.createAnalyzer(selectedProvider);
    AIFactory.instance = analyzer;
    return analyzer;
  }

  private static createAnalyzer(provider: AIProvider): AISignalAnalyzer {
    switch (provider) {
      case "kimi":
        return new KimiAnalyzer();
      case "openai":
        return new OpenAIAnalyzer();
      case "glm":
        return new GLMAnalyzer();
      default:
        // Fallback chain: try GLM first, then OpenAI, then Kimi
        console.warn(`Unknown AI provider: ${provider}, falling back to GLM`);
        return new GLMAnalyzer();
    }
  }

  static reset(): void {
    AIFactory.instance = null;
  }
}
