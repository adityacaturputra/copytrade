import type { KlineData, InstrumentSpecs } from "../../types";
import { OkxCtx } from "./types";

export async function getOkxTickerPrice(ctx: OkxCtx, symbol: string): Promise<number> {
  const instId = ctx.toOkxSymbol(symbol);
  const path = `/api/v5/market/ticker?instId=${instId}`;
  const resp = await ctx.client.get(path);
  if (resp.data.code !== "0") throw new Error(`OKX Ticker error: ${resp.data.msg}`);
  return parseFloat(resp.data.data?.[0]?.last || "0");
}

export async function getOkxKlines(ctx: OkxCtx, symbol: string, interval: string, limit: number): Promise<KlineData[]> {
  const instId = ctx.toOkxSymbol(symbol);
  const path = `/api/v5/market/candles?instId=${instId}&bar=${interval}&limit=${limit}`;
  const resp = await ctx.client.get(path);
  if (resp.data.code !== "0") throw new Error(`OKX Klines error: ${resp.data.msg}`);
  return (resp.data.data || []).map((row: string[]) => ({
    time: Math.floor(parseInt(row[0]) / 1000),
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
  })).reverse();
}

export async function getOkxInstrumentSpecs(ctx: OkxCtx, symbol: string): Promise<InstrumentSpecs> {
  const instId = ctx.toOkxSymbol(symbol);
  const cached = ctx.specsCache.get(instId);
  if (cached && Date.now() - cached.ts < ctx.specsCacheTtl) return cached.specs;

  const path = `/api/v5/public/instruments?instType=SWAP&instId=${instId}`;
  const resp = await ctx.client.get(path);
  if (resp.data.code !== "0") throw new Error(`OKX Specs error: ${resp.data.msg}`);
  const inst = resp.data.data?.[0];
  if (!inst) throw new Error(`Instrument ${instId} not found on OKX`);

  const specs: InstrumentSpecs = {
    ctVal: parseFloat(inst.ctVal || "1"),
    lotSz: parseFloat(inst.lotSz || "1"),
    minSz: parseFloat(inst.minSz || "1"),
    ctValCcy: inst.ctValCcy || "",
    tickSz: parseFloat(inst.tickSz || "0.01"),
    qtyDecimals: inst.lotSz?.includes(".") ? inst.lotSz.split(".")[1].length : 0,
    priceDecimals: inst.tickSz?.includes(".") ? inst.tickSz.split(".")[1].length : 0,
  };
  ctx.specsCache.set(instId, { specs, ts: Date.now() });
  return specs;
}
