import { NextRequest, NextResponse } from "next/server";
import { connectDB, Position } from "@copytrade/shared/lib/database/index";

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
    const channelId = searchParams.get("channelId") || null;
    const accountId = searchParams.get("accountId") || null;
    const status = searchParams.get("status") || null;

    const filter: Record<string, unknown> = {};
    if (channelId) filter.channelId = channelId;
    if (accountId) filter.accountId = accountId;
    if (status) filter.status = status;

    const [positions, totalCount] = await Promise.all([
      Position.find(filter)
        .sort({ openedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Position.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json({
      success: true,
      data: { positions, page, limit, totalCount, totalPages },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to fetch positions:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
