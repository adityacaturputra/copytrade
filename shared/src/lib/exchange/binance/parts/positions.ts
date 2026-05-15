import type { PositionInfo } from "../../types";
import { BinanceCtx } from "./types";

export async function fetchBinancePositions(ctx: BinanceCtx): Promise<PositionInfo[]> {
  const result = await ctx.signedRequest<any[]>("GET", "/fapi/v2/positionRisk");
  return result.filter(r => Math.abs(parseFloat(r.positionAmt)) > 0).map(row => ({
    symbol: row.symbol,
    positionId: `${row.symbol}:${row.positionSide || "BOTH"}`,
    side: parseFloat(row.positionAmt) > 0 ? "LONG" : "SHORT",
    leverage: parseFloat(row.leverage),
    marginType: row.isolated ? "isolated" : "cross",
    entryPrice: parseFloat(row.entryPrice),
    quantity: Math.abs(parseFloat(row.positionAmt)),
    margin: parseFloat(row.isolatedWallet || "0"),
    unrealizedPnl: parseFloat(row.unRealizedProfit),
    liquidationPrice: parseFloat(row.liquidationPrice),
    markPrice: parseFloat(row.markPrice),
    raw: row,
  }));
}

export async function closeBinancePosition(ctx: BinanceCtx, symbol: string, positionId?: string, quantity?: number): Promise<void> {
  const normalized = ctx.toSymbol(symbol);
  const specs = await ctx.getInstrumentSpecs(symbol);
  const risks = await ctx.signedRequest<any[]>("GET", "/fapi/v2/positionRisk", { symbol: normalized });
  
  let rows = risks.filter(r => Math.abs(parseFloat(r.positionAmt)) > 0);
  if (positionId?.includes(":")) {
    rows = rows.filter(r => (r.positionSide || "BOTH") === positionId.split(":")[1]);
  }

  for (const row of rows) {
    const amt = Math.abs(parseFloat(row.positionAmt));
    const closeQtyRaw = quantity ? Math.min(quantity, amt) : amt;
    const rule = ctx.getQuantityRule(specs, "MARKET");
    const closeQty = ctx.clampToStep(closeQtyRaw, rule.step, rule.decimals);
    if (closeQty <= 0) continue;

    const params: any = {
      symbol: normalized,
      side: parseFloat(row.positionAmt) > 0 ? "SELL" : "BUY",
      type: "MARKET",
      quantity: ctx.formatNum(closeQty, rule.decimals),
      reduceOnly: true,
    };
    if (row.positionSide && row.positionSide !== "BOTH") params.positionSide = row.positionSide;
    await ctx.signedRequest("POST", "/fapi/v1/order", params);
  }
}

export async function placeBinanceConditionalAlgoOrder(ctx: BinanceCtx, symbol: string, side: "BUY" | "SELL", type: string, triggerPrice: number, quantity: number): Promise<string> {
  const normalized = ctx.toSymbol(symbol);
  const specs = await ctx.getInstrumentSpecs(symbol);
  const rule = ctx.getQuantityRule(specs, type);
  const qty = ctx.clampToStep(quantity, rule.step, rule.decimals);
  const px = ctx.clampToStep(triggerPrice, specs.tickSz, specs.priceDecimals);

  const params: any = {
    symbol: normalized,
    side,
    type,
    stopPrice: ctx.formatNum(px, specs.priceDecimals),
    quantity: ctx.formatNum(qty, rule.decimals),
    reduceOnly: true,
  };
  const result = await ctx.signedRequest<any>("POST", "/fapi/v1/order", params);
  return String(result.orderId);
}
