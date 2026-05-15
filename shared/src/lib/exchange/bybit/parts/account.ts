import type { AccountInfo } from "../../types";
import { BybitCtx } from "./types";

export async function getBybitAccountInfo(ctx: BybitCtx): Promise<AccountInfo> {
  const result = await ctx.signedRequest<any>("GET", "/v5/account/wallet-balance", {
    accountType: "UNIFIED",
  });
  const wallet = result.list?.[0];
  return {
    totalBalance: ctx.parseNumber(wallet?.totalEquity ?? wallet?.totalWalletBalance),
    availableBalance: ctx.parseNumber(wallet?.totalAvailableBalance),
    unrealizedPnl: ctx.parseNumber(wallet?.totalPerpUPL),
    currency: "USDT",
  };
}

export async function getBybitAccountMarginMode(
  ctx: BybitCtx,
): Promise<"isolated" | "cross"> {
  const result = await ctx.signedRequest<any>("GET", "/v5/account/info");
  return result?.marginMode === "ISOLATED_MARGIN" ? "isolated" : "cross";
}
