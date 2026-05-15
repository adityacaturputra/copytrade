import { BybitCtx } from "./types";

export async function setBybitLeverage(ctx: BybitCtx, symbol: string, leverage: number, marginType: "isolated" | "cross"): Promise<number> {
  const normalized = ctx.toSymbol(symbol);
  const requested = Math.max(1, Math.floor(leverage));
  try {
    await ctx.ensureMarginMode(normalized, requested, marginType);
    await ctx.signedRequest("POST", "/v5/position/set-leverage", { category: "linear", symbol: normalized, buyLeverage: String(requested), sellLeverage: String(requested) });
    return requested;
  } catch (error: any) {
    if (error.message.toLowerCase().includes("not modified")) return requested;
    throw error;
  }
}
