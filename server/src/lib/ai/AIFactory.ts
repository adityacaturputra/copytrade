import { AISignalAnalyzer, BulkSignalResult, TradingSignal } from "./types";
import { GLMAnalyzer } from "./GLMAnalyzer";
import { KimiAnalyzer } from "./KimiAnalyzer";
import { OpenAIAnalyzer } from "./OpenAIAnalyzer";
import {
  TradeAction,
  SignalOrderType,
  PositionDecision,
  MarketCondition,
} from "../enums";

export type AIProvider = "glm" | "kimi" | "openai";

/** Build a comma-separated list of enum values for prompt text */
function enumValues<T extends Record<string, string>>(e: T): string {
  return Object.values(e)
    .map((v) => `"${v}"`)
    .join(" | ");
}

/**
 * Build the shared system prompt for signal parsing.
 * Only the transport layer differs between providers — the prompt stays the same.
 *
 * Action enum values are sourced from TradeAction to stay in sync with code.
 */
export function buildSignalParserPrompt(): string {
  const actions = enumValues(TradeAction);
  const orderTypes = enumValues(SignalOrderType);

  return `You are an expert crypto trading signal analyzer. Parse the given Discord message and extract trading signal information.

Return a JSON object with this exact structure. If the message is NOT a trading signal, return null.

{
  "action": ${actions},
  "symbol": "BTCUSDT" (always uppercase with USDT suffix, e.g. ETHUSDT, SOLUSDT),
  "entryPrice": number or null,
  "takeProfitTargets": [number] or null,
  "stopLoss": number or null,
  "leverage": number or null (default 10 if not specified),
  "positionSize": number or null (in USDT),
  "orderType": ${orderTypes} or null,
  "defaultRR": number or null (risk-reward ratio, e.g. 3 means 3R/3:1 RR),
  "timeframe": "string" or null,
  "confidence": 0-100,
  "reasoning": "brief explanation of the signal",
  "rawSignal": "the original signal text"
}

CRITICAL — Action values MUST be EXACTLY these enum values:
- Use "${TradeAction.BUY}" for LONG/BUY signals (entering a long position). Do NOT use "LONG" — it is NOT a valid action.
- Use "${TradeAction.SELL}" for SHORT/SELL signals (entering a short position). Do NOT use "SHORT" — it is NOT a valid action.
- The system derives the position side (LONG/SHORT) from the action automatically.

Important rules:
- Symbol MUST end with USDT (e.g., BTC → BTCUSDT, ETH → ETHUSDT)
- If multiple TP targets, list them all in takeProfitTargets array
- Distinguish between ${TradeAction.UPDATE_TP} (replacing/modifying an existing TP) and ${TradeAction.ADD_TP} (adding a new TP level, e.g. "pasang TP2 di 70K" means ${TradeAction.ADD_TP} because TP1 already exists)
- If someone says they reached a TP level and sets a new one (e.g. "sudah TP1, TP2 di 70K"), use ${TradeAction.ADD_TP} with the new TP price in takeProfitTargets
- Leverage: PLAIN NUMBER ONLY, no suffix (e.g., 10, NOT "10x"). If signal says "10x" or "10-25x", extract the first number: 10. Default 10 if not mentioned.
- Confidence: how certain you are this is a valid trading signal (0-100)
- If the message is general chat, not a signal, return null
- If the message mentions "spot" explicitly, set leverage to 1
- Handle abbreviations: BTC=BTCUSDT, ETH=ETHUSDT, SOL=SOLUSDT, etc.
- Entry zones expressed as ranges should use the midpoint as entryPrice
- orderType: "${SignalOrderType.MARKET}" if signal says to enter at market price (e.g. "market buy", "buy now", "long market"), "${SignalOrderType.LIMIT}" if a specific entry price is given. Default "${SignalOrderType.LIMIT}" if entryPrice is set, "${SignalOrderType.MARKET}" if no entry price.
- positionSize: extract position size in USDT if mentioned (e.g. "$100", "100 USDT")
- defaultRR: Extract the risk-reward ratio if mentioned (e.g. "3R", "3RR", "RR 3", "risk reward 1:3"). This is a PLAIN NUMBER (e.g., 3). If the signal has no TP but has entry + SL + RR ratio, set defaultRR so the system can auto-calculate TP levels.

IMPORTANT — Detect cancel/close requests in reply messages:
- If someone replies to a signal saying they want to cancel, close, or invalidate it (e.g., "lupa cancel", "close aja", "bisa sl+ atau close posisi", "should be cancelled"), return action: "${TradeAction.CANCEL}" with the symbol from the quoted signal
- Phrases indicating cancellation intent: "lupa cancel", "cancel aja", "close posisi", "bisa close", "should cancel", "forget to cancel", "jangan masuk", "skip aja"
- Set confidence based on how clear the cancel request is
- Copy the symbol from the quoted signal into the symbol field

CRITICAL — Ignore these types of messages (return null):
- Replies that are purely casual conversation with NO reference to trading actions (e.g., just chatting, saying thanks, asking questions)
- Messages that are ONLY commentary or personal updates without any actionable request
- Messages containing ONLY role pings (<@&...>) without any signal or cancel request

OUTPUT ONLY THE RAW JSON OBJECT. No markdown, no backticks, no explanations.`;
}

