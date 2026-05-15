import type { OrderParams, OrderResult, OpenOrderInfo, AlgoOrderInfo, HistoricalOrder } from "../../types";
import { BinanceCtx } from "./types";

export async function placeBinanceOrder(ctx: BinanceCtx, params: OrderParams): Promise<OrderResult> {
  const normalized = ctx.toSymbol(params.symbol);
  const specs = await ctx.getInstrumentSpecs(params.symbol);
  const rule = ctx.getQuantityRule(specs, params.type);
  const qty = ctx.clampToStep(params.quantity, rule.step, rule.decimals);

  const payload: any = {
    symbol: normalized,
    side: params.side,
    type: params.type,
    quantity: ctx.formatNum(qty, rule.decimals),
    newOrderRespType: "RESULT",
  };

  if (params.type === "LIMIT") {
    payload.price = ctx.formatNum(ctx.clampToStep(params.price || 0, specs.tickSz, specs.priceDecimals), specs.priceDecimals);
    payload.timeInForce = "GTC";
  }

  const result = await ctx.signedRequest<any>("POST", "/fapi/v1/order", payload);
  return {
    orderId: String(result.orderId),
    price: parseFloat(result.avgPrice || result.price || "0"),
    quantity: parseFloat(result.origQty || "0"),
    status: result.status,
    raw: result,
  };
}

export async function getBinanceOpenOrders(ctx: BinanceCtx, symbol?: string): Promise<OpenOrderInfo[]> {
  const normalized = symbol ? ctx.toSymbol(symbol) : undefined;
  const result = await ctx.signedRequest<any[]>("GET", "/fapi/v1/openOrders", { symbol: normalized });
  return result.map(row => ({
    orderId: String(row.orderId),
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    price: parseFloat(row.price || "0"),
    quantity: parseFloat(row.origQty || "0"),
    filledQuantity: parseFloat(row.executedQty || "0"),
    status: row.status,
    createdAt: row.time,
    raw: row,
  }));
}

export async function cancelBinanceOrder(ctx: BinanceCtx, orderId: string, symbol: string): Promise<boolean> {
  const result = await ctx.signedRequest<any>("DELETE", "/fapi/v1/order", { symbol: ctx.toSymbol(symbol), orderId });
  return result.status === "CANCELED";
}

export async function getBinanceAlgoOrders(ctx: BinanceCtx, symbol?: string): Promise<AlgoOrderInfo[]> {
  const normalized = symbol ? ctx.toSymbol(symbol) : undefined;
  const result = await ctx.signedRequest<any[]>("GET", "/fapi/v1/openOrders", { symbol: normalized });
  return result.filter(r => ["STOP_MARKET", "TAKE_PROFIT_MARKET", "STOP", "TAKE_PROFIT"].includes(r.type)).map(row => ({
    orderId: String(row.orderId),
    symbol: row.symbol,
    side: row.side,
    type: row.type.toLowerCase().includes("tp") ? "tp" : row.type.toLowerCase().includes("sl") ? "sl" : "conditional",
    triggerPrice: parseFloat(row.stopPrice || "0"),
    quantity: parseFloat(row.origQty || "0"),
    status: "active",
    createdAt: row.time,
    raw: row,
  }));
}

export async function cancelBinanceAlgoOrders(ctx: BinanceCtx, symbol: string): Promise<{ cancelled: string[]; errors: string[] }> {
  const normalized = ctx.toSymbol(symbol);
  try {
    await ctx.signedRequest("DELETE", "/fapi/v1/allOpenOrders", { symbol: normalized });
    return { cancelled: ["all"], errors: [] };
  } catch (e: any) {
    return { cancelled: [], errors: [e.message] };
  }
}

export async function getBinanceOrderHistory(ctx: BinanceCtx, symbol?: string, limit = 20): Promise<HistoricalOrder[]> {
  const normalized = symbol ? ctx.toSymbol(symbol) : undefined;
  const result = await ctx.signedRequest<any[]>("GET", "/fapi/v1/allOrders", { symbol: normalized, limit });
  return result.map(row => ({
    orderId: String(row.orderId),
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    price: parseFloat(row.avgPrice || row.price || "0"),
    quantity: parseFloat(row.origQty || "0"),
    filledQuantity: parseFloat(row.executedQty || "0"),
    fee: 0,
    status: row.status,
    createdAt: row.time,
    updatedAt: row.updateTime,
    raw: row,
  }));
}
