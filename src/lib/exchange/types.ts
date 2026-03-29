// ==================== Exchange Interface ====================
// All exchange implementations must implement this interface.
// This allows swapping between MEXC, OKX, Binance, etc. seamlessly.

/** Normalized order parameters across all exchanges */
export interface OrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  quantity: number;
  price?: number;
  leverage?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

/** Normalized position data across all exchanges */
export interface PositionInfo {
  symbol: string;
  positionId: string;
  side: "LONG" | "SHORT";
  leverage: number;
  marginType: "isolated" | "cross";
  entryPrice: number;
  quantity: number;
  margin: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  markPrice: number;
  raw?: unknown; // Original exchange-specific data
}

/** Normalized account info across all exchanges */
export interface AccountInfo {
  totalBalance: number;
  availableBalance: number;
  unrealizedPnl: number;
  currency: string;
}

/** Normalized kline/candlestick data */
export interface KlineData {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  time: number;
}

/** Order result */
export interface OrderResult {
  orderId: string;
  price: number;
  quantity: number;
  status: string;
  raw?: unknown;
}

/**
 * ExchangeClient — the common interface every exchange adapter must implement.
 *
 * Methods:
 *   - Account:   getAccountInfo
 *   - Market:    getTickerPrice, getKlines
 *   - Positions: getOpenPositions
 *   - Orders:    placeOrder, closePosition, closeAllPositions
 *   - Leverage:  setLeverage
 *   - TP/SL:     placeStopLoss, placeTakeProfit
 */
export interface ExchangeClient {
  /** Unique name of the exchange adapter */
  readonly name: string;

  // ─── Account ────────────────────────────────────────────────────────
  getAccountInfo(): Promise<AccountInfo>;

  // ─── Market Data ────────────────────────────────────────────────────
  getTickerPrice(symbol: string): Promise<number>;
  getKlines(
    symbol: string,
    interval?: string,
    limit?: number,
  ): Promise<KlineData[]>;

  // ─── Positions ──────────────────────────────────────────────────────
  getOpenPositions(): Promise<PositionInfo[]>;

  // ─── Orders ─────────────────────────────────────────────────────────
  placeOrder(params: OrderParams): Promise<OrderResult>;
  closePosition(
    symbol: string,
    positionId?: string,
    quantity?: number,
  ): Promise<void>;
  closeAllPositions(): Promise<{ closed: string[]; errors: string[] }>;

  // ─── Leverage ───────────────────────────────────────────────────────
  setLeverage(
    symbol: string,
    leverage: number,
    marginType?: "isolated" | "cross",
    side?: "BUY" | "SELL",
  ): Promise<void>;

  // ─── Stop Loss / Take Profit ────────────────────────────────────────
  placeStopLoss(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string>;
  placeTakeProfit(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string>;
}
