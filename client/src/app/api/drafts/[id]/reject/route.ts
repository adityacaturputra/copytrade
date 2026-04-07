import { NextRequest, NextResponse } from "next/server";
import { connectDB, DraftTrade, TradeLog } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await connectDB();
    const { id } = await params;

    const draft = await DraftTrade.findById(id);
    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 },
      );
    }

    if (draft.status !== "pending") {
      return NextResponse.json(
        { success: false, error: `Draft already ${draft.status}` },
        { status: 400 },
      );
    }

    draft.status = "rejected";
    draft.resolvedAt = new Date();
    await draft.save();

    await TradeLog.create({
      type: "draft",
      action: `rejected_${draft.action}`,
      symbol: draft.symbol,
      details: draft.signalData,
      result: "rejected",
    });

    return NextResponse.json({
      success: true,
      data: { draft },
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
