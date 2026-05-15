import type { OrderParams, OrderResult, OpenOrderInfo, AlgoOrderInfo, HistoricalOrder } from "../../types";
import { OkxCtx } from "./types";

export async function placeOkxOrder(ctx: OkxCtx, params: OrderParams): Promise<OrderResult> {
  const instId = ctx.toOkxSymbol(params.symbol);
  const mode = await ctx.getPositionMode();
  const specs = await ctx.getInstrumentSpecs(params.symbol);
  
  const payload: any = {
    instId,
    tdMode: "cross",
    side: params.side.toLowerCase(),
    ordType: params.type.toLowerCase(),
    sz: String(params.quantity),
  };

  if (params.type === "LIMIT") {
    payload.px = String(params.price);
  }
  
  if (mode === "long_short_mode") {
    payload.posSide = params.side === "BUY" ? "long" : "short";
  }

  const path = "/api/v5/trade/order";
  const body = JSON.stringify(payload);
  const headers = ctx.authHeaders("POST", path, body);
  const resp = await ctx.client.post(path, body, { headers });
  
  if (resp.data.code !== "0") throw new Error(`OKX Order error: ${resp.data.msg}`);
  return {
    orderId: resp.data.data[0].ordId,
    price: params.price || 0,
    quantity: params.quantity,
    status: "submitted",
    raw: resp.data,
  };
}

export async function getOkxOpenOrders(ctx: OkxCtx, symbol?: string): Promise<OpenOrderInfo[]> {
  const instId = symbol ? ctx.toOkxSymbol(symbol) : "";
  const path = `/api/v5/trade/orders-pending?instType=SWAP${instId ? "&instId=" + instId : ""}`;
  const headers = ctx.authHeaders("GET", path);
  const resp = await ctx.client.get(path, { headers });
  if (resp.data.code !== "0") throw new Error(`OKX Open Orders error: ${resp.data.msg}`);
  return (resp.data.data || []).map((row: any) => ({
    orderId: row.ordId,
    symbol: ctx.fromOkxSymbol(row.instId),
    side: row.side === "buy" ? "BUY" : "SELL",
    type: row.ordType.toUpperCase(),
    price: parseFloat(row.px || "0"),
    quantity: parseFloat(row.sz || "0"),
    filledQuantity: parseFloat(row.accFillSz || "0"),
    status: row.state,
    createdAt: parseInt(row.cTime),
    raw: row,
  }));
}

export async function cancelOkxOrder(ctx: OkxCtx, orderId: string, symbol: string): Promise<boolean> {
  const instId = ctx.toOkxSymbol(symbol);
  const path = "/api/v5/trade/cancel-order";
  const body = JSON.stringify({ instId, ordId: orderId });
  const headers = ctx.authHeaders("POST", path, body);
  const resp = await ctx.client.post(path, body, { headers });
  return resp.data.code === "0";
}

export async function getOkxAlgoOrders(ctx: OkxCtx, symbol?: string): Promise<AlgoOrderInfo[]> {
  const instId = symbol ? ctx.toOkxSymbol(symbol) : "";
  const path = `/api/v5/trade/orders-algo-pending?instType=SWAP&algoOrderType=conditional${instId ? "&instId=" + instId : ""}`;
  const headers = ctx.authHeaders("GET", path);
  const resp = await ctx.client.get(path, { headers });
  if (resp.data.code !== "0") throw new Error(`OKX Algo Orders error: ${resp.data.msg}`);
  return (resp.data.data || []).map((row: any) => ({
    orderId: row.algoId,
    symbol: ctx.fromOkxSymbol(row.instId),
    side: row.side === "buy" ? "BUY" : "SELL",
    type: "conditional",
    triggerPrice: parseFloat(row.tpTriggerPx || row.slTriggerPx || "0"),
    quantity: parseFloat(row.sz || "0"),
    status: "active",
    createdAt: parseInt(row.cTime),
    raw: row,
  }));
}

export async function cancelOkxAlgoOrders(ctx: OkxCtx, symbol: string): Promise<{ cancelled: string[]; errors: string[] }> {
  const instId = ctx.toOkxSymbol(symbol);
  const algos = await getOkxAlgoOrders(ctx, symbol);
  const cancelled: string[] = [];
  const errors: string[] = [];
  
  for (const algo of algos) {
    const path = "/api/v5/trade/cancel-algos";
    const body = JSON.stringify([{ instId, algoId: algo.orderId }]);
    const headers = ctx.authHeaders("POST", path, body);
    try {
      const resp = await ctx.client.post(path, body, { headers });
      if (resp.data.code === "0") cancelled.push(algo.orderId);
      else errors.push(`${algo.orderId}: ${resp.data.msg}`);
    } catch (e: any) { errors.push(`${algo.orderId}: ${e.message}`); }
  }
  return { cancelled, errors };
}

export async function getOkxOrderHistory(ctx: OkxCtx, symbol?: string, limit = 20): Promise<HistoricalOrder[]> {
  const instId = symbol ? ctx.toOkxSymbol(symbol) : "";
  const path = `/api/v5/trade/orders-history?instType=SWAP${instId ? "&instId=" + instId : ""}&limit=${limit}`;
  const headers = ctx.authHeaders("GET", path);
  const resp = await ctx.client.get(path, { headers });
  if (resp.data.code !== "0") throw new Error(`OKX Order History error: ${resp.data.msg}`);
  return (resp.data.data || []).map((row: any) => ({
    orderId: row.ordId,
    symbol: ctx.fromOkxSymbol(row.instId),
    side: row.side === "buy" ? "BUY" : "SELL",
    type: row.ordType.toUpperCase(),
    price: parseFloat(row.avgPx || row.px || "0"),
    quantity: parseFloat(row.sz || "0"),
    filledQuantity: parseFloat(row.accFillSz || "0"),
    fee: parseFloat(row.fee || "0"),
    status: row.state,
    createdAt: parseInt(row.cTime),
    updatedAt: parseInt(row.uTime),
    raw: row,
  }));
}
