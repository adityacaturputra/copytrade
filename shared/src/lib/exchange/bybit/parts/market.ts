import type { KlineData, InstrumentSpecs } from "../../types";
import { BybitCtx } from "./types";

export async function getBybitTickerPrice(ctx: BybitCtx, symbol: string): Promise<number> {
  const result = await ctx.signedRequest<any>("GET", "/v5/market/tickers", { category: "linear", symbol: ctx.toSymbol(symbol) });
  return ctx.parseNumber(result.list?.[0]?.lastPrice);
}

export async function getBybitKlines(ctx: BybitCtx, symbol: string, interval: string, limit: number): Promise<KlineData[]> {
  const result = await ctx.signedRequest<any>("GET", "/v5/market/kline", { category: "linear", symbol: ctx.toSymbol(symbol), interval, limit });
  return [...(result?.list || [])].reverse().map((row) => ({
    time: Math.floor(ctx.parseNumber(row[0]) / 1000),
    open: ctx.parseNumber(row[1]),
    high: ctx.parseNumber(row[2]),
    low: ctx.parseNumber(row[3]),
    close: ctx.parseNumber(row[4]),
    volume: ctx.parseNumber(row[5]),
  }));
}

export async function getBybitInstrumentSpecs(ctx: BybitCtx, symbol: string): Promise<InstrumentSpecs> {
  const normalized = ctx.toSymbol(symbol);
  const cached = ctx.specsCache.get(normalized);
  if (cached && Date.now() - cached.ts < ctx.specsCacheTtl) return cached.specs;
  const result = await ctx.publicRequest<any>("/v5/market/instruments-info", { category: "linear", symbol: normalized });
  const instrument = result?.list?.find((item: any) => item.symbol === normalized);
  if (!instrument) throw new Error(`Instrument not found on Bybit: ${normalized}`);
  const lotSz = ctx.parseNumber(instrument.lotSizeFilter?.qtyStep, 1);
  const tickSz = ctx.parseNumber(instrument.priceFilter?.tickSize, 0.01);
  const maxLeverage = ctx.parseNumber(instrument.leverageFilter?.maxLeverage);
  const specs = { ctVal: 1, lotSz, minSz: ctx.parseNumber(instrument.lotSizeFilter?.minOrderQty, lotSz), minNotional: ctx.parseNumber(instrument.lotSizeFilter?.minNotionalValue, 0), ctValCcy: instrument.baseCoin || normalized.replace(/USDT|USDC|USD$/, ""), tickSz, qtyDecimals: ctx.countDecimals(lotSz), priceDecimals: ctx.countDecimals(tickSz), maxLeverage: maxLeverage > 0 ? maxLeverage : undefined };
  ctx.specsCache.set(normalized, { specs, ts: Date.now() });
  return specs;
}
