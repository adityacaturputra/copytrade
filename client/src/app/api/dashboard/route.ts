import { NextRequest, NextResponse } from "next/server";
import {
  connectDB,
  getStats,
  getOpenPositions,
  getPendingDrafts,
  getTradingMode,
  Position,
  Account,
} from "@copytrade/shared/lib/database/index";
import { getRiskConfig } from "@copytrade/shared/lib/risk/index";
import { getSignalConfig } from "@copytrade/shared/lib/signal/config";

export const dynamic = "force-dynamic";

interface AccountExchangeInfo {
  accountId: string;
  accountName: string;
  sourceType: string;
  tradingPlatform: string;
  isDemo: boolean;
  channelIds: string[];
  account: {
    totalBalance: number;
    availableBalance: number;
    unrealizedPnl: number;
    currency: string;
  } | null;
  exchangeError: string | null;
}

export async function GET() {
  try {
    await connectDB();

    // Fetch all active accounts
    const accounts = await Account.find({ isActive: true })
      .sort({ createdAt: 1 })
      .lean();

    // Construct simple account info without fetching exchange balances
    const accountExchangeInfos: AccountExchangeInfo[] = accounts.map(acct => ({
      accountId: acct._id.toString(),
      accountName: acct.name,
      sourceType: acct.sourceType || "discord",
      tradingPlatform: acct.tradingPlatform || "paper",
      isDemo: Boolean(acct.exchangeData?.simulated),
      channelIds: acct.channelIds || [],
      account: null, // to be filled by /api/dashboard/exchange
      exchangeError: null, // to be filled by /api/dashboard/exchange
    }));

    // Fetch pending positions (limit orders waiting to fill)
    const pendingPositions = await Position.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .lean();

    const [
      stats,
      openPositions,
      pendingDrafts,
      tradingMode,
      riskConfig,
      signalConfig,
    ] = await Promise.all([
      getStats(),
      getOpenPositions(),
      getPendingDrafts(),
      getTradingMode(),
      getRiskConfig(),
      getSignalConfig(),
    ]);

    // Resolve channel names from accounts
    const channelNames: Record<string, string> = {};
    for (const acct of accounts) {
      if (acct.channelNames && typeof acct.channelNames === "object") {
        if (acct.channelNames instanceof Map) {
          for (const [k, v] of (
            acct.channelNames as Map<string, string>
          ).entries()) {
            if (v) channelNames[k] = v;
          }
        } else {
          for (const [k, v] of Object.entries(acct.channelNames)) {
            if (v) channelNames[k] = v as string;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        stats,
        accounts: accountExchangeInfos,
        account: null,
        exchangeProvider: accountExchangeInfos[0]?.tradingPlatform || null,
        exchangeError: null,
        openPositions, // returned as-is from DB, without live PnL or markPrice
        pendingDrafts,
        pendingPositions,
        tradingMode,
        riskConfig,
        signalConfig,
        channelNames,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
