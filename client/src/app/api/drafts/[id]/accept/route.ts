import { NextRequest, NextResponse } from "next/server";
import { connectDB, DraftTrade } from "@copytrade/shared/lib/database";
import { TradingSignal } from "@copytrade/shared/lib/ai/types";
import {
  executeSignal,
  resolveDraftWithExecution,
} from "@copytrade/shared/lib/executor";
import {
  createTradeProcessId,
  logProcessStep,
} from "@copytrade/shared/lib/process-log";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const startTime = Date.now();
  const requestId = `accept-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const lp = `[${requestId}]`;

  console.log(`${lp} 📨 POST /api/drafts/[id]/accept — request received`);

  try {
    console.log(`${lp} 🔗 Connecting to database...`);
    await connectDB();
    console.log(`${lp} ✅ Database connected`);

    const { id } = await params;
    console.log(`${lp} 🔍 Looking up draft: ${id}`);

    const draft = await DraftTrade.findById(id);
    if (!draft) {
      console.warn(`${lp} ❌ Draft not found: ${id}`);
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 },
      );
    }

    console.log(
      `${lp} 📋 Draft found: id=${id}, symbol=${draft.symbol}, action=${draft.action}, status=${draft.status}, side=${draft.side}, quantity=${draft.quantity}, leverage=${draft.leverage}`,
    );

    if (draft.status !== "pending") {
      console.warn(`${lp} ⚠️ Draft already ${draft.status}: ${id}`);
      return NextResponse.json(
        { success: false, error: `Draft already ${draft.status}` },
        { status: 400 },
      );
    }

    // ─── Parse signal data ──────────────────────────────────────────
    let parsedSignal: TradingSignal;
    try {
      parsedSignal = JSON.parse(draft.signalData);
      console.log(
        `${lp} 📡 Parsed signal data: action=${parsedSignal.action}, symbol=${parsedSignal.symbol}`,
      );
    } catch (parseError) {
      const errMsg =
        parseError instanceof Error ? parseError.message : String(parseError);
      console.error(
        `${lp} ❌ Failed to parse signalData for draft ${id}: ${errMsg}`,
      );
      return NextResponse.json(
        { success: false, error: `Invalid signal data: ${errMsg}` },
        { status: 500 },
      );
    }

    const processId = draft.processId || createTradeProcessId("draftproc");
    if (!draft.processId) {
      draft.processId = processId;
      await draft.save();
    }

    await logProcessStep({
      accountId: draft.accountId || undefined,
      processId,
      type: "draft_process",
      action: "manual_accept_requested",
      symbol: draft.symbol,
      details: {
        draftId: draft._id.toString(),
        messageId: draft.messageId,
      },
      result: "processing",
    });

    // ─── Auto-calculate TP from RR if no TP but has entry + SL ──────
    let bodyData: { rr?: number } = {};
    try {
      bodyData = await request.json();
    } catch {
      // Empty body is fine
    }

    const signal: TradingSignal = {
      ...parsedSignal,
      action: draft.action as TradingSignal["action"],
      symbol: draft.symbol,
      entryPrice: draft.entryPrice || parsedSignal.entryPrice || undefined,
      takeProfitTargets:
        draft.takeProfitTargets && draft.takeProfitTargets.length > 0
          ? [...draft.takeProfitTargets]
          : parsedSignal.takeProfitTargets,
      stopLoss: draft.stopLoss || parsedSignal.stopLoss || undefined,
      leverage: draft.leverage,
      positionSize: draft.quantity,
      defaultRR: bodyData.rr || parsedSignal.defaultRR,
      rawSignal: draft.originalContent,
      messageId: draft.messageId,
    };

    const execution = await executeSignal(
      signal,
      draft.messageId,
      draft.channelId || undefined,
      undefined,
      draft.accountId || undefined,
      processId,
    );

    const draftOutcome = await resolveDraftWithExecution(draft, execution);

    if (draftOutcome.status === "rejected") {
      await logProcessStep({
        accountId: draft.accountId || undefined,
        processId,
        type: "draft_process",
        action: "manual_accept_rejected",
        symbol: draft.symbol,
        details: {
          draftId: draft._id.toString(),
          result: draftOutcome.result,
        },
        result: "rejected",
        error: draftOutcome.error,
      });

      return NextResponse.json(
        { success: false, error: draftOutcome.error },
        { status: 400 },
      );
    }

    await logProcessStep({
      accountId: draft.accountId || undefined,
      processId,
      type: "draft_process",
      action: "manual_accept_completed",
      symbol: draft.symbol,
      details: {
        draftId: draft._id.toString(),
        positionId: draftOutcome.positionId || null,
        message: draftOutcome.message || null,
      },
      result: draftOutcome.result,
    });

    const duration = Date.now() - startTime;
    console.log(
      `${lp} ✅ Draft accepted successfully: id=${draft._id}, action=${draft.action}, symbol=${draft.symbol}, positionId=${draftOutcome.positionId || "N/A"} (${duration}ms)`,
    );

    return NextResponse.json({
      success: true,
      data: {
        draft,
        positionId: draftOutcome.positionId,
        message: draftOutcome.message,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorName =
      error instanceof Error ? error.constructor.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(
      `${errorName} (${duration}ms): [${errorName}] ${errorMessage}`,
    );

    if (
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ETIMEDOUT")
    ) {
      console.error(
        `🌐 Network error detected — exchange API may be unreachable`,
      );
    }
    if (
      errorMessage.includes("MongoError") ||
      errorMessage.includes("MongooseError") ||
      errorMessage.includes("CastError")
    ) {
      console.error(
        `🗄️ Database error detected — check MongoDB connection and query`,
      );
    }
    if (
      errorMessage.includes("insufficient") ||
      errorMessage.includes("Insufficient")
    ) {
      console.error(
        `💰 Insufficient funds error — check exchange account balance`,
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        errorType: errorName,
        ...(process.env.NODE_ENV === "development" && { stack: errorStack }),
      },
      { status: 500 },
    );
  }
}
