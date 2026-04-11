import { NextRequest, NextResponse } from "next/server";
import { connectDB, DraftTrade } from "@copytrade/shared/lib/database";

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

    const [drafts, totalCount] = await Promise.all([
      DraftTrade.find(filter)
        .sort({ sourceTimestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DraftTrade.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json({
      success: true,
      data: { drafts, page, limit, totalCount, totalPages },
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
