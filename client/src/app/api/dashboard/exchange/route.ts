import { NextRequest, NextResponse } from "next/server";
import {
  connectDB,
  getStats,
  getOpenPositions,
  Position,
  Account,
} from "@copytrade/shared/lib/database";
import {
  ExchangeFactory,
  buildExchangeCredentials,
} from "@copytrade/shared/lib/exchange/ExchangeFactory";
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

function calculatePositionPnlUsd(
  position: {
    entryPrice: number;
    quantity: number;
    side: string;
  },
  currentPrice: number,
): number | null {
  if (
    !Number.isFinite(position.entryPrice) ||
    !Number.isFinite(position.quantity) ||
    !Number.isFinite(currentPrice) ||
    position.entryPrice <= 0 ||
    position.quantity <= 0
  ) {
    return null;
  }

  const gross =
    position.side === "LONG"
      ? (currentPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - currentPrice) * position.quantity;
  return Number(gross.toFixed(4));
}

export async function GET() {
  try {
    await connectDB();

    // Fetch all active accounts
    const accounts = await Account.find({ isActive: true })
      .sort({ createdAt: 1 })
      .lean();

    // Fetch open positions to sync with exchange
    const openPositions = await getOpenPositions();

    const accountExchangeInfos: AccountExchangeInfo[] = [];
    const accountExchangeMap = new Map<
      string,
      { client: any; info: AccountExchangeInfo }
    >();

    // Process accounts in parallel to speed up exchange API calls
    await Promise.all(
      accounts.map(async (acct) => {
        const info: AccountExchangeInfo = {
          accountId: acct._id.toString(),
          accountName: acct.name,
          sourceType: acct.sourceType || "discord",
          tradingPlatform: acct.tradingPlatform || "paper",
          isDemo: Boolean(acct.exchangeData?.simulated),
          channelIds: acct.channelIds || [],
          account: null,
          exchangeError: null,
        };

        if (acct.exchangeData) {
          try {
            const creds = buildExchangeCredentials(
              acct.tradingPlatform,
              (acct.exchangeData as Record<string, unknown>) || {},
            );
            const client = creds
              ? ExchangeFactory.getClientForAccount(creds)
              : ExchangeFactory.getPaperClient();
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
      }),
    );

    // Group positions by accountId
    const positionsByAccount = new Map<string, typeof openPositions>();
    for (const pos of openPositions) {
      const aid = pos.accountId?.toString() || "unknown";
      if (!positionsByAccount.has(aid)) positionsByAccount.set(aid, []);
      positionsByAccount.get(aid)!.push(pos);
    }

    const enrichedPositions: any[] = [];
    let syncedClosed = 0;

    // Process positions per account in parallel
    await Promise.all(
      Array.from(positionsByAccount.entries()).map(
        async ([accountId, positions]) => {
          const exchangeEntry = accountExchangeMap.get(accountId);
          const exchangeSymbols = new Set<string>();
          let exchangePositions: Array<{
            symbol: string;
            side: string;
            markPrice: number;
            unrealizedPnl: number;
            entryPrice: number;
            leverage: number;
            quantity: number;
            marginType: string;
            margin: number;
          }> = [];

          if (exchangeEntry) {
            try {
              const exPositions = await exchangeEntry.client.getOpenPositions();
              exchangePositions = exPositions.map((p: any) => {
                exchangeSymbols.add(p.symbol);
                return {
                  symbol: p.symbol,
                  side: p.side,
                  markPrice: p.markPrice,
                  unrealizedPnl: p.unrealizedPnl,
                  entryPrice: p.entryPrice,
                  leverage: p.leverage,
                  quantity: p.quantity,
                  marginType: p.marginType,
                  margin: p.margin,
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
                    pnlUsd:
                      calculatePositionPnlUsd(
                        pos,
                        pos.currentPrice ?? Number.NaN,
                      ) ??
                      pos.pnlUsd ??
                      null,
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
              // Normalize side comparison: exchange may return "Buy"/"Sell"/"BUY"/"SELL"
              // while DB stores "LONG"/"SHORT"
              const normalizeSide = (s: string | undefined) =>
                (s || "")
                  .toUpperCase()
                  .replace("BUY", "LONG")
                  .replace("SELL", "SHORT");
              const exPos = exchangePositions.find(
                (ep) =>
                  ep.symbol === pos.symbol &&
                  normalizeSide(ep.side) === normalizeSide(pos.side),
              );
              enrichedPositions.push({
                ...pos,
                currentPrice: exPos?.markPrice ?? pos.currentPrice ?? null,
                pnl: pos.pnl ?? 0,
                pnlUsd: exPos?.unrealizedPnl ?? pos.pnlUsd ?? null,
                entryPrice: exPos?.entryPrice ?? pos.entryPrice,
                leverage: exPos?.leverage ?? pos.leverage,
                quantity: exPos?.quantity ?? pos.quantity,
                marginType: exPos?.marginType ?? pos.marginType ?? "isolated",
                margin: exPos?.margin ?? pos.margin ?? null,
              });
            } else {
              // No exchange connection — keep position as-is
              enrichedPositions.push(pos);
            }
          }
        },
      ),
    );

    // Also add positions that have no accountId (legacy)
    const legacyPositions = openPositions.filter((pos) => !pos.accountId);
    for (const pos of legacyPositions) {
      if (
        !enrichedPositions.find(
          (ep) => ep._id.toString() === pos._id.toString(),
        )
      ) {
        enrichedPositions.push(pos);
      }
    }

    // Return the stats, which might be updated if positions closed
    const stats = await getStats();

    // Primary account info (first account with exchange data) for backward compat
    const primaryAccount =
      accountExchangeInfos.find((a) => a.account !== null) ||
      accountExchangeInfos[0] ||
      null;

    return NextResponse.json({
      success: true,
      data: {
        stats,
        accounts: accountExchangeInfos,
        openPositions: enrichedPositions,
        account: primaryAccount?.account || null,
        exchangeProvider: primaryAccount?.tradingPlatform || null,
        exchangeError: primaryAccount?.exchangeError || null,
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
