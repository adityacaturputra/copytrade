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
export declare const TradeAction: {
    readonly BUY: "BUY";
    readonly SELL: "SELL";
    readonly CLOSE: "CLOSE";
    readonly CANCEL: "CANCEL";
    readonly HOLD: "HOLD";
    readonly TP: "TP";
    readonly SL: "SL";
    readonly UPDATE_SL: "UPDATE_SL";
    readonly UPDATE_TP: "UPDATE_TP";
    readonly ADD_TP: "ADD_TP";
};
export type TradeAction = (typeof TradeAction)[keyof typeof TradeAction];
export declare const MessageType: {
    readonly NEW_ENTRY: "new_entry";
    readonly POSITION_UPDATE: "position_update";
    readonly CLOSE_CANCEL: "close_cancel";
    readonly RESULT_STATUS: "result_status";
    readonly IGNORE: "ignore";
};
export type MessageType = (typeof MessageType)[keyof typeof MessageType];
/** Actions that represent opening a new trade */
export declare const ENTRY_ACTIONS: readonly TradeAction[];
/** Check if an action is an entry action (BUY or SELL) */
export declare function isEntryAction(action: string): action is TradeAction;
export declare const PositionSide: {
    readonly LONG: "LONG";
    readonly SHORT: "SHORT";
};
export type PositionSide = (typeof PositionSide)[keyof typeof PositionSide];
/** Map a signal action to a position side */
export declare function actionToSide(action: TradeAction): PositionSide;
export declare const OrderSide: {
    readonly BUY: "BUY";
    readonly SELL: "SELL";
};
export type OrderSide = (typeof OrderSide)[keyof typeof OrderSide];
/** Map a signal action to an exchange order side */
export declare function actionToOrderSide(action: TradeAction): OrderSide;
/** Get the closing side for a given position side */
export declare function closeSideForPosition(positionSide: PositionSide): OrderSide;
export declare const ExchangeOrderType: {
    readonly MARKET: "MARKET";
    readonly LIMIT: "LIMIT";
};
export type ExchangeOrderType = (typeof ExchangeOrderType)[keyof typeof ExchangeOrderType];
export declare const SignalOrderType: {
    readonly MARKET: "market";
    readonly LIMIT: "limit";
};
export type SignalOrderType = (typeof SignalOrderType)[keyof typeof SignalOrderType];
/** Map AI signal orderType to exchange order type */
export declare function signalToExchangeOrderType(orderType?: string): ExchangeOrderType;
export declare const MarginType: {
    readonly ISOLATED: "isolated";
    readonly CROSS: "cross";
};
export type MarginType = (typeof MarginType)[keyof typeof MarginType];
export declare const PositionStatus: {
    readonly OPEN: "open";
    readonly CLOSED: "closed";
    readonly PENDING: "pending";
};
export type PositionStatus = (typeof PositionStatus)[keyof typeof PositionStatus];
export declare const PositionDecision: {
    readonly CLOSE: "CLOSE";
    readonly HOLD: "HOLD";
    readonly MOVE_SL: "MOVE_SL";
    readonly PARTIAL_CLOSE: "PARTIAL_CLOSE";
    readonly UPDATE_TP: "UPDATE_TP";
};
export type PositionDecision = (typeof PositionDecision)[keyof typeof PositionDecision];
export declare const TradingMode: {
    readonly AUTO: "auto";
    readonly MANUAL: "manual";
};
export type TradingMode = (typeof TradingMode)[keyof typeof TradingMode];
export declare const MarketCondition: {
    readonly BULLISH: "BULLISH";
    readonly BEARISH: "BEARISH";
    readonly NEUTRAL: "NEUTRAL";
    readonly VOLATILE: "VOLATILE";
};
export type MarketCondition = (typeof MarketCondition)[keyof typeof MarketCondition];
export declare const SourceType: {
    readonly DISCORD: "discord";
    readonly TELEGRAM: "telegram";
};
export type SourceType = (typeof SourceType)[keyof typeof SourceType];
//# sourceMappingURL=enums.d.ts.map