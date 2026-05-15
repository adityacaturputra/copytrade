/**
 * Central enums for the copytrade application.
 *
 * Single source of truth for all string constants used across:
 *   - AI signal parsing (action, orderType)
 *   - Position tracking (side, status)
 *   - Exchange layer (orderSide, orderType, marginType)
 *   - Agent tools
 *   - Database schemas
 *
 * Uses `const` objects + `as const` for tree-shakeable, type-safe enums.
 */

// ==================== Signal Actions ====================
// These are the values the AI returns in `action` field.
// The AI should ONLY return BUY/SELL for new entries (never LONG/SHORT).

export const TradeAction = {
  BUY: "BUY",
  SELL: "SELL",
  CLOSE: "CLOSE",
  CANCEL: "CANCEL",
  HOLD: "HOLD",
  TP: "TP",
  SL: "SL",
  UPDATE_SL: "UPDATE_SL",
  UPDATE_TP: "UPDATE_TP",
  ADD_TP: "ADD_TP",
} as const;

export type TradeAction = (typeof TradeAction)[keyof typeof TradeAction];

// ==================== Message Type ====================
// High-level classification for an incoming message before execution.

export const MessageType = {
  NEW_ENTRY: "new_entry",
  POSITION_UPDATE: "position_update",
  CLOSE_CANCEL: "close_cancel",
  RESULT_STATUS: "result_status",
  IGNORE: "ignore",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Actions that represent opening a new trade */
export const ENTRY_ACTIONS: readonly TradeAction[] = [
  TradeAction.BUY,
  TradeAction.SELL,
] as const;

/** Check if an action is an entry action (BUY or SELL) */
export function isEntryAction(action: string): action is TradeAction {
  return action === TradeAction.BUY || action === TradeAction.SELL;
}

// ==================== Position Side ====================
// Direction of an open position. Derived from TradeAction:
//   BUY  → LONG,  SELL → SHORT

export const PositionSide = {
  LONG: "LONG",
  SHORT: "SHORT",
} as const;

export type PositionSide = (typeof PositionSide)[keyof typeof PositionSide];

/** Map a signal action to a position side */
export function actionToSide(action: TradeAction): PositionSide {
  return action === TradeAction.SELL ? PositionSide.SHORT : PositionSide.LONG;
}

// ==================== Order Side ====================
// Exchange-level order direction for placing/closing orders.

export const OrderSide = {
  BUY: "BUY",
  SELL: "SELL",
} as const;

export type OrderSide = (typeof OrderSide)[keyof typeof OrderSide];

/** Map a signal action to an exchange order side */
export function actionToOrderSide(action: TradeAction): OrderSide {
  return action === TradeAction.SELL ? OrderSide.SELL : OrderSide.BUY;
}

/** Get the closing side for a given position side */
export function closeSideForPosition(positionSide: PositionSide): OrderSide {
  return positionSide === PositionSide.LONG ? OrderSide.SELL : OrderSide.BUY;
}

// ==================== Exchange Order Type ====================
// Used in exchange placeOrder() calls.

export const ExchangeOrderType = {
  MARKET: "MARKET",
  LIMIT: "LIMIT",
} as const;

export type ExchangeOrderType =
  (typeof ExchangeOrderType)[keyof typeof ExchangeOrderType];

// ==================== Signal Order Type ====================
// The orderType field returned by AI in signal JSON (lowercase).

export const SignalOrderType = {
  MARKET: "market",
  LIMIT: "limit",
} as const;

export type SignalOrderType =
  (typeof SignalOrderType)[keyof typeof SignalOrderType];

/** Map AI signal orderType to exchange order type */
export function signalToExchangeOrderType(
  orderType?: string,
): ExchangeOrderType {
  return orderType === SignalOrderType.LIMIT
    ? ExchangeOrderType.LIMIT
    : ExchangeOrderType.MARKET;
}

// ==================== Margin Type ====================

export const MarginType = {
  ISOLATED: "isolated",
  CROSS: "cross",
} as const;

export type MarginType = (typeof MarginType)[keyof typeof MarginType];

// ==================== Position Status ====================

export const PositionStatus = {
  OPEN: "open",
  CLOSED: "closed",
  PENDING: "pending",
} as const;

export type PositionStatus =
  (typeof PositionStatus)[keyof typeof PositionStatus];

// ==================== Position Analysis Decision ====================
// Returned by AI position analyzer.

export const PositionDecision = {
  CLOSE: "CLOSE",
  HOLD: "HOLD",
  MOVE_SL: "MOVE_SL",
  PARTIAL_CLOSE: "PARTIAL_CLOSE",
  UPDATE_TP: "UPDATE_TP",
} as const;

export type PositionDecision =
  (typeof PositionDecision)[keyof typeof PositionDecision];

// ==================== Trading Mode ====================

export const TradingMode = {
  AUTO: "auto",
  MANUAL: "manual",
} as const;

export type TradingMode = (typeof TradingMode)[keyof typeof TradingMode];

// ==================== Market Condition ====================

export const MarketCondition = {
  BULLISH: "BULLISH",
  BEARISH: "BEARISH",
  NEUTRAL: "NEUTRAL",
  VOLATILE: "VOLATILE",
} as const;

export type MarketCondition =
  (typeof MarketCondition)[keyof typeof MarketCondition];

// ==================== Source Type ====================
// The type of message source (Discord, Telegram, WhatsApp, etc.)

export const SourceType = {
  DISCORD: "discord",
  TELEGRAM: "telegram",
} as const;

export type SourceType = (typeof SourceType)[keyof typeof SourceType];
