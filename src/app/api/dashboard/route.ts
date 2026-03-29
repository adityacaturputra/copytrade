import { NextResponse } from "next/server";
import {
  connectDB,
  getStats,
  getOpenPositions,
  getRecentMessages,
  getRecentLogs,
  getAllPositions,
  getPendingDrafts,
  getRecentDrafts,
  getTradingMode,
  Position,
  TradeLog,
} from "@/lib/database";
import { ExchangeFactory } from "@/lib/exchange/ExchangeFactory";
import { getRiskConfig } from "@/lib/risk";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();

    // Fetch exchange account info
    let account = null;
    let exchangeProvider = null;
    let exchangeError = null;
    try {
      const client = ExchangeFactory.getClient();
      exchangeProvider = client.name;
      account = await client.getAccountInfo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Failed to fetch exchange account:", msg);
      exchangeError = msg;
    }

    const [
      stats,
      openPositions,
      recentMessages,
      recentLogs,
      allPositions,
      pendingDrafts,
      recentDrafts,
      tradingMode,
      riskConfig,
    ] = await Promise.all([
      getStats(),
      getOpenPositions(),
      getRecentMessages(20),
      getRecentLogs(50),
      getAllPositions(50),
      getPendingDrafts(),
      getRecentDrafts(50),
      getTradingMode(),
      getRiskConfig(),
    ]);

    // Enrich open positions with real-time exchange data (current price, PnL)
    // Also sync: detect positions closed on the exchange and update DB
    const exchangeSymbols = new Set<string>();
    let exchangePositions: Array<{
      symbol: string;
      markPrice: number;
      unrealizedPnl: number;
      entryPrice: number;
    }> = [];
    if (account) {
      try {
        const client = ExchangeFactory.getClient();
        const exPositions = await client.getOpenPositions();
        exchangePositions = exPositions.map((p) => {
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
          "Failed to fetch exchange positions for enrichment:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Sync: mark DB positions as closed if they're no longer on the exchange
    let syncedClosed = 0;
    if (exchangeSymbols.size > 0 || account) {
      for (const pos of openPositions) {
        if (!exchangeSymbols.has(pos.symbol)) {
          console.log(
            `[Dashboard] 🔄 Sync: ${pos.symbol} ${pos.side} not on exchange — closing in DB`,
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
            await TradeLog.create({
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
        }
      }
    }

    // Filter out synced-closed positions and enrich remaining with exchange data
    const activePositions = openPositions.filter(
      (pos) => exchangeSymbols.has(pos.symbol) || !account,
    );

    // Recalculate stats if positions were closed
    let finalStats = stats;
    if (syncedClosed > 0) {
      finalStats = await getStats();
    }

    const enrichedOpenPositions = activePositions.map((pos) => {
      const exPos = exchangePositions.find((ep) => ep.symbol === pos.symbol);
      return {
        ...pos,
        currentPrice: exPos?.markPrice ?? pos.currentPrice ?? null,
        pnl: exPos?.unrealizedPnl ?? pos.pnl ?? 0,
        entryPrice: exPos?.entryPrice ?? pos.entryPrice,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        stats: finalStats,
        account,
        exchangeProvider,
        exchangeError,
        openPositions: enrichedOpenPositions,
        recentMessages,
        recentLogs,
        allPositions:
          syncedClosed > 0 ? await getAllPositions(50) : allPositions,
        pendingDrafts,
        recentDrafts,
        tradingMode,
        riskConfig,
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
