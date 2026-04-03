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

/** Open/pending order info */
export interface OpenOrderInfo {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string; // "limit", "market", "conditional", etc.
  price?: number;
  quantity: number;
  filledQuantity: number;
  status: string;
  createdAt?: number;
  raw?: unknown;
}

/** Algo order info (TP/SL) */
export interface AlgoOrderInfo {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string; // "tp", "sl", "conditional"
  triggerPrice: number;
  executePrice?: number;
  quantity: number;
  status: string;
  createdAt?: number;
  raw?: unknown;
}

/** Historical order (filled/cancelled) */
export interface HistoricalOrder {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  price: number;
  quantity: number;
  filledQuantity: number;
  fee: number;
  realizedPnl?: number;
  status: string;
  createdAt: number;
  updatedAt?: number;
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

  // ─── Order Management ───────────────────────────────────────────────
  /** Get all open/pending orders on the exchange */
  getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]>;
  /** Cancel a specific order by orderId */
  cancelOrder(orderId: string, symbol: string): Promise<boolean>;
  /** Get algo orders (TP/SL) for a symbol */
  getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]>;
  /** Cancel all algo orders (TP/SL) for a symbol */
  cancelAlgoOrders(
    symbol: string,
  ): Promise<{ cancelled: string[]; errors: string[] }>;
  /** Get recent order history (filled/cancelled) */
  getOrderHistory(symbol?: string, limit?: number): Promise<HistoricalOrder[]>;
}
