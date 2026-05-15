import { Position } from "../../database";
import { calculatePositionPnlUsd, resolveExchangeForPosition, resolveExitPrice } from "../utils/exchange";
import { logExecutorInfo, logExecutorWarn, logProcessStep } from "../../process/log";
import type { SignalExecutionResult } from "../types";
import type { TradingSignal } from "../../ai/core/types";

async function getRequiredExchangeForPosition(positionAccountId?: string) {
  const exchange = await resolveExchangeForPosition(positionAccountId);
  if (!exchange) throw new Error("Exchange unavailable for position account");
  return exchange;
}

export async function handleCancelOrCloseSignal({ signal, channelId, accountId, processId }: { signal: TradingSignal; channelId?: string; accountId?: string; processId?: string; }): Promise<SignalExecutionResult> {
  if (signal.action === "CANCEL") return handleCancelSignal({ signal, channelId, accountId, processId });
  return handleCloseSignal({ signal, channelId, accountId, processId });
}

async function handleCancelSignal({ signal, channelId, accountId, processId }: { signal: TradingSignal; channelId?: string; accountId?: string; processId?: string; }): Promise<SignalExecutionResult> {
  let cancelledCount = 0;
  let closedCount = 0;
  const pendingPositions = await Position.find({ symbol: signal.symbol, channelId: channelId || null, status: "pending" });
  for (const pos of pendingPositions) {
    try {
      const posExchange = await getRequiredExchangeForPosition(pos.accountId);
      if (pos.orderId) {
        try {
          await posExchange.cancelOrder(pos.orderId, pos.symbol);
          await logExecutorInfo(`🚫 Cancelled limit order ${pos.orderId} on exchange for ${pos.symbol}`, { accountId: pos.accountId || accountId, processId, symbol: pos.symbol, action: "console_cancel_limit_order" });
        } catch (cancelErr) {
          await logExecutorWarn(`⚠️ Failed to cancel limit order ${pos.orderId} on exchange: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`, { accountId: pos.accountId || accountId, processId, symbol: pos.symbol, action: "console_cancel_limit_order_failed" });
        }
      }
      pos.status = "closed";
      pos.closedAt = new Date();
      pos.closeReason = `Cancel signal: ${signal.reasoning || "signal author requested cancellation"}`;
      await pos.save();
      cancelledCount++;
    } catch (cancelErr) {
      await logExecutorWarn(`⚠️ Failed to cancel pending position ${pos.symbol}: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`, { accountId: pos.accountId || accountId, processId, symbol: pos.symbol, action: "console_cancel_pending_failed" });
    }
  }
  const closedFromOpen = await closeOpenPositions({ signal, channelId, accountId, processId });
  closedCount += closedFromOpen;
  return finalizeCloseResult(signal, pendingPositions.length, cancelledCount, closedCount, accountId, processId);
}

async function handleCloseSignal({ signal, channelId, accountId, processId }: { signal: TradingSignal; channelId?: string; accountId?: string; processId?: string; }): Promise<SignalExecutionResult> {
  const closedCount = await closeOpenPositions({ signal, channelId, accountId, processId });
  if (closedCount === 0) {
    const details = `No open positions found for ${signal.symbol} (channel=${channelId || "any"}) to close`;
    await logProcessStep({ accountId, processId, type: "draft_process", action: "close_noop", symbol: signal.symbol, details, result: "noop" });
    return { type: "noop", code: "no_open_position", details };
  }
  await logProcessStep({ accountId, processId, type: "draft_process", action: "close_completed", symbol: signal.symbol, details: `Closed ${closedCount} position(s)`, result: "closed" });
  return { type: "closed", closedCount };
}

async function closeOpenPositions({ signal, channelId, accountId, processId }: { signal: TradingSignal; channelId?: string; accountId?: string; processId?: string; }) {
  let closedCount = 0;
  const openPositions = await Position.find({ symbol: signal.symbol, channelId: channelId || null, status: "open" });
  for (const pos of openPositions) {
    try {
      const posExchange = await getRequiredExchangeForPosition(pos.accountId);
      const exitPrice = await resolveExitPrice(posExchange, pos);
      await posExchange.closePosition(pos.symbol, undefined, pos.quantity);
      try {
        await posExchange.cancelAlgoOrders(pos.symbol);
      } catch (algoErr) {
        await logExecutorWarn(`⚠️ Failed to cancel algo orders (TP/SL) for ${pos.symbol}: ${algoErr instanceof Error ? algoErr.message : String(algoErr)}`, { accountId: pos.accountId || accountId, processId, symbol: pos.symbol, action: "console_cancel_algo_orders_failed" });
      }
      pos.status = "closed";
      pos.closedAt = new Date();
      pos.closeReason = `${signal.action === "CANCEL" ? "Cancel signal" : "Close signal"}: ${signal.reasoning || "signal author requested closure"}`;
      if (exitPrice !== null) {
        pos.currentPrice = exitPrice;
        pos.pnlUsd = calculatePositionPnlUsd(pos, exitPrice) ?? pos.pnlUsd ?? null;
      }
      await pos.save();
      closedCount++;
    } catch (closeErr) {
      await logExecutorWarn(`⚠️ Failed to ${signal.action === "CANCEL" ? "cancel-close" : "close"} ${pos.symbol}: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`, { accountId: pos.accountId || accountId, processId, symbol: pos.symbol, action: signal.action === "CANCEL" ? "console_cancel_close_failed" : "console_close_failed" });
    }
  }
  return closedCount;
}

function finalizeCloseResult(signal: TradingSignal, pendingCount: number, cancelledCount: number, closedCount: number, accountId?: string, processId?: string): SignalExecutionResult {
  const totalAffected = cancelledCount + closedCount;
  if (totalAffected === 0) {
    const hasPositions = pendingCount > 0;
    if (hasPositions) {
      return { type: "skipped", code: "cancel_failed", reason: `Failed to cancel/close the positions for ${signal.symbol}. Check process logs for details.` };
    }
    return { type: "noop", code: "no_position", details: `No pending/open positions found for ${signal.symbol}` };
  }
  void logProcessStep({ accountId, processId, type: "draft_process", action: "cancel_completed", symbol: signal.symbol, details: `Cancelled ${cancelledCount} pending and closed ${closedCount} open position(s)`, result: "closed" });
  return { type: "closed", closedCount: totalAffected };
}
