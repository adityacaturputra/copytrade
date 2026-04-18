import { NextRequest, NextResponse } from "next/server";
import { connectDB, DraftTrade } from "@copytrade/shared/lib/database";
import {
  createTradeProcessId,
  logProcessStep,
} from "@copytrade/shared/lib/process-log";

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

    const processId = draft.processId || createTradeProcessId("draftproc");
    draft.processId = processId;

    draft.status = "rejected";
    draft.resolvedAt = new Date();
    await draft.save();

    await logProcessStep({
      accountId: draft.accountId || undefined,
      processId,
      type: "draft_process",
      action: "manual_reject_completed",
      symbol: draft.symbol,
      details: {
        draftId: draft._id.toString(),
        messageId: draft.messageId,
      },
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
