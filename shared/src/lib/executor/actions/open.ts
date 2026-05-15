import { Position, buildTPTargets } from "../../database";
import { logExecutorInfo, logExecutorWarn, logProcessStep } from "../../process/log";
import { autoCalculateTPFromRR, autoCalculateSLFromRR } from "../utils/signal";
import { executeTrade } from "../trades/execute-trade";
import type { SignalExecutionResult } from "../types";
import type { TradingSignal } from "../../ai/core/types";

export async function handleOpenSignal({
  signal,
  riskCfg,
  side,
  leverage,
  quantity,
  entryPrice,
  channelId,
  sourceName,
  accountId,
  processId,
  messageId,
}: {
  signal: TradingSignal;
  riskCfg: { maxPositions: number; skipNoSL: boolean; defaultRR: number; defaultPositionSize: number; defaultLeverage: number };
  side: "LONG" | "SHORT";
  leverage: number;
  quantity: number;
  entryPrice: number | null | undefined;
  channelId?: string;
  sourceName?: string;
  accountId?: string;
  processId?: string;
  messageId: string;
}): Promise<SignalExecutionResult> {
  if (riskCfg.maxPositions > 0) {
    const openCount = await Position.countDocuments({ status: { $in: ["open", "pending"] } });
    if (openCount >= riskCfg.maxPositions) {
      const reason = `Trade skipped: ${openCount} open positions, max is ${riskCfg.maxPositions}`;
      await logExecutorWarn(`🚫 Max positions reached (${openCount}/${riskCfg.maxPositions}) — skipping ${signal.action} ${signal.symbol}`, { accountId, processId, symbol: signal.symbol, action: "console_max_positions" });
      await logProcessStep({ accountId, processId, type: "draft_process", action: "execution_skipped_max_positions", symbol: signal.symbol, details: reason, result: "skipped" });
      return { type: "skipped", code: "max_positions", reason };
    }
  }

  const duplicateResult = await handleDuplicateOpenPosition(signal, side, channelId, entryPrice, accountId, processId);
  if (duplicateResult) return duplicateResult;

  let stopLoss = signal.stopLoss;
  let takeProfitTargets = signal.takeProfitTargets || [];
  if (!stopLoss && riskCfg.skipNoSL) {
    const reason = `Trade skipped: ${signal.symbol} ${signal.action} has no stop-loss and skipNoSL is enabled.`;
    await logExecutorWarn(`🚫 ${reason}`, { accountId, processId, symbol: signal.symbol, action: "console_skip_no_sl" });
    await logProcessStep({ accountId, processId, type: "draft_process", action: "execution_skipped_no_sl", symbol: signal.symbol, details: reason, result: "skipped" });
    return { type: "skipped", code: "skip_no_sl", reason };
  }

  if (!stopLoss && entryPrice && signal.defaultRR && takeProfitTargets[0]) {
    stopLoss = autoCalculateSLFromRR(entryPrice, takeProfitTargets[0], signal.defaultRR, side);
  }
  if (!stopLoss && entryPrice && riskCfg.defaultRR && takeProfitTargets[0]) {
    stopLoss = autoCalculateSLFromRR(entryPrice, takeProfitTargets[0], riskCfg.defaultRR, side);
  }
  if ((!takeProfitTargets || takeProfitTargets.length === 0) && entryPrice && stopLoss) {
    const rrToUse = signal.defaultRR || riskCfg.defaultRR;
    takeProfitTargets = autoCalculateTPFromRR(entryPrice, stopLoss, rrToUse, side);
  }

  const position = await executeTrade({
    symbol: signal.symbol,
    action: signal.action as "BUY" | "SELL",
    entryPrice: entryPrice || undefined,
    stopLoss,
    takeProfitTargets,
    leverage,
    quantity,
    orderType: signal.orderType === "limit" ? "LIMIT" : "MARKET",
    channelId,
    messageId,
    sourceName,
    signalData: JSON.stringify(signal),
    accountId,
    processId,
  });

  await logProcessStep({
    accountId,
    processId,
    type: "draft_process",
    action: "execution_completed",
    symbol: signal.symbol,
    details: { positionId: position._id.toString(), side: position.side },
    result: "executed",
  });

  return { type: "opened", position };
}

async function handleDuplicateOpenPosition(
  signal: TradingSignal,
  side: "LONG" | "SHORT",
  channelId: string | undefined,
  entryPrice: number | null | undefined,
  accountId?: string,
  processId?: string,
): Promise<SignalExecutionResult | null> {
  const existingPos = await Position.findOne({ symbol: signal.symbol, side, channelId: channelId || null, status: "open" });
  if (!existingPos) return null;

  const newTP = signal.takeProfitTargets?.[0] ?? null;
  const newSL = signal.stopLoss ?? null;
  const existingTP = existingPos.takeProfitTargets?.[0]?.price ?? null;
  const existingSL = existingPos.stopLossPrice ?? null;
  const existingEntry = existingPos.entryPrice ?? null;
  const newEntry = entryPrice ?? null;
  const equal = (a: number | null, b: number | null) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) < 0.01);
  const entryMatch = newEntry === null ? true : equal(newEntry, existingEntry);
  const tpMatch = equal(newTP, existingTP);
  const slMatch = equal(newSL, existingSL);

  if (entryMatch && tpMatch && slMatch) {
    const reason = `Exact duplicate: open ${side} position exists with same entry=${existingEntry}, TP=${existingTP}, SL=${existingSL}`;
    await logExecutorInfo(`⚠️ Duplicate ${side} ${signal.symbol}: same entry=${existingEntry}, TP=${existingTP}, SL=${existingSL} — skipping`, { accountId, processId, symbol: signal.symbol, action: "console_duplicate_exact" });
    await logProcessStep({ accountId, processId, type: "draft_process", action: "execution_skipped_duplicate", symbol: signal.symbol, details: reason, result: "skipped" });
    return { type: "skipped", code: "duplicate_exact", reason };
  }

  if (!entryMatch) return null;
  let updated = false;
  const updates: string[] = [];
  if (!tpMatch && newTP !== null) {
    existingPos.takeProfitTargets = buildTPTargets([newTP], existingPos.quantity);
    updates.push(`TP: ${existingTP} → ${newTP}`);
    updated = true;
  }
  if (!slMatch && newSL !== null) {
    existingPos.stopLossPrice = newSL;
    updates.push(`SL: ${existingSL} → ${newSL}`);
    updated = true;
  }
  if (updated) {
    await existingPos.save();
    await logExecutorInfo(`🔄 Updated ${side} ${signal.symbol} TP/SL: ${updates.join(", ")}`, { accountId, processId, symbol: signal.symbol, action: "console_duplicate_updated" });
    await logProcessStep({ accountId, processId, type: "draft_process", action: "execution_updated_tp_sl", symbol: signal.symbol, details: `Existing position TP/SL updated instead of opening duplicate: ${updates.join(", ")}`, result: "updated" });
    return { type: "updated", code: "duplicate_updated", details: updates.join(", ") };
  }

  const reason = `Open ${side} position exists with same entry but no valid TP/SL update provided`;
  await logExecutorWarn(`⚠️ Duplicate ${side} ${signal.symbol}: entry matches but no new TP/SL values to update — skipping`, { accountId, processId, symbol: signal.symbol, action: "console_duplicate_no_update" });
  await logProcessStep({ accountId, processId, type: "draft_process", action: "execution_skipped_duplicate_no_update", symbol: signal.symbol, details: reason, result: "skipped" });
  return { type: "skipped", code: "duplicate_no_update", reason };
}
