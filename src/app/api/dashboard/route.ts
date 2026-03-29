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

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();

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

    return NextResponse.json({
      success: true,
      data: {
        stats,
        openPositions,
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
