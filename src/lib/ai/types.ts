export interface TradingSignal {
  action:
    | "BUY"
    | "SELL"
    | "CLOSE"
    | "CANCEL"
    | "HOLD"
    | "TP"
    | "SL"
    | "UPDATE_SL"
    | "UPDATE_TP"
    | "ADD_TP";
  symbol: string;
  entryPrice?: number;
  takeProfitTargets?: number[];
  stopLoss?: number;
  leverage?: number;
  positionSize?: number;
  orderType?: "market" | "limit";
  timeframe?: string;
  confidence?: number;
  reasoning?: string;
  /** Set by executor after mapping — not returned by AI */
  rawSignal?: string;
  /** Discord messageId mapped by executor */
  messageId?: string;
}

/** Input for bulk AI parsing — pairs a Discord messageId with its content */
export interface BulkMessageInput {
  messageId: string;
  content: string;
  imageUrls?: string[]; // optional image URLs to include in the AI prompt
}

export interface PositionAnalysis {
  decision: "CLOSE" | "HOLD" | "MOVE_SL" | "PARTIAL_CLOSE" | "UPDATE_TP";
  symbol: string;
  reason: string;
  newStopLoss?: number;
  newTakeProfit?: number;
  closePercentage?: number;
  confidence: number;
  currentMarketCondition: string;
}

export interface BulkSignalResult {
  messageId: string; // maps back to BulkMessageInput.messageId
  signal: TradingSignal | null;
}

export interface AISignalAnalyzer {
  parseSignal(message: string): Promise<TradingSignal | null>;
  parseBulkSignals(messages: BulkMessageInput[]): Promise<BulkSignalResult[]>;
  analyzePosition(
    symbol: string,
    side: string,
    entryPrice: number,
    currentPrice: number,
    takeProfit?: number,
    stopLoss?: number,
    pnl?: number,
    quantity?: number,
  ): Promise<PositionAnalysis>;
}
