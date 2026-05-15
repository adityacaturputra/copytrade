import { resolveEffectiveRiskConfig } from "../risk";
import { logExecutorInfo } from "../process/log";
import { sanitizeLeverage } from "./utils/signal";
import { handleOpenSignal } from "./actions/open";
import { handleCancelOrCloseSignal } from "./actions/manage";
import { handleUpdateSignal } from "./actions/update";
import type { SignalExecutionResult } from "./types";
import type { TradingSignal } from "../ai/core/types";

export async function executeSignal(
  signal: TradingSignal,
  messageId: string,
  channelId?: string,
  sourceName?: string,
  accountId?: string,
  processId?: string,
): Promise<SignalExecutionResult> {
  const riskCfg = await resolveEffectiveRiskConfig({ accountId, channelId });
  const side = signal.action === "SELL" ? "SHORT" : "LONG";
  const leverage = sanitizeLeverage(signal.leverage) || riskCfg.defaultLeverage;
  const quantity = signal.positionSize || riskCfg.defaultPositionSize;
  const entryPrice = signal.entryPrice;

  switch (signal.action) {
    case "BUY":
    case "SELL":
      return handleOpenSignal({ signal, riskCfg, side, leverage, quantity, entryPrice, channelId, sourceName, accountId, processId, messageId });
    case "CANCEL":
    case "CLOSE":
      return handleCancelOrCloseSignal({ signal, channelId, accountId, processId });
    case "UPDATE_SL":
    case "UPDATE_TP":
    case "ADD_TP":
      return handleUpdateSignal({ signal, channelId, accountId, processId });
    default:
      await logExecutorInfo(`⚠️ Unhandled signal action: ${signal.action}`, {
        accountId,
        processId,
        symbol: signal.symbol,
        action: "console_unhandled_action",
      });
      return {
        type: "skipped",
        code: "unhandled_action",
        reason: `Unhandled signal action: ${signal.action}`,
      };
  }
}
