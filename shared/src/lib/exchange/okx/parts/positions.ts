import type { PositionInfo } from "../../types";
import { OkxCtx } from "./types";

export async function fetchOkxPositions(ctx: OkxCtx, symbol?: string): Promise<PositionInfo[]> {
  const path = "/api/v5/account/positions?instType=SWAP";
  const headers = ctx.authHeaders("GET", path);
  const resp = await ctx.client.get(path, { headers });
  if (resp.data.code !== "0") throw new Error(`OKX Positions error: ${resp.data.msg}`);
  
  return (resp.data.data || []).filter((row: any) => {
    if (symbol && ctx.fromOkxSymbol(row.instId) !== symbol) return false;
    return parseFloat(row.pos || "0") !== 0;
  }).map((row: any) => ({
    symbol: ctx.fromOkxSymbol(row.instId),
    positionId: row.posId,
    side: row.posSide === "short" ? "SHORT" : (row.posSide === "long" ? "LONG" : (parseFloat(row.pos) < 0 ? "SHORT" : "LONG")),
    leverage: parseFloat(row.lever || "1"),
    marginType: row.mgnMode as "isolated" | "cross",
    entryPrice: parseFloat(row.avgPx || "0"),
    quantity: Math.abs(parseFloat(row.pos || "0")),
    margin: parseFloat(row.margin || "0"),
    unrealizedPnl: parseFloat(row.upl || "0"),
    liquidationPrice: parseFloat(row.liqPx || "0"),
    markPrice: parseFloat(row.markPx || "0"),
    raw: row,
  }));
}

export async function closeOkxPosition(ctx: OkxCtx, symbol: string, positionId?: string, quantity?: number): Promise<void> {
  const instId = ctx.toOkxSymbol(symbol);
  const positions = await fetchOkxPositions(ctx, symbol);
  const pos = positionId ? positions.find(p => p.positionId === positionId) : positions[0];
  if (!pos) throw new Error(`No open OKX position found for ${symbol}`);

  const raw = pos.raw as any;
  const payload: any = {
    instId,
    mgnMode: pos.marginType,
    posSide: raw.posSide === "net" ? undefined : raw.posSide,
    autoCxl: true
  };

  const path = "/api/v5/trade/close-position";
  const body = JSON.stringify(payload);
  const headers = ctx.authHeaders("POST", path, body);
  const resp = await ctx.client.post(path, body, { headers });
  if (resp.data.code !== "0") throw new Error(`OKX Close Position error: ${resp.data.msg}`);
}

export async function placeOkxProtection(ctx: OkxCtx, type: "tp" | "sl", symbol: string, triggerPrice: number, executePrice: number, side: "BUY" | "SELL", quantity: number): Promise<string> {
  const instId = ctx.toOkxSymbol(symbol);
  const mode = await ctx.getPositionMode();
  const payload: any = {
    instId,
    tdMode: "cross",
    side: side.toLowerCase(),
    ordType: "conditional",
    sz: String(quantity),
    reduceOnly: "true",
  };
  
  if (type === "tp") {
    payload.tpTriggerPx = String(triggerPrice);
    payload.tpOrdPx = executePrice > 0 ? String(executePrice) : "-1";
  } else {
    payload.slTriggerPx = String(triggerPrice);
    payload.slOrdPx = executePrice > 0 ? String(executePrice) : "-1";
  }

  if (mode === "long_short_mode") {
    payload.posSide = side === "BUY" ? "short" : "long";
  }

  const path = "/api/v5/trade/order-algo";
  const body = JSON.stringify(payload);
  const headers = ctx.authHeaders("POST", path, body);
  const resp = await ctx.client.post(path, body, { headers });
  if (resp.data.code !== "0") throw new Error(`OKX Protection error: ${resp.data.msg}`);
  return resp.data.data[0].algoId;
}
