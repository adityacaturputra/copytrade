import { NextResponse } from "next/server";
import {
  connectDB,
  DraftTrade,
  ProcessedMessage,
  TradeLog,
} from "@copytrade/shared/lib/database";
import {
  analyzeMessagesWithAI,
  createDraft,
  refreshDraftFromSignal,
} from "@copytrade/shared/lib/executor";

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

    const message = {
      messageId: draft.messageId,
      channelId: draft.channelId,
      author: draft.author,
      content: draft.originalContent,
      originalContent: draft.originalContent,
      messageUrl: draft.messageUrl,
      imageUrls: [...(draft.imageUrls || [])],
      timestamp: draft.sourceTimestamp || draft.createdAt || new Date(),
    };

    const [result] = await analyzeMessagesWithAI([message]);
    if (!result) {
      return NextResponse.json(
        { success: false, error: "AI did not return any analysis result." },
        { status: 500 },
      );
    }

    if (result.parseError) {
      return NextResponse.json(
        { success: false, error: result.parseError },
        { status: 500 },
      );
    }

    const signal = result.signal;
    if (!signal || !signal.action || signal.action === "HOLD") {
      return NextResponse.json(
        {
          success: false,
          error: "AI no longer classifies this Discord message as an actionable trading signal.",
        },
        { status: 400 },
      );
    }

    if (signal.action === "CANCEL") {
      return NextResponse.json(
        {
          success: false,
          error: "AI re-analysis classified this message as a cancel/close instruction, not a draftable entry.",
        },
        { status: 400 },
      );
    }

    signal.messageId = draft.messageId;
    signal.rawSignal = draft.originalContent;

    const refreshedDraft =
      draft.status === "pending"
        ? await refreshDraftFromSignal(draft, signal, message)
        : await createDraft(signal, message, draft.accountId || undefined);

    if (draft.status === "pending") {
      await ProcessedMessage.updateOne(
        {
          messageId: draft.messageId,
          accountId: draft.accountId || null,
        },
        {
          signalType: signal.action,
          parsedSignal: JSON.stringify(signal),
          status: "drafted",
          processedAt: new Date(),
        },
      );
    }

    await TradeLog.create({
      accountId: draft.accountId || undefined,
      type: "draft",
      action:
        draft.status === "pending"
          ? `reanalyzed_${signal.action}`
          : `reanalyzed_to_draft_${signal.action}`,
      symbol: signal.symbol,
      details: JSON.stringify(signal),
      result: "drafted",
    });

    return NextResponse.json({
      success: true,
      data: {
        draft: refreshedDraft,
        message:
          draft.status === "pending"
            ? "Draft re-analyzed and updated."
            : "New pending draft created from fresh AI analysis.",
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
