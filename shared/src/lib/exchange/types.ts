// ==================== Exchange Interface ====================
// All exchange implementations must implement this interface.
// This allows swapping between MEXC, OKX, Binance, etc. seamlessly.

import {
  OrderSide,
  ExchangeOrderType,
  PositionSide,
  MarginType,
} from "../enums";

/** Normalized order parameters across all exchanges */
export interface OrderParams {
  symbol: string;
  side: OrderSide;
  type: ExchangeOrderType;
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
  side: PositionSide;
  leverage: number;
  marginType: MarginType;
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
  side: OrderSide;
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
  side: OrderSide;
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
  side: OrderSide;
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
    marginType?: MarginType,
    side?: OrderSide,
  ): Promise<number>;

  // ─── Stop Loss / Take Profit ────────────────────────────────────────
  placeStopLoss(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: OrderSide,
    quantity: number,
  ): Promise<string>;
  placeTakeProfit(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: OrderSide,
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

  // ─── Instrument Specs ────────────────────────────────────────────────
  /** Get instrument specifications (lot size, contract value, etc.) */
  getInstrumentSpecs(symbol: string): Promise<InstrumentSpecs>;
}

/** Instrument specifications from the exchange */
export interface InstrumentSpecs {
  /** Contract value per contract (e.g., 0.01 BTC for BTC-USDT-SWAP) */
  ctVal: number;
  /** Lot size — minimum quantity increment in contracts (e.g., 1) */
  lotSz: number;
  /** Minimum order size in contracts */
  minSz: number;
  /** Minimum notional/order value in quote currency when provided by exchange */
  minNotional?: number;
  /** Contract value currency (e.g., "BTC") */
  ctValCcy: string;
  /** Price tick size (e.g., 0.1 for BTC-USDT-SWAP) */
  tickSz: number;
  /** Number of decimal places for quantity (derived from lotSz) */
  qtyDecimals: number;
  /** Number of decimal places for price (derived from tickSz) */
  priceDecimals: number;
  /** Maximum leverage allowed for this instrument */
  maxLeverage?: number;
}
