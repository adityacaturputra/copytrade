import { NextRequest, NextResponse } from "next/server";
import { connectDB, TradeLog } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10)),
    );
    const hideCronNoise = searchParams.get("hideCronNoise") !== "false";

    // Build base query — optionally exclude routine cron heartbeat logs
    const baseFilter: Record<string, unknown> = {};
    if (hideCronNoise) {
      baseFilter.$or = [
        { type: { $ne: "cron" } },
        { action: { $not: /(_start|_end)$/ } },
      ];
    }

    const [logs, totalCount] = await Promise.all([
      TradeLog.find(baseFilter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TradeLog.countDocuments(baseFilter),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json({
      success: true,
      data: {
        logs,
        page,
        limit,
        totalCount,
        totalPages,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to fetch logs:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