/**
 * Build the system prompt for BULK signal parsing (multiple messages at once).
 */
export function buildBulkSignalParserPrompt(): string {
  const actions = enumValues(TradeAction);
  const orderTypes = enumValues(SignalOrderType);

  return `You are an expert crypto trading signal analyzer. You will receive MULTIPLE Discord messages in a single batch. Parse EACH message and extract trading signal information.

The user message will contain messages in this format:
---MESSAGE [messageId]---
[content]
---END MESSAGE [messageId]---

Some messages may also include chart image URLs labeled as [Attached Images]. These are TRADING CHART screenshots that contain critical signal data — you MUST read/analyze these chart images to extract:
- ENTRY price (look for horizontal lines, zones, or marked entry points)
- STOP LOSS level (usually marked below entry for LONG, above for SHORT)
- TAKE PROFIT targets (TP1, TP2, TP3, etc. — usually marked as horizontal lines above/below entry)
- Support/Resistance levels drawn on the chart
- Trendlines, orderblocks, or other technical patterns visible

When a message has attached chart images, the ENTRY/SL/TP values may ONLY be visible in the chart (not in the text). In this case, you MUST extract those values from the image and include them in your response.

Each message has a unique messageId. You MUST include the messageId in each parsed result so results can be mapped back.

Return a JSON ARRAY where each element has "messageId" and either a parsed signal or null.

Example response:
[
  {"messageId":"msg001","signal":{"action":"${TradeAction.BUY}","symbol":"BTCUSDT","entryPrice":95000,"takeProfitTargets":[96000,97000,98000],"stopLoss":94000,"leverage":10,"positionSize":100,"orderType":"${SignalOrderType.LIMIT}","defaultRR":3,"timeframe":"4h","confidence":90,"reasoning":"Clear long signal with 3R target"}},
  {"messageId":"msg002","signal":null},
  {"messageId":"msg003","signal":{"action":"${TradeAction.UPDATE_SL}","symbol":"ETHUSDT","stopLoss":3200,"confidence":85,"reasoning":"SL update"}}
]

CRITICAL — Action values MUST be EXACTLY these enum values:
- Use "${TradeAction.BUY}" for LONG/BUY signals. Do NOT use "LONG" — it is invalid.
- Use "${TradeAction.SELL}" for SHORT/SELL signals. Do NOT use "SHORT" — it is invalid.

Rules for each signal object:
- Symbol MUST end with USDT (e.g., BTC → BTCUSDT, ETH → ETHUSDT)
- If multiple TP targets, list them all in takeProfitTargets array
- Distinguish between ${TradeAction.UPDATE_TP} (replacing/modifying an existing TP) and ${TradeAction.ADD_TP} (adding a new TP level, e.g. "pasang TP2 di 70K" means ${TradeAction.ADD_TP} because TP1 already exists)
- If someone says they reached a TP level and sets a new one (e.g. "sudah TP1, TP2 di 70K"), use ${TradeAction.ADD_TP} with the new TP price in takeProfitTargets
- Leverage: PLAIN NUMBER ONLY, no suffix (e.g., 10, NOT "10x"). If signal says "10x" or "10-25x", extract the first number: 10. Default 10 if not mentioned.
- Confidence: how certain you are this is a valid trading signal (0-100)
- For non-signal messages (chat, casual conversation, role pings only), set signal to null
- If "spot" is mentioned, set leverage to 1
- Handle abbreviations: BTC=BTCUSDT, ETH=ETHUSDT, SOL=SOLUSDT
- Entry zones expressed as ranges should use midpoint
- orderType: "${SignalOrderType.MARKET}" if signal says to enter at market price (e.g. "market buy", "buy now", "long market"), "${SignalOrderType.LIMIT}" if a specific entry price is given. Default "${SignalOrderType.LIMIT}" if entryPrice is set, "${SignalOrderType.MARKET}" if no entry price.
- positionSize: extract position size in USDT if mentioned (e.g. "$100", "100 USDT")
- timeframe: extract timeframe if mentioned (e.g., "4h", "1D", "15m")
- defaultRR: Extract the risk-reward ratio if mentioned (e.g., "3R", "3RR", "RR 3", "risk reward 1:3"). This is a PLAIN NUMBER (e.g., 3). If the signal has no TP but has entry + SL + RR ratio, set defaultRR so the system can auto-calculate TP levels.

CRITICAL — Detect cancel/close requests in reply messages:
- If someone replies to a signal saying they want to cancel, close, or invalidate it (e.g., "lupa cancel", "close aja", "bisa sl+ atau close posisi", "should be cancelled"), return action: "${TradeAction.CANCEL}" with the symbol from the quoted signal
- Phrases indicating cancellation intent: "lupa cancel", "cancel aja", "close posisi", "bisa close", "should cancel", "forget to cancel", "jangan masuk", "skip aja"
- Set confidence based on how clear the cancel request is
- Copy the symbol from the quoted signal into the symbol field

CRITICAL — Ignore these messages (set signal to null):
- Purely casual conversation with NO reference to trading actions
- Only commentary or personal updates without actionable request
- Messages containing ONLY role pings without any signal or cancel request

The array length MUST match the number of messages provided.
Every element MUST include the correct messageId from the input.
OUTPUT ONLY THE RAW JSON ARRAY. No markdown, no backticks, no explanations.`;
}

