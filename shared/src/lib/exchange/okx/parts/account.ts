import type { AccountInfo } from "../../types";
import { OkxCtx } from "./types";

export async function getOkxAccountInfo(ctx: OkxCtx): Promise<AccountInfo> {
  const path = "/api/v5/account/balance";
  const headers = ctx.authHeaders("GET", path);
  const resp = await ctx.client.get(path, { headers });
  
  if (resp.data.code !== "0") throw new Error(`OKX Account Info error: ${resp.data.msg}`);
  const data = resp.data.data?.[0];
  return {
    totalBalance: parseFloat(data?.totalEq || "0"),
    availableBalance: parseFloat(data?.availEq || "0"),
    unrealizedPnl: parseFloat(data?.totalPnl || "0"),
    currency: "USDT",
  };
}
