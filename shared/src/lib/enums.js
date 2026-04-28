"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceType = exports.MarketCondition = exports.TradingMode = exports.PositionDecision = exports.PositionStatus = exports.MarginType = exports.SignalOrderType = exports.ExchangeOrderType = exports.OrderSide = exports.PositionSide = exports.ENTRY_ACTIONS = exports.MessageType = exports.TradeAction = void 0;
exports.isEntryAction = isEntryAction;
exports.actionToSide = actionToSide;
exports.actionToOrderSide = actionToOrderSide;
exports.closeSideForPosition = closeSideForPosition;
exports.signalToExchangeOrderType = signalToExchangeOrderType;
// ==================== Signal Actions ====================
// These are the values the AI returns in `action` field.
// The AI should ONLY return BUY/SELL for new entries (never LONG/SHORT).
exports.TradeAction = {
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
};
// ==================== Message Type ====================
// High-level classification for an incoming message before execution.
exports.MessageType = {
    NEW_ENTRY: "new_entry",
    POSITION_UPDATE: "position_update",
    CLOSE_CANCEL: "close_cancel",
    RESULT_STATUS: "result_status",
    IGNORE: "ignore",
};
/** Actions that represent opening a new trade */
exports.ENTRY_ACTIONS = [
    exports.TradeAction.BUY,
    exports.TradeAction.SELL,
];
/** Check if an action is an entry action (BUY or SELL) */
function isEntryAction(action) {
    return action === exports.TradeAction.BUY || action === exports.TradeAction.SELL;
}
// ==================== Position Side ====================
// Direction of an open position. Derived from TradeAction:
//   BUY  → LONG,  SELL → SHORT
exports.PositionSide = {
    LONG: "LONG",
    SHORT: "SHORT",
};
/** Map a signal action to a position side */
function actionToSide(action) {
    return action === exports.TradeAction.SELL ? exports.PositionSide.SHORT : exports.PositionSide.LONG;
}
// ==================== Order Side ====================
// Exchange-level order direction for placing/closing orders.
exports.OrderSide = {
    BUY: "BUY",
    SELL: "SELL",
};
/** Map a signal action to an exchange order side */
function actionToOrderSide(action) {
    return action === exports.TradeAction.SELL ? exports.OrderSide.SELL : exports.OrderSide.BUY;
}
/** Get the closing side for a given position side */
function closeSideForPosition(positionSide) {
    return positionSide === exports.PositionSide.LONG ? exports.OrderSide.SELL : exports.OrderSide.BUY;
}
// ==================== Exchange Order Type ====================
// Used in exchange placeOrder() calls.
exports.ExchangeOrderType = {
    MARKET: "MARKET",
    LIMIT: "LIMIT",
};
// ==================== Signal Order Type ====================
// The orderType field returned by AI in signal JSON (lowercase).
exports.SignalOrderType = {
    MARKET: "market",
    LIMIT: "limit",
};
/** Map AI signal orderType to exchange order type */
function signalToExchangeOrderType(orderType) {
    return orderType === exports.SignalOrderType.LIMIT
        ? exports.ExchangeOrderType.LIMIT
        : exports.ExchangeOrderType.MARKET;
}
// ==================== Margin Type ====================
exports.MarginType = {
    ISOLATED: "isolated",
    CROSS: "cross",
};
// ==================== Position Status ====================
exports.PositionStatus = {
    OPEN: "open",
    CLOSED: "closed",
    PENDING: "pending",
};
// ==================== Position Analysis Decision ====================
// Returned by AI position analyzer.
exports.PositionDecision = {
    CLOSE: "CLOSE",
    HOLD: "HOLD",
    MOVE_SL: "MOVE_SL",
    PARTIAL_CLOSE: "PARTIAL_CLOSE",
    UPDATE_TP: "UPDATE_TP",
};
// ==================== Trading Mode ====================
exports.TradingMode = {
    AUTO: "auto",
    MANUAL: "manual",
};
// ==================== Market Condition ====================
exports.MarketCondition = {
    BULLISH: "BULLISH",
    BEARISH: "BEARISH",
    NEUTRAL: "NEUTRAL",
    VOLATILE: "VOLATILE",
};
// ==================== Source Type ====================
// The type of message source (Discord, Telegram, WhatsApp, etc.)
exports.SourceType = {
    DISCORD: "discord",
    TELEGRAM: "telegram",
};
//# sourceMappingURL=enums.js.map