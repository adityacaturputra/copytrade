import {
  TradeAction,
  SignalOrderType,
  PositionDecision,
  MarketCondition,
} from "@/lib/enums";

export interface TradingSignal {
  action: TradeAction;
  symbol: string;
  entryPrice?: number;
  takeProfitTargets?: number[];
  stopLoss?: number;
  leverage?: number;
  positionSize?: number;
  orderType?: SignalOrderType;
  /** Risk-Reward ratio extracted from signal (e.g., 3 means 3R / 3:1 RR) */
  defaultRR?: number;
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
  decision: PositionDecision;
  symbol: string;
  reason: string;
  newStopLoss?: number;
  newTakeProfit?: number;
  closePercentage?: number;
  confidence: number;
  currentMarketCondition: MarketCondition;
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