export function buildPositionAnalysisPrompt(): string {
  const decisions = enumValues(PositionDecision);
  const conditions = enumValues(MarketCondition);

  return `You are an expert crypto trading position manager. Analyze the current position and market data to make a decision.

Return a JSON object with this exact structure:
{
  "decision": ${decisions},
  "symbol": "string",
  "reason": "detailed explanation for the decision",
  "newStopLoss": number or null,
  "newTakeProfit": number or null,
  "closePercentage": number or null (only for ${PositionDecision.PARTIAL_CLOSE}, e.g. 50),
  "confidence": 0-100,
  "currentMarketCondition": ${conditions}
}

Decision guidelines:
- ${PositionDecision.CLOSE}: Take profit hit, stop loss hit, or strong reversal signal against position
- ${PositionDecision.HOLD}: Position is healthy, within expected range, trend continuing
- ${PositionDecision.MOVE_SL}: Move stop loss to breakeven or trailing to lock in profits
- ${PositionDecision.PARTIAL_CLOSE}: Take partial profits at key levels
- ${PositionDecision.UPDATE_TP}: Adjust take profit based on market conditions

RULES:
- If price is within 2% of TP, recommend ${PositionDecision.CLOSE} or ${PositionDecision.PARTIAL_CLOSE}(50)
- If price is within 2% of SL, recommend ${PositionDecision.CLOSE} immediately
- If PNL is positive >10%, recommend ${PositionDecision.MOVE_SL} to breakeven
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
