import {
  TradeAction,
  SignalOrderType,
  PositionDecision,
  MarketCondition,
  MessageType,
} from "../enums";

function buildFreshnessRules(): string {
  return `CRITICAL — Freshness / stale-chart rules:
- NEVER return a fresh BUY/SELL new entry from an old chart snapshot if the trade has already progressed.
- If the chart or message shows the setup is already running, already moved, already pumped/dumped, already late, already invalid, or already hit TP/SL, do NOT create a new entry.
- If the current price marker or recent candles are already far beyond the entry zone, treat the setup as stale unless there is an explicit fresh re-entry instruction.
- If any TP has clearly already been hit/traded through on the screenshot, do NOT create a fresh limit order from that old setup. If all TPs are already hit, classify it as "${MessageType.RESULT_STATUS}".
- Prefer surrounding message text over the chart image when judging freshness/timing. Messages like "udah jalan", "sudah running", "ngacir", "already running", "already pumped", "already dumped", "missed", "telat", "TP hit", "TP1 kena", "target reached", "udah kena SL", "invalid", "expired", "jangan entry", "skip" mean it is NOT a fresh entry.
- Only return "${MessageType.NEW_ENTRY}" when the setup is still actionable at the screenshot time and the message is clearly presenting a fresh setup.`;
}

function buildVisionFreshnessRules(): string {
  return `Freshness rules for chart images:
- Do NOT treat a chart as a fresh setup if the live/current price marker or latest candles already moved through the entry path and toward/through TP levels.
- For LONG charts: if the current price is already above one or more TP levels, or especially above the final TP, classify it as "${MessageType.RESULT_STATUS}" or "${MessageType.IGNORE}", not "${MessageType.NEW_ENTRY}".
- For SHORT charts: if the current price is already below one or more TP levels, or especially below the final TP, classify it as "${MessageType.RESULT_STATUS}" or "${MessageType.IGNORE}", not "${MessageType.NEW_ENTRY}".
- If the chart looks like a historical result screenshot, a trade that already ran, or a setup that is no longer actionable, do NOT output a fresh signal summary.
- Only classify as "${MessageType.NEW_ENTRY}" when the chart still looks pending/fresh and the shown entry/TP/SL levels are still valid.`;
}

function enumValues<T extends Record<string, string>>(e: T): string {
  return Object.values(e)
    .map((v) => `"${v}"`)
    .join(" | ");
}

export function buildSignalParserPrompt(): string {
  const actions = enumValues(TradeAction);
  const orderTypes = enumValues(SignalOrderType);
  const messageTypes = enumValues(MessageType);

  return `You are an expert crypto trading signal analyzer. Parse the given Discord message and extract trading signal information.

Return a JSON object with this exact structure. If the message is NOT a trading signal, return null.

{
  "messageType": ${messageTypes},
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

CRITICAL — messageType MUST be one of:
- "${MessageType.NEW_ENTRY}" for a fresh setup / new trade entry
- "${MessageType.POSITION_UPDATE}" for TP/SL adjustment, moving stops, adding targets, managing an existing trade
- "${MessageType.CLOSE_CANCEL}" for close/cancel/invalidate instructions
- "${MessageType.RESULT_STATUS}" for performance/status/result updates like "running 1R", "TP1 hit", "trade hit stoploss"
- "${MessageType.IGNORE}" for chat/noise/non-signal content

Important rules:
- If messageType is "${MessageType.RESULT_STATUS}" or "${MessageType.IGNORE}", return null. Do NOT convert it into a new BUY/SELL entry.
- Messages like "running 1R", "TP1 hit", "trade hit take profit", "trade hit stoploss", "SL kena", "closed in profit/loss" are status/result updates, not new entries.
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

${buildFreshnessRules()}

IMPORTANT — Detect cancel/close requests in reply messages:
- If someone replies to a signal saying they want to cancel, close, or invalidate it (e.g., "lupa cancel", "close aja", "bisa sl+ atau close posisi", "should be cancelled"), return action: "${TradeAction.CANCEL}" with the symbol from the quoted signal
- Phrases indicating cancellation intent: "lupa cancel", "cancel aja", "close posisi", "bisa close", "should cancel", "forget to cancel", "jangan masuk", "skip aja"
- Set confidence based on how clear the cancel request is
- Copy the symbol from the quoted signal into the symbol field

IMPORTANT — If the message contains an appended "[Chart Image Analysis]" section, treat it as supporting context from image OCR/vision, not as permission to override the original message timing. The original message text still decides whether the setup is fresh, stale, already running, already hit TP, or should be skipped.

CRITICAL — Ignore these types of messages (return null):
- Replies that are purely casual conversation with NO reference to trading actions (e.g., just chatting, saying thanks, asking questions)
- Messages that are ONLY commentary or personal updates without any actionable request
- Messages containing ONLY role pings (<@&...>) without any signal or cancel request

OUTPUT ONLY THE RAW JSON OBJECT. No markdown, no backticks, no explanations.`;
}

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

