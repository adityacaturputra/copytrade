import type { OrderParams, OrderResult, OpenOrderInfo, AlgoOrderInfo, HistoricalOrder } from "../../types";
import { BybitCtx } from "./types";

export async function placeBybitOrder(ctx: BybitCtx, orderParams: OrderParams): Promise<OrderResult> {
  const symbol = ctx.toSymbol(orderParams.symbol);
  if (orderParams.leverage) await ctx.setLeverage(symbol, orderParams.leverage);
  const specs = await ctx.getInstrumentSpecs(symbol);
  const qty = ctx.clampToStep(orderParams.quantity, specs.lotSz, specs.qtyDecimals);
  if (qty < specs.minSz) throw new Error(`Order quantity too small for ${symbol}: requested=${orderParams.quantity} -> rounded=${qty} < min=${specs.minSz}`);
  const payload: any = { category: "linear", symbol, side: orderParams.side === "BUY" ? "Buy" : "Sell", orderType: orderParams.type === "LIMIT" ? "Limit" : "Market", qty: ctx.formatNum(qty, specs.qtyDecimals) };
  if (orderParams.type === "LIMIT") {
    if (!orderParams.price || orderParams.price <= 0) throw new Error("LIMIT order requires a valid price");
    payload.price = ctx.formatNum(ctx.clampToStep(orderParams.price, specs.tickSz, specs.priceDecimals), specs.priceDecimals);
    payload.timeInForce = "GTC";
  }
  const result = await ctx.signedRequest<any>("POST", "/v5/order/create", payload);
  const orderId = result.orderId || result.orderLinkId;
  if (!orderId) throw new Error("[Bybit] Order accepted but no orderId returned");
  return { orderId, price: orderParams.price || (orderParams.type === "MARKET" ? await ctx.getTickerPrice(symbol) : 0), quantity: qty, status: "submitted", raw: result };
}

export async function cancelBybitOrder(ctx: BybitCtx, orderId: string, symbol: string): Promise<boolean> {
  try {
    await ctx.signedRequest("POST", "/v5/order/cancel", { category: "linear", symbol: ctx.toSymbol(symbol), orderId });
    return true;
  } catch (e: any) {
    if (e.message.toLowerCase().includes("not found") || e.message.toLowerCase().includes("already cancelled")) return true;
    throw e;
  }
}

export async function getBybitOpenOrders(ctx: BybitCtx, symbol?: string): Promise<OpenOrderInfo[]> {
  const normalized = symbol ? ctx.toSymbol(symbol) : undefined;
  const result = await ctx.signedRequest<any>("GET", "/v5/order/realtime", { category: "linear", symbol: normalized, settleCoin: "USDT" });
  return (result?.list || []).map((row: any) => ({
    orderId: String(row.orderId || ""),
    symbol: String(row.symbol || ""),
    side: row.side === "Buy" ? "BUY" : "SELL",
    type: String(row.orderType || "unknown"),
    price: ctx.parseNumber(row.price),
    quantity: ctx.parseNumber(row.qty),
    filledQuantity: ctx.parseNumber(row.cumExecQty),
    status: String(row.orderStatus || "unknown"),
    createdAt: ctx.parseNumber(row.createdTime),
    raw: row,
  }));
}

