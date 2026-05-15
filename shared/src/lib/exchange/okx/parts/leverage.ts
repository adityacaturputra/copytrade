import { OkxCtx } from "./types";

export async function setOkxLeverage(ctx: OkxCtx, symbol: string, leverage: number, marginType: "isolated" | "cross" = "isolated"): Promise<number> {
  const instId = ctx.toOkxSymbol(symbol);
  const path = "/api/v5/account/set-leverage";
  const body = JSON.stringify({ instId, lever: String(leverage), mgnMode: marginType });
  const headers = ctx.authHeaders("POST", path, body);
  const resp = await ctx.client.post(path, body, { headers });
  if (resp.data.code !== "0" && !resp.data.msg?.includes("no change")) {
    throw new Error(`OKX set leverage error: ${resp.data.msg}`);
  }
  return leverage;
}
