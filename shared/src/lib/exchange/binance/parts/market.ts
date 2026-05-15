import type { KlineData } from "../../types";
import { BinanceCtx, BinanceInstrumentSpecs } from "./types";

export async function getBinanceTickerPrice(ctx: BinanceCtx, symbol: string): Promise<number> {
  const result = await ctx.publicRequest<any>("/fapi/v1/ticker/price", { symbol: ctx.toSymbol(symbol) });
  return parseFloat(result.price || "0");
}

export async function getBinanceKlines(ctx: BinanceCtx, symbol: string, interval: string, limit: number): Promise<KlineData[]> {
  const result = await ctx.publicRequest<any[]>("/fapi/v1/klines", { symbol: ctx.toSymbol(symbol), interval, limit });
  return result.map(row => ({
    time: Math.floor(row[0] / 1000),
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
  }));
}

export async function getBinanceInstrumentSpecs(ctx: BinanceCtx, symbol: string): Promise<BinanceInstrumentSpecs> {
  const normalized = ctx.toSymbol(symbol);
  const cached = ctx.specsCache.get(normalized);
  if (cached && Date.now() - cached.ts < ctx.specsCacheTtl) return cached.specs;

  const result = await ctx.publicRequest<any>("/fapi/v1/exchangeInfo");
  const inst = result.symbols?.find((s: any) => s.symbol === normalized);
  if (!inst) throw new Error(`Binance symbol ${normalized} not found`);

  const priceFilter = inst.filters.find((f: any) => f.filterType === "PRICE_FILTER");
  const lotFilter = inst.filters.find((f: any) => f.filterType === "LOT_SIZE");
  const marketLotFilter = inst.filters.find((f: any) => f.filterType === "MARKET_LOT_SIZE") || lotFilter;

  const lotSz = parseFloat(lotFilter.stepSize);
  const marketLotSz = parseFloat(marketLotFilter.stepSize);
  const tickSz = parseFloat(priceFilter.tickSize);

  const specs: BinanceInstrumentSpecs = {
    ctVal: 1,
    lotSz,
    minSz: parseFloat(lotFilter.minQty),
    ctValCcy: inst.quoteAsset,
    tickSz,
    qtyDecimals: ctx.countDecimals(lotSz),
    priceDecimals: ctx.countDecimals(tickSz),
    marketLotSz,
    marketMinSz: parseFloat(marketLotFilter.minQty),
    marketQtyDecimals: ctx.countDecimals(marketLotSz),
  };

  ctx.specsCache.set(normalized, { specs, ts: Date.now() });
  return specs;
}
