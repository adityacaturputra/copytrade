import type { AccountInfo } from "../../types";
import { BinanceCtx } from "./types";

export async function getBinanceAccountInfo(ctx: BinanceCtx): Promise<AccountInfo> {
  const result = await ctx.signedRequest<any>("GET", "/fapi/v2/account");
  return {
    totalBalance: parseFloat(result.totalWalletBalance || "0"),
    availableBalance: parseFloat(result.availableBalance || "0"),
    unrealizedPnl: parseFloat(result.totalUnrealizedProfit || "0"),
    currency: "USDT",
  };
}
