import { buildTPTargets, IPosition, Position } from "../../database";
import { logExecutorInfo, logExecutorWarn } from "../../process/log";
import { splitQuantityForTPs } from "./split-quantity";
import {
  applyTradeRiskManagement,
  enforceExchangeMinimums,
  enforceTpCountFeasibility,
  resolveTradeExchange,
} from "./helpers";
import { resolveEffectiveRiskConfig } from "../../risk";
import type { ExecuteTradeInput } from "../types";

export async function executeTrade(
  input: ExecuteTradeInput,
): Promise<IPosition> {
  const {
    symbol,
    action,
    entryPrice,
    stopLoss,
    takeProfitTargets: tpTargets,
    leverage,
    quantity,
    orderType,
    channelId,
    messageId,
    sourceName,
    signalData,
    logPrefix = "",
    accountId,
    processId,
  } = input;

  const side = action === "SELL" ? ("SHORT" as const) : ("LONG" as const);
  const orderSide = action === "SELL" ? "SELL" : "BUY";
  const closeSide = orderSide === "BUY" ? "SELL" : "BUY";
  const lp = logPrefix ? `${logPrefix} ` : "";

  const runtime = {
    symbol,
    action,
    entryPrice,
    stopLoss,
    takeProfitTargets: tpTargets,
    leverage,
    quantity,
    orderType,
    channelId,
    messageId,
    sourceName,
    signalData,
    accountId,
    processId,
    side,
    logPrefix: lp,
  };

  const exchange = await resolveTradeExchange(runtime);
  const riskSizing = await applyTradeRiskManagement(exchange, runtime);
  const minOrderSizing = await enforceExchangeMinimums(exchange, runtime, riskSizing);
  const finalSizing = await enforceTpCountFeasibility(exchange, runtime, minOrderSizing);

  const effectiveRiskConfig = await resolveEffectiveRiskConfig({
    accountId: runtime.accountId,
    channelId: runtime.channelId,
  });

  await logExecutorInfo(
    `${lp}🔄 Placing ${orderType} ${action} order: symbol=${symbol}, qty=${finalSizing.orderQuantity}, leverage=${finalSizing.orderLeverage}${orderType === "LIMIT" ? `, price=${entryPrice}` : ""}`,
    { accountId, processId, symbol, action: "console_place_order" },
  );

  const orderResult = await exchange.placeOrder({
    symbol,
    side: orderSide,
    type: orderType,
    quantity: finalSizing.orderQuantity,
    price: orderType === "LIMIT" ? entryPrice : undefined,
    leverage: finalSizing.orderLeverage,
  });

  await logExecutorInfo(
    `${lp}✅ Order placed: orderId=${orderResult.orderId}, price=${orderResult.price}, qty=${orderResult.quantity}`,
    { accountId, processId, symbol, action: "console_order_placed" },
  );

  const filledQty = orderResult.quantity || finalSizing.orderQuantity;
  const effectiveEntryPrice = entryPrice || orderResult.price || 0;
  const estimatedMarginUsdt =
    finalSizing.orderLeverage > 0 && effectiveEntryPrice > 0
      ? (filledQty * effectiveEntryPrice) / finalSizing.orderLeverage
      : undefined;

  await placeProtectionOrders({
    exchange,
    orderType,
    symbol,
    tpTargets,
    filledQty,
    stopLoss,
    closeSide,
    accountId,
    processId,
    logPrefix: lp,
    tpCloseMode: effectiveRiskConfig.tpCloseMode || "equal",
  });

  const tpTargetObjects = buildTPTargets(tpTargets, filledQty, effectiveRiskConfig.tpCloseMode || "equal");
  const positionStatus = orderType === "LIMIT" ? "pending" : "open";

  await logExecutorInfo(
    `${lp}💾 Saving position to database (status: ${positionStatus})...`,
    { accountId, processId, symbol, action: "console_save_position" },
  );

  const position = await Position.create({
    accountId: accountId || undefined,
    processId: processId || undefined,
    symbol,
    side,
    entryPrice: effectiveEntryPrice,
    quantity: filledQty,
    leverage: finalSizing.orderLeverage,
    marginType: "isolated",
    margin: finalSizing.plannedMarginUsdt ?? estimatedMarginUsdt,
    takeProfitTargets: tpTargetObjects,
    stopLossPrice: stopLoss || undefined,
    orderId: orderResult.orderId,
    status: positionStatus,
    tpSlPlaced: orderType !== "LIMIT",
    channelId: channelId || undefined,
    sourceName: sourceName || undefined,
    messageId: messageId || undefined,
    signalData,
  });

  await logExecutorInfo(
    `${lp}✅ ${orderType === "LIMIT" ? "Placed limit order for" : "Opened"} ${side} position: ${symbol} @ ${entryPrice || "market"} (status: ${positionStatus})`,
    { accountId, processId, symbol, action: "console_position_saved" },
  );

  return position;
}

async function placeProtectionOrders({
  exchange,
  orderType,
  symbol,
  tpTargets,
  filledQty,
  stopLoss,
  closeSide,
  accountId,
  processId,
  logPrefix,
  tpCloseMode,
}: {
  exchange: {
    getInstrumentSpecs(symbol: string): Promise<{ lotSz: number; qtyDecimals: number }>;
    placeTakeProfit(symbol: string, triggerPrice: number, orderPrice: number, side: string, quantity: number): Promise<string>;
    placeStopLoss(symbol: string, triggerPrice: number, orderPrice: number, side: string, quantity: number): Promise<string>;
  };
  orderType: string;
  symbol: string;
  tpTargets: number[];
  filledQty: number;
  stopLoss?: number | null;
  closeSide: string;
  accountId?: string;
  processId?: string;
  logPrefix: string;
  tpCloseMode: "equal" | "halving";
}) {
  if (orderType === "LIMIT") {
    await logExecutorInfo(
      `${logPrefix}⏳ LIMIT order — skipping TP/SL placement. Will be placed by tp-sl-monitor after order fills.`,
      { accountId, processId, symbol, action: "console_limit_skip_tp_sl" },
    );
    return;
  }

  const tpQuantities = await splitQuantityForTPs(filledQty, tpTargets.length, () =>
    exchange.getInstrumentSpecs(symbol),
    tpCloseMode
  );

  for (let index = 0; index < tpTargets.length; index++) {
    const tp = tpTargets[index];
    const tpQty = tpQuantities[index];
    try {
      const tpId = await exchange.placeTakeProfit(symbol, tp, tp, closeSide, tpQty);
      await logExecutorInfo(
        `${logPrefix}🎯 Take Profit ${index + 1}/${tpTargets.length} set at ${tp} (qty: ${tpQty}/${filledQty}, plan order ${tpId})`,
        { accountId, processId, symbol, action: "console_take_profit_set" },
      );
    } catch (tpErr) {
      await logExecutorWarn(
        `${logPrefix}⚠️ Failed to place TP at ${tp}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
        { accountId, processId, symbol, action: "console_take_profit_failed" },
      );
    }
  }

  if (!stopLoss) return;
  try {
    const slId = await exchange.placeStopLoss(symbol, stopLoss, stopLoss, closeSide, filledQty);
    await logExecutorInfo(
      `${logPrefix}🛑 Stop Loss set at ${stopLoss} (plan order ${slId})`,
      { accountId, processId, symbol, action: "console_stop_loss_set" },
    );
  } catch (slErr) {
    await logExecutorWarn(
      `${logPrefix}⚠️ Failed to place SL: ${slErr instanceof Error ? slErr.message : String(slErr)}`,
      { accountId, processId, symbol, action: "console_stop_loss_failed" },
    );
  }
}
