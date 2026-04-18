import { NextRequest, NextResponse } from "next/server";
import {
  connectDB,
  getStats,
  getOpenPositions,
  getPendingDrafts,
  getTradingMode,
  Position,
  Account,
} from "@copytrade/shared/lib/database";
import {
  ExchangeFactory,
  ExchangeCredentials,
} from "@copytrade/shared/lib/exchange/ExchangeFactory";
import { getRiskConfig } from "@copytrade/shared/lib/risk";
import { getSignalConfig } from "@copytrade/shared/lib/signal-config";
import { createTradeLog } from "@copytrade/shared/lib/trade-log-store";

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

    // Fetch exchange account info per account
    const accountExchangeInfos: AccountExchangeInfo[] = [];
    const accountExchangeMap = new Map<
      string,
      { client: any; info: AccountExchangeInfo }
    >();

    for (const acct of accounts) {
      const info: AccountExchangeInfo = {
        accountId: acct._id.toString(),
        accountName: acct.name,
        sourceType: acct.sourceType || "discord",
        tradingPlatform: acct.tradingPlatform || "paper",
        isDemo: acct.exchangeData?.simulated || false,
        channelIds: acct.channelIds || [],
        account: null,
        exchangeError: null,
      };

      if (acct.exchangeData) {
        try {
          const creds: ExchangeCredentials = {
            provider: (acct.tradingPlatform as any) || "paper",
            apiKey: acct.exchangeData.apiKey,
            secretKey: acct.exchangeData.secretKey,
            passphrase: acct.exchangeData.passphrase,
            simulated: acct.exchangeData.simulated,
          };
          const client = ExchangeFactory.getClientForAccount(creds);
          const accountInfo = await client.getAccountInfo();
          info.account = accountInfo;
          accountExchangeMap.set(acct._id.toString(), { client, info });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `Failed to fetch exchange account for "${acct.name}": ${msg}`,
          );
          info.exchangeError = msg;
        }
      } else {
        info.exchangeError = "No exchange credentials configured";
      }

      accountExchangeInfos.push(info);
    }

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

    // Enrich open positions with real-time exchange data per account
    // Group positions by accountId
    const positionsByAccount = new Map<string, typeof openPositions>();
    for (const pos of openPositions) {
      const aid = pos.accountId?.toString() || "unknown";
      if (!positionsByAccount.has(aid)) positionsByAccount.set(aid, []);
      positionsByAccount.get(aid)!.push(pos);
    }

    const enrichedPositions: any[] = [];
    let syncedClosed = 0;

    for (const [accountId, positions] of positionsByAccount) {
      const exchangeEntry = accountExchangeMap.get(accountId);
      const exchangeSymbols = new Set<string>();
      let exchangePositions: Array<{
        symbol: string;
        markPrice: number;
        unrealizedPnl: number;
        entryPrice: number;
      }> = [];

      if (exchangeEntry) {
        try {
          const exPositions = await exchangeEntry.client.getOpenPositions();
          exchangePositions = exPositions.map((p: any) => {
            exchangeSymbols.add(p.symbol);
            return {
              symbol: p.symbol,
              markPrice: p.markPrice,
              unrealizedPnl: p.unrealizedPnl,
              entryPrice: p.entryPrice,
            };
          });
        } catch (err) {
          console.warn(
            `Failed to fetch exchange positions for account ${accountId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // Sync: mark DB positions as closed if they're no longer on the exchange
      for (const pos of positions) {
        if (exchangeSymbols.size > 0 && !exchangeSymbols.has(pos.symbol)) {
          console.log(
            `[Dashboard] 🔄 Sync: ${pos.symbol} ${pos.side} not on exchange (account ${accountId}) — closing in DB`,
          );
          try {
            await Position.updateOne(
              { _id: pos._id },
              {
                status: "closed",
                closedAt: new Date(),
                closeReason: "Closed on Exchange (external)",
              },
            );
            await createTradeLog({
              type: "monitor",
              action: "sync_close",
              symbol: pos.symbol,
              details: `Position ${pos.side} ${pos.symbol} closed externally on exchange. Synced from dashboard.`,
              result: "success",
            });
            syncedClosed++;
          } catch (syncErr) {
            console.warn(
              `[Dashboard] Failed to sync close ${pos.symbol}:`,
              syncErr instanceof Error ? syncErr.message : String(syncErr),
            );
          }
        } else if (exchangeSymbols.size > 0 || exchangeEntry) {
          // Position is still on exchange — enrich with real-time data
          const exPos = exchangePositions.find(
            (ep) => ep.symbol === pos.symbol,
          );
          enrichedPositions.push({
            ...pos,
            currentPrice: exPos?.markPrice ?? pos.currentPrice ?? null,
            pnl: exPos?.unrealizedPnl ?? pos.pnl ?? 0,
            entryPrice: exPos?.entryPrice ?? pos.entryPrice,
          });
        } else {
          // No exchange connection — keep position as-is
          enrichedPositions.push(pos);
        }
      }
    }

    // Also add positions that have no accountId (legacy)
    const legacyPositions = openPositions.filter((pos) => !pos.accountId);
    for (const pos of legacyPositions) {
      // Check if already enriched (accountId was "unknown")
      if (
        !enrichedPositions.find(
          (ep) => ep._id.toString() === pos._id.toString(),
        )
      ) {
        enrichedPositions.push(pos);
      }
    }

    // Recalculate stats if positions were closed
    let finalStats = stats;
    if (syncedClosed > 0) {
      finalStats = await getStats();
    }

    // Primary account info (first account with exchange data) for backward compat
    const primaryAccount =
      accountExchangeInfos.find((a) => a.account !== null) ||
      accountExchangeInfos[0] ||
      null;

    return NextResponse.json({
      success: true,
      data: {
        stats: finalStats,
        accounts: accountExchangeInfos,
        // Backward compat fields
        account: primaryAccount?.account || null,
        exchangeProvider: primaryAccount?.tradingPlatform || null,
        exchangeError: primaryAccount?.exchangeError || null,
        // End backward compat
        openPositions: enrichedPositions,
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
