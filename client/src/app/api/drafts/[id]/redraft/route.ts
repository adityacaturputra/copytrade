import { NextResponse } from "next/server";
import { connectDB, DraftTrade } from "@copytrade/shared/lib/database";
import {
  createTradeProcessId,
  logProcessStep,
} from "@copytrade/shared/lib/process-log";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
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

    if (draft.status === "pending") {
      return NextResponse.json(
        {
          success: false,
          error: "Draft is already pending. Use re-analyze to refresh it.",
        },
        { status: 400 },
      );
    }

    const newDraft = await DraftTrade.create({
      accountId: draft.accountId || null,
      processId: createTradeProcessId("draftproc"),
      messageId: draft.messageId,
      channelId: draft.channelId,
      messageUrl: draft.messageUrl,
      author: draft.author,
      originalContent: draft.originalContent,
      imageUrls: [...(draft.imageUrls || [])],
      signalData: draft.signalData,
      action: draft.action,
      symbol: draft.symbol,
      side: draft.side,
      entryPrice: draft.entryPrice || null,
      takeProfitTargets: [...(draft.takeProfitTargets || [])],
      stopLoss: draft.stopLoss || null,
      leverage: draft.leverage,
      quantity: draft.quantity,
      confidence: draft.confidence,
      reasoning: draft.reasoning,
      status: "pending",
      positionId: null,
      sourceTimestamp: draft.sourceTimestamp || null,
      resolvedAt: null,
    });

    await logProcessStep({
      accountId: draft.accountId || undefined,
      processId: newDraft.processId || undefined,
      type: "draft_process",
      action: "redraft_created",
      symbol: draft.symbol,
      details: {
        fromDraftId: draft._id.toString(),
        newDraftId: newDraft._id.toString(),
      },
      result: "drafted",
    });

    return NextResponse.json({
      success: true,
      data: {
        draft: newDraft,
        message: "Draft created again and is pending review.",
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
