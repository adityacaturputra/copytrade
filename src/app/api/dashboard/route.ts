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
} from "@/lib/database";
import { ExchangeFactory } from "@/lib/exchange/ExchangeFactory";

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
    ] = await Promise.all([
      getStats(),
      getOpenPositions(),
      getRecentMessages(20),
      getRecentLogs(50),
      getAllPositions(50),
      getPendingDrafts(),
      getRecentDrafts(50),
      getTradingMode(),
    ]);

    // Enrich open positions with real-time exchange data (current price, PnL)
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
        exchangePositions = exPositions.map((p) => ({
          symbol: p.symbol,
          markPrice: p.markPrice,
          unrealizedPnl: p.unrealizedPnl,
          entryPrice: p.entryPrice,
        }));
      } catch (err) {
        console.warn(
          "Failed to fetch exchange positions for enrichment:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const enrichedOpenPositions = openPositions.map((pos) => {
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
        stats,
        account,
        exchangeProvider,
        exchangeError,
        openPositions: enrichedOpenPositions,
        recentMessages,
        recentLogs,
        allPositions,
        pendingDrafts,
        recentDrafts,
        tradingMode,
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
