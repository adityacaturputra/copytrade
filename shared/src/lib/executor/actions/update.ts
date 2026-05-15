import { Position, recalculateTPAllocation } from "../../database";
import { resolveExchangeForPosition } from "../utils/exchange";
import { logExecutorInfo, logExecutorWarn, logProcessStep } from "../../process/log";
import type { SignalExecutionResult } from "../types";
import type { TradingSignal } from "../../ai/core/types";

export async function handleUpdateSignal({ signal, channelId, accountId, processId }: { signal: TradingSignal; channelId?: string; accountId?: string; processId?: string; }): Promise<SignalExecutionResult> {
  if (signal.action === "ADD_TP") return handleAddTpSignal({ signal, channelId, accountId, processId });
  const position = await Position.findOne({ symbol: signal.symbol, channelId: channelId || null, status: "open" });
  if (!position) {
    const details = `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to update`;
    await logExecutorInfo(`⚠️ ${details}`, { accountId, processId, symbol: signal.symbol, action: "console_position_update_noop" });
    await logProcessStep({ accountId, processId, type: "draft_process", action: "position_update_noop", symbol: signal.symbol, details, result: "noop" });
    return { type: "noop", code: "no_open_position", details };
  }
  if (signal.action === "UPDATE_SL" && signal.stopLoss) position.stopLossPrice = signal.stopLoss;
  if (signal.action === "UPDATE_TP" && signal.takeProfitTargets?.length) {
    position.takeProfitTargets = signal.takeProfitTargets.map((price) => ({ price, quantity: position.quantity / signal.takeProfitTargets!.length, percentage: Number((100 / signal.takeProfitTargets!.length).toFixed(2)), status: "pending" }));
  }
  await position.save();
  await logExecutorInfo(`✅ Updated ${signal.action} for ${signal.symbol} (channel=${channelId || "any"})`, { accountId, processId, symbol: signal.symbol, action: "console_position_updated" });
  await logProcessStep({ accountId, processId, type: "draft_process", action: "position_update_completed", symbol: signal.symbol, details: `${signal.action} applied for ${signal.symbol}`, result: "updated" });
  return { type: "updated", code: signal.action.toLowerCase(), details: `${signal.action} applied for ${signal.symbol}` };
}

async function handleAddTpSignal({ signal, channelId, accountId, processId }: { signal: TradingSignal; channelId?: string; accountId?: string; processId?: string; }): Promise<SignalExecutionResult> {
  const position = await Position.findOne({ symbol: signal.symbol, channelId: channelId || null, status: "open" });
  if (!position || !signal.takeProfitTargets?.length) {
    const details = `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to add TP`;
    await logExecutorInfo(`⚠️ ${details}`, { accountId, processId, symbol: signal.symbol, action: "console_add_tp_noop" });
    return { type: "noop", code: "no_open_position", details };
  }

  const posExchange = await resolveExchangeForPosition(position.accountId, accountId, { allowNullWhenUnavailable: true });
  const closeSide = position.side === "LONG" ? "SELL" : "BUY";
  let addedCount = 0;

  for (const newTpPrice of signal.takeProfitTargets) {
    const alreadyExists = position.takeProfitTargets.some((target) => Math.abs(target.price - newTpPrice) < 0.01);
    if (alreadyExists) continue;
    position.takeProfitTargets.push({ price: newTpPrice, quantity: 0, percentage: 0, status: "pending" });
    addedCount++;
    if (!posExchange) continue;
    try {
      await posExchange.placeTakeProfit(signal.symbol, newTpPrice, newTpPrice, closeSide, position.quantity);
    } catch (tpErr) {
      await logExecutorWarn(`⚠️ Failed to place TP on exchange at ${newTpPrice}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`, { accountId: position.accountId || accountId, processId, symbol: signal.symbol, action: "console_add_tp_failed" });
    }
  }

  position.takeProfitTargets = recalculateTPAllocation(position.takeProfitTargets, position.quantity);
  await position.save();
  await logExecutorInfo(`✅ Updated TPs for ${signal.symbol}: ${position.takeProfitTargets.map((target) => `${target.price}(${target.percentage}%)`).join(", ")}`, { accountId: position.accountId || accountId, processId, symbol: signal.symbol, action: "console_add_tp_updated" });

  return addedCount > 0
    ? { type: "updated", code: "add_tp", details: `Added ${addedCount} TP target(s) for ${signal.symbol}` }
    : { type: "noop", code: "tp_exists", details: `All requested TP levels already exist for ${signal.symbol}` };
}
