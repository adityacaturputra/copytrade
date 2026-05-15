import type {
  HistoricalOrder,
  OpenOrderInfo,
  PositionInfo,
} from "../types";
import type { MetaTraderOrderRow, MetaTraderPositionRow } from "./types";
import {
  normalizeMetaTraderOrderSide,
  normalizeMetaTraderSide,
  normalizeMetaTraderStatus,
  normalizeMetaTraderSymbol,
  parseMetaTraderNumber,
  parseMetaTraderTimestamp,
} from "./utils";

export function mapMetaTraderPosition(row: MetaTraderPositionRow): PositionInfo {
  const symbol = normalizeMetaTraderSymbol(String(row.symbol || ""));
  const side = normalizeMetaTraderSide(row.side ?? row.type);
  const quantity =
    parseMetaTraderNumber(row.quantity) ||
    parseMetaTraderNumber(row.volume) ||
    parseMetaTraderNumber(row.lots);
  const entryPrice = parseMetaTraderNumber(row.openPrice) || parseMetaTraderNumber(row.priceOpen);
  const currentPrice = parseMetaTraderNumber(row.currentPrice) || parseMetaTraderNumber(row.priceCurrent);
  const pnl = parseMetaTraderNumber(row.pnl) || parseMetaTraderNumber(row.profit);
  const margin = parseMetaTraderNumber(row.margin);
  const leverage = Math.max(1, parseMetaTraderNumber(row.leverage, 1));

  return {
    symbol,
    positionId: String(row.positionId || row.ticket || row.id || symbol),
    side,
    leverage,
    marginType: "cross",
    entryPrice,
    quantity,
    margin,
    unrealizedPnl: pnl,
    liquidationPrice: 0,
    markPrice: currentPrice || entryPrice,
    raw: row,
  };
}

export function mapMetaTraderOpenOrder(row: MetaTraderOrderRow): OpenOrderInfo {
  return {
    orderId: String(row.orderId || row.ticket || row.id || ""),
    symbol: normalizeMetaTraderSymbol(String(row.symbol || "")),
    side: normalizeMetaTraderOrderSide(row.side ?? row.type),
    type: normalizeMetaTraderStatus(row.orderType ?? row.type, "pending"),
    price: parseMetaTraderNumber(row.price) || parseMetaTraderNumber(row.openPrice) || undefined,
    quantity:
      parseMetaTraderNumber(row.quantity) ||
      parseMetaTraderNumber(row.volume) ||
      parseMetaTraderNumber(row.lots),
    filledQuantity:
      parseMetaTraderNumber(row.filledQuantity) ||
      parseMetaTraderNumber(row.executedQty),
    status: normalizeMetaTraderStatus(row.status ?? row.state, "open"),
    createdAt: parseMetaTraderTimestamp(row.createdAt ?? row.time),
    raw: row,
  };
}

export function mapMetaTraderHistoricalOrder(row: MetaTraderOrderRow): HistoricalOrder {
  const quantity =
    parseMetaTraderNumber(row.quantity) ||
    parseMetaTraderNumber(row.volume) ||
    parseMetaTraderNumber(row.lots);
  return {
    orderId: String(row.orderId || row.ticket || row.id || ""),
    symbol: normalizeMetaTraderSymbol(String(row.symbol || "")),
    side: normalizeMetaTraderOrderSide(row.side ?? row.type),
    type: normalizeMetaTraderStatus(row.orderType ?? row.type, "unknown"),
    price: parseMetaTraderNumber(row.price) || parseMetaTraderNumber(row.openPrice),
    quantity,
    filledQuantity:
      parseMetaTraderNumber(row.filledQuantity) ||
      parseMetaTraderNumber(row.executedQty) ||
      quantity,
    fee: parseMetaTraderNumber(row.fee) || parseMetaTraderNumber(row.commission),
    realizedPnl: parseMetaTraderNumber(row.pnl) || parseMetaTraderNumber(row.profit),
    status: normalizeMetaTraderStatus(row.status ?? row.state, "closed"),
    createdAt: parseMetaTraderTimestamp(row.createdAt ?? row.time) || Date.now(),
    updatedAt: parseMetaTraderTimestamp(row.createdAt ?? row.time),
    raw: row,
  };
}
