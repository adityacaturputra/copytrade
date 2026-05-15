import { BinanceCtx } from "./types";

export async function setBinanceLeverage(ctx: BinanceCtx, symbol: string, leverage: number, marginType: "isolated" | "cross" = "isolated"): Promise<number> {
  const normalized = ctx.toSymbol(symbol);
  
  try {
    await ctx.signedRequest("POST", "/fapi/v1/marginType", { symbol: normalized, marginType: marginType.toUpperCase() });
  } catch (e: any) {
    if (!e.message.includes("-1106") && !e.message.includes("No need to change")) throw e;
  }

  const result = await ctx.signedRequest<any>("POST", "/fapi/v1/leverage", { symbol: normalized, leverage });
  return parseInt(result.leverage);
}
