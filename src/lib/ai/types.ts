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
    | "UPDATE_TP";
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
  rawSignal: string;
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

export interface AISignalAnalyzer {
  parseSignal(message: string): Promise<TradingSignal | null>;
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