IMPORTANT: attached chart images may be OLD snapshots. Use BOTH the text and the image to judge whether the setup is still fresh/actionable. If the text says the trade already ran, already hit TP, already pumped/dumped, is late, missed, invalid, or should be skipped, then do NOT convert the old chart into a new entry.
If a message effectively contains a generated "[Chart Image Analysis]" summary, treat that as supporting context only. It must not override freshness cues from the original message text.

Each message has a unique messageId. You MUST include the messageId in each parsed result so results can be mapped back.

Return a JSON ARRAY where each element has "messageId" and either a parsed signal or null.

Example response:
[
  {"messageId":"msg001","signal":{"messageType":"${MessageType.NEW_ENTRY}","action":"${TradeAction.BUY}","symbol":"BTCUSDT","entryPrice":95000,"takeProfitTargets":[96000,97000,98000],"stopLoss":94000,"leverage":10,"positionSize":100,"orderType":"${SignalOrderType.LIMIT}","defaultRR":3,"timeframe":"4h","confidence":90,"reasoning":"Clear long signal with 3R target"}},
  {"messageId":"msg002","signal":null},
  {"messageId":"msg003","signal":{"messageType":"${MessageType.POSITION_UPDATE}","action":"${TradeAction.UPDATE_SL}","symbol":"ETHUSDT","stopLoss":3200,"confidence":85,"reasoning":"SL update"}}
]

CRITICAL — Action values MUST be EXACTLY these enum values:
- Use "${TradeAction.BUY}" for LONG/BUY signals. Do NOT use "LONG" — it is invalid.
- Use "${TradeAction.SELL}" for SHORT/SELL signals. Do NOT use "SHORT" — it is invalid.

Rules for each signal object:
- signal.messageType is REQUIRED for every non-null signal object
- If messageType is "${MessageType.RESULT_STATUS}" or "${MessageType.IGNORE}", set signal to null instead of returning an action
- Messages like "running 1R", "TP1 hit", "trade hit take profit", "trade hit stoploss", "SL kena", "closed in profit/loss" are status/result updates and must map to signal: null
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

${buildFreshnessRules()}

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

export function buildVisionExtractionPrompt(): string {
  return `You are a trading chart analyst. Analyze this image carefully.

Your task:
1. Determine if this image is a trading chart that contains signal information (entry, TP, SL price levels).
2. If it IS a trading signal chart, extract ALL visible price levels and trading details.

Look for:
- Entry price(s) (often marked with a horizontal line, arrow, or text label)
- Take Profit / TP levels (target prices, often above entry for longs, below for shorts)
- Stop Loss / SL level (usually a single price below entry for longs, above for shorts)
- Direction bias (LONG or SHORT) — look at the overall trade direction indicated
- Symbol / Pair (e.g., BTCUSDT, ETHUSDT)
- Any leverage or position size mentioned
- Any order block, supply/demand zones marked on the chart

IMPORTANT: Read the PRICE AXIS carefully. Look at the numbers on the right or left side of the chart to determine exact price values. Match horizontal lines to their corresponding price levels.

${buildVisionFreshnessRules()}

Respond in this EXACT JSON format:
{
  "isSignal": true/false,
  "messageType": "new_entry" | "position_update" | "close_cancel" | "result_status" | "ignore",
  "extractedText": "If isSignal is true, write a clear text summary of ALL extracted trading details including exact prices. Format it like a signal message. If isSignal is false, write an empty string."
}

Examples of good extractedText:
- "LONG BTCUSDT | Entry: 67,500 | TP1: 68,500 | TP2: 69,500 | TP3: 70,500 | SL: 66,800 | Leverage: 20x"
- "SHORT ETHUSDT | Entry: 3,450 - 3,460 | TP1: 3,400 | TP2: 3,350 | SL: 3,520"
- "LONG SOLUSDT | Entry: 145.50 | TP: 155, 160, 165 | SL: 140 | Leverage: 10x"

Rules:
- Use messageType "new_entry" for a fresh setup chart
- Use messageType "position_update" for TP/SL adjustment charts
- Use messageType "close_cancel" for close/cancel/invalidation charts
- Use messageType "result_status" for screenshots that only show results/status like TP hit, SL hit, running 1R, pnl update
- Use messageType "ignore" for non-chart/noise images
- If the chart shows price already beyond entry/TP in a way that makes the setup stale, use "result_status" or "ignore", not "new_entry"
- If messageType is "result_status" or "ignore", set isSignal to false and extractedText to empty string

If the image is NOT a trading chart (e.g., meme, screenshot of text, random photo), set isSignal to false, messageType to "ignore", and extractedText to empty string.

Respond ONLY with the JSON, no additional text.`;
}
