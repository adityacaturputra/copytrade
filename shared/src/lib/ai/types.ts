import {
  TradeAction,
  SignalOrderType,
  PositionDecision,
  MarketCondition,
  MessageType,
} from "../enums";

export interface TradingSignal {
  messageType?: MessageType;
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

export interface PositionContextMessage {
  messageId: string;
  author: string;
  content: string;
  timestamp?: string;
  messageUrl?: string;
  imageUrls?: string[];
  isSourceMessage?: boolean;
}

export interface PositionContextSnapshot {
  symbol: string;
  side: string;
  status: string;
  entryPrice: number;
  currentPrice?: number;
  quantity: number;
  leverage: number;
  stopLoss?: number;
  takeProfitTargets: Array<{
    price: number;
    status?: string;
    percentage?: number;
  }>;
  pnl?: number;
  messageId?: string;
  openedAt?: string;
}

export interface PositionAnalysisInput {
  symbol: string;
  side: string;
  entryPrice: number;
  currentPrice: number;
  takeProfitTargets?: number[];
  stopLoss?: number;
  pnl?: number;
  quantity?: number;
  currentTime: string;
  accountName?: string;
  tradingPlatform?: string;
  sourceMessageId?: string;
  sourceChannelId?: string;
  sourceMessageUrl?: string;
  accountOpenPositions?: PositionContextSnapshot[];
  discordContextMessages?: PositionContextMessage[];
}

export interface BulkSignalResult {
  messageId: string; // maps back to BulkMessageInput.messageId
  signal: TradingSignal | null;
}

export interface AISignalAnalyzer {
  parseSignal(message: string): Promise<TradingSignal | null>;
  parseBulkSignals(messages: BulkMessageInput[]): Promise<BulkSignalResult[]>;
  analyzePosition(input: PositionAnalysisInput): Promise<PositionAnalysis>;
}
