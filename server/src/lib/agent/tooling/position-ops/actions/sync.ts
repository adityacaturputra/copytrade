import { Position } from "@copytrade/shared/lib/database/index";
import { ensurePersistedProcessId } from "@copytrade/shared/lib/process/id";
import { logProcessStep } from "@copytrade/shared/lib/process/log";
import { findPositionRecord, getLivePositionSnapshot } from "../../shared";

export async function syncPositionWithExchange(args: Record<string, unknown>) {
  const position = await findPositionRecord(args);
  const positionDoc = await Position.findById(String(position._id)).exec();
  if (!positionDoc) throw new Error(`Position document not found: ${String(position._id)}`);
  const processId = await ensurePersistedProcessId(positionDoc, "agentsync");
  const { exchange, currentPrice, pnlPercent, exchangePosition } = await getLivePositionSnapshot(position);
  const openOrders = await exchange.getOpenOrders(position.symbol);
  const algoOrders = await exchange.getAlgoOrders(position.symbol);
  positionDoc.currentPrice = currentPrice;
  positionDoc.pnl = pnlPercent;
  let syncedStatus: "open" | "closed" = "open";
  let syncReason = "Position remains open on exchange";
  if (exchangePosition) {
    positionDoc.quantity = exchangePosition.quantity;
    if (positionDoc.status !== "open") {
      positionDoc.status = "open";
      positionDoc.closedAt = undefined;
      positionDoc.closeReason = undefined;
    }
  } else {
    syncedStatus = "closed";
    syncReason = "Position not found on exchange during agent sync";
    positionDoc.status = "closed";
    positionDoc.closedAt = new Date();
    positionDoc.closeReason = syncReason;
  }
  await positionDoc.save();
  const response = { success: true, processId, positionId: String(position._id), accountId: position.accountId || null, symbol: position.symbol, syncedStatus, syncReason, databaseSnapshot: { currentPrice: positionDoc.currentPrice, pnl: positionDoc.pnl, quantity: positionDoc.quantity, status: positionDoc.status, stopLossPrice: positionDoc.stopLossPrice, takeProfitTargets: positionDoc.takeProfitTargets }, exchangeSnapshot: exchangePosition ? { symbol: exchangePosition.symbol, side: exchangePosition.side, entryPrice: exchangePosition.entryPrice, quantity: exchangePosition.quantity, leverage: exchangePosition.leverage, markPrice: exchangePosition.markPrice, unrealizedPnl: exchangePosition.unrealizedPnl, liquidationPrice: exchangePosition.liquidationPrice } : null, openOrders, algoOrders };
  await logProcessStep({ accountId: position.accountId, processId, type: "agent_tool", action: "sync_position_with_exchange", symbol: position.symbol, details: response, result: "success" });
  return JSON.stringify(response);
}