export async function getBybitAlgoOrders(ctx: BybitCtx, symbol?: string): Promise<AlgoOrderInfo[]> {
  const normalized = symbol ? ctx.toSymbol(symbol) : undefined;
  const algoOrders: AlgoOrderInfo[] = [];
  const stopOrders = await ctx.fetchRealtimeOrders("StopOrder", normalized);
  for (const row of stopOrders) {
    algoOrders.push({
      orderId: String(row.orderId || ""),
      symbol: String(row.symbol || ""),
      side: row.side === "Buy" ? "BUY" : "SELL",
      type: row.stopOrderType?.toLowerCase().includes("tp") ? "tp" : row.stopOrderType?.toLowerCase().includes("sl") ? "sl" : "conditional",
      triggerPrice: ctx.parseNumber(row.triggerPrice),
      quantity: ctx.parseNumber(row.qty),
      status: "active",
      createdAt: ctx.parseNumber(row.createdTime),
      raw: row,
    });
  }
  const positions = (await ctx.fetchPositions(normalized)).filter((row: any) => row.symbol && (row.side === "Buy" || row.side === "Sell") && ctx.parseNumber(row.size) > 0);
  for (const position of positions) {
    const tp = ctx.parseNumber(position.takeProfit);
    const sl = ctx.parseNumber(position.stopLoss);
    const side = position.side === "Buy" ? "BUY" : "SELL";
    const qty = ctx.parseNumber(position.size);
    const positionIdx = position.positionIdx ?? 0;
    if (tp > 0) {
      algoOrders.push({ orderId: `position-tp:${position.symbol}:${positionIdx}`, symbol: position.symbol, side, type: "tp", triggerPrice: tp, quantity: qty, status: "active", createdAt: ctx.parseNumber(position.updatedTime) || undefined, raw: position });
    }
    if (sl > 0) {
      algoOrders.push({ orderId: `position-sl:${position.symbol}:${positionIdx}`, symbol: position.symbol, side, type: "sl", triggerPrice: sl, quantity: qty, status: "active", createdAt: ctx.parseNumber(position.updatedTime) || undefined, raw: position });
    }
  }
  return algoOrders;
}

export async function cancelBybitAlgoOrders(ctx: BybitCtx, symbol: string): Promise<{ cancelled: string[]; errors: string[] }> {
  const normalized = ctx.toSymbol(symbol);
  const cancelled: string[] = [];
  const errors: string[] = [];
  const stopOrders = await ctx.fetchRealtimeOrders("StopOrder", normalized);
  for (const order of stopOrders) {
    if (!order.orderId || !order.symbol) continue;
    try {
      if (await ctx.cancelOrder(order.orderId, order.symbol)) cancelled.push(order.orderId);
      else errors.push(`${order.orderId}: Unknown order`);
    } catch (e: any) { errors.push(`${order.orderId}: ${e.message}`); }
  }
  const positions = (await ctx.fetchPositions(normalized)).filter((row: any) => row.symbol === normalized && (row.side === "Buy" || row.side === "Sell") && ctx.parseNumber(row.size) > 0);
  for (const position of positions) {
    if (ctx.parseNumber(position.takeProfit) <= 0 && ctx.parseNumber(position.stopLoss) <= 0) continue;
    try {
      await ctx.clearTradingStopsForPosition(normalized, position.positionIdx ?? 0);
      if (ctx.parseNumber(position.takeProfit) > 0) cancelled.push(`position-tp:${normalized}:${position.positionIdx ?? 0}`);
      if (ctx.parseNumber(position.stopLoss) > 0) cancelled.push(`position-sl:${normalized}:${position.positionIdx ?? 0}`);
    } catch (e: any) { errors.push(`position:${position.positionIdx ?? 0}: ${e.message}`); }
  }
  return { cancelled, errors };
}

export async function getBybitOrderHistory(ctx: BybitCtx, symbol?: string, limit: number = 20): Promise<HistoricalOrder[]> {
  const normalized = symbol ? ctx.toSymbol(symbol) : undefined;
  const result = await ctx.signedRequest<any>("GET", "/v5/order/history", { category: "linear", settleCoin: "USDT", symbol: normalized, limit: Math.max(1, Math.min(limit, 50)) });
  return (result?.list || []).map((row: any) => ({
    orderId: String(row.orderId || ""),
    symbol: String(row.symbol || ""),
    side: row.side === "Buy" ? "BUY" : "SELL",
    type: String(row.orderType || "unknown"),
    price: ctx.parseNumber(row.avgPrice) || ctx.parseNumber(row.price),
    quantity: ctx.parseNumber(row.qty),
    filledQuantity: ctx.parseNumber(row.cumExecQty),
    fee: ctx.parseNumber(row.cumExecFee),
    realizedPnl: ctx.parseNumber(row.closedPnl) || undefined,
    status: String(row.orderStatus || "unknown"),
    createdAt: ctx.parseNumber(row.createdTime),
    updatedAt: ctx.parseNumber(row.updatedTime) || undefined,
    raw: row,
  }));
}
