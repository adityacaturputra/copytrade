import { MessageType, TradeAction } from "../enums";
import { TradingSignal } from "./types";

const ACTION_ALIASES: Record<string, TradeAction> = {
  BUY: TradeAction.BUY,
  LONG: TradeAction.BUY,
  SELL: TradeAction.SELL,
  SHORT: TradeAction.SELL,
  CLOSE: TradeAction.CLOSE,
  CLOSE_POSITION: TradeAction.CLOSE,
  CANCEL: TradeAction.CANCEL,
  CANCEL_ORDER: TradeAction.CANCEL,
  HOLD: TradeAction.HOLD,
  TP: TradeAction.TP,
  TAKE_PROFIT: TradeAction.TP,
  TAKEPROFIT: TradeAction.TP,
  SL: TradeAction.SL,
  STOP_LOSS: TradeAction.SL,
  STOPLOSS: TradeAction.SL,
  UPDATE_SL: TradeAction.UPDATE_SL,
  MOVE_SL: TradeAction.UPDATE_SL,
  MOVE_STOP_LOSS: TradeAction.UPDATE_SL,
  MODIFY_SL: TradeAction.UPDATE_SL,
  UPDATE_TP: TradeAction.UPDATE_TP,
  MOVE_TP: TradeAction.UPDATE_TP,
  MODIFY_TP: TradeAction.UPDATE_TP,
  ADD_TP: TradeAction.ADD_TP,
  ADD_TAKE_PROFIT: TradeAction.ADD_TP,
};

const MESSAGE_TYPE_ALIASES: Record<string, MessageType> = {
  new_entry: MessageType.NEW_ENTRY,
  newentry: MessageType.NEW_ENTRY,
  position_update: MessageType.POSITION_UPDATE,
  positionupdate: MessageType.POSITION_UPDATE,
  close_cancel: MessageType.CLOSE_CANCEL,
  closecancel: MessageType.CLOSE_CANCEL,
  result_status: MessageType.RESULT_STATUS,
  resultstatus: MessageType.RESULT_STATUS,
  ignore: MessageType.IGNORE,
};

function normalizeAction(action?: unknown): TradeAction | null {
  if (typeof action !== "string") return null;

  const normalized = action.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return ACTION_ALIASES[normalized] || null;
}

function normalizeMessageType(messageType?: unknown): MessageType | null {
  if (typeof messageType !== "string") return null;

  const normalized = messageType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return MESSAGE_TYPE_ALIASES[normalized] || null;
}

function normalizeOrderType(
  orderType: unknown,
): TradingSignal["orderType"] | undefined {
  if (typeof orderType !== "string") return undefined;

  const normalized = orderType.trim().toLowerCase();
  if (normalized === "limit") return "limit";
  if (normalized === "market") return "market";
  return undefined;
}

function inferMessageTypeFromAction(action?: TradeAction | null): MessageType | null {
  switch (action) {
    case TradeAction.BUY:
    case TradeAction.SELL:
      return MessageType.NEW_ENTRY;
    case TradeAction.UPDATE_SL:
    case TradeAction.UPDATE_TP:
    case TradeAction.ADD_TP:
    case TradeAction.TP:
    case TradeAction.SL:
      return MessageType.POSITION_UPDATE;
    case TradeAction.CANCEL:
    case TradeAction.CLOSE:
      return MessageType.CLOSE_CANCEL;
    case TradeAction.HOLD:
      return MessageType.RESULT_STATUS;
    default:
      return null;
  }
}

export function normalizeTradingSignal(
  parsed: Record<string, unknown> | null | undefined,
): TradingSignal | null {
  if (!parsed) return null;

  const action = normalizeAction(parsed.action);
  const explicitMessageType = normalizeMessageType(parsed.messageType);
  const inferredMessageType = inferMessageTypeFromAction(action);
  const messageType = explicitMessageType || inferredMessageType;

  if (
    messageType === MessageType.RESULT_STATUS ||
    messageType === MessageType.IGNORE
  ) {
    return null;
  }

  if (!action || typeof parsed.symbol !== "string" || !parsed.symbol) {
    return null;
  }

  return {
    ...(parsed as Omit<TradingSignal, "rawSignal" | "messageId">),
    action,
    messageType: messageType || undefined,
    orderType: normalizeOrderType(parsed.orderType),
  } as TradingSignal;
}
