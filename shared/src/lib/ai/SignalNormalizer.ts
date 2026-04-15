import { MessageType } from "../enums";
import { TradingSignal } from "./types";

function inferMessageTypeFromAction(action?: string): MessageType | null {
  switch (action) {
    case "BUY":
    case "SELL":
      return "new_entry";
    case "UPDATE_SL":
    case "UPDATE_TP":
    case "ADD_TP":
    case "TP":
    case "SL":
      return "position_update";
    case "CANCEL":
    case "CLOSE":
      return "close_cancel";
    case "HOLD":
      return "result_status";
    default:
      return null;
  }
}

export function normalizeTradingSignal(
  parsed: Record<string, unknown> | null | undefined,
): TradingSignal | null {
  if (!parsed) return null;

  const explicitMessageType =
    typeof parsed.messageType === "string"
      ? (parsed.messageType as MessageType)
      : null;
  const inferredMessageType = inferMessageTypeFromAction(
    typeof parsed.action === "string" ? parsed.action : undefined,
  );
  const messageType = explicitMessageType || inferredMessageType;

  if (messageType === "result_status" || messageType === "ignore") {
    return null;
  }

  if (
    typeof parsed.action !== "string" ||
    typeof parsed.symbol !== "string" ||
    !parsed.action ||
    !parsed.symbol
  ) {
    return null;
  }

  return {
    ...(parsed as Omit<TradingSignal, "rawSignal" | "messageId">),
    messageType: messageType || undefined,
  } as TradingSignal;
}
