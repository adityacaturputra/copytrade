import { Router, Request, Response, type Router as ExpressRouter } from "express";
import {
  connectDB,
  DraftTrade,
  ProcessedMessage,
} from "@copytrade/shared/lib/database";
import type { TradingSignal } from "@copytrade/shared/lib/ai/types";
import {
  analyzeMessagesWithAI,
  createDraft,
  executeSignal,
  refreshDraftFromSignal,
  resolveDraftWithExecution,
} from "@copytrade/shared/lib/executor";
import {
  createTradeProcessId,
  logProcessStep,
} from "@copytrade/shared/lib/process-log";

const router: ExpressRouter = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    await connectDB();

    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit || "50"), 10)),
    );
    const channelId =
      typeof req.query.channelId === "string" ? req.query.channelId : null;
    const accountId =
      typeof req.query.accountId === "string" ? req.query.accountId : null;
    const status =
      typeof req.query.status === "string" ? req.query.status : null;

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

    res.json({
      success: true,
      data: {
        drafts,
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.post("/:id/accept", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = `accept-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const lp = `[${requestId}]`;
  const draftId = req.params.id;
  let processId: string | undefined;
  let accountId: string | undefined;
  let symbol: string | undefined;

  console.log(`${lp} 📨 POST /api/drafts/:id/accept — request received`);

  try {
    await connectDB();

    const draft = await DraftTrade.findById(draftId);
    if (!draft) {
      res.status(404).json({ success: false, error: "Draft not found" });
      return;
    }

    if (draft.status !== "pending") {
      res.status(400).json({
        success: false,
        error: `Draft already ${draft.status}`,
      });
      return;
    }

    let parsedSignal: TradingSignal;
    try {
      parsedSignal = JSON.parse(draft.signalData);
    } catch (parseError) {
      const errMsg =
        parseError instanceof Error ? parseError.message : String(parseError);
      res.status(500).json({
        success: false,
        error: `Invalid signal data: ${errMsg}`,
      });
      return;
    }

    processId = draft.processId || createTradeProcessId("draftproc");
    accountId = draft.accountId || undefined;
    symbol = draft.symbol;
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

    const bodyData =
      req.body && typeof req.body === "object"
        ? (req.body as { rr?: number })
        : {};

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

      res.status(400).json({ success: false, error: draftOutcome.error });
      return;
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

    res.json({
      success: true,
      data: {
        draft,
        positionId: draftOutcome.positionId,
        message: draftOutcome.message,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (processId) {
      await logProcessStep({
        accountId,
        processId,
        type: "draft_process",
        action: "manual_accept_failed",
        symbol,
        details: {
          draftId,
        },
        result: "error",
        error: errorMessage,
      });
    }

    console.error(`${lp} ❌ ${errorMessage} (${duration}ms)`);
    res.status(500).json({
      success: false,
      error: errorMessage,
      processId: processId || null,
    });
  }
});

router.post("/:id/reject", async (req: Request, res: Response) => {
  try {
    await connectDB();
    const id = req.params.id;

    const draft = await DraftTrade.findById(id);
    if (!draft) {
      res.status(404).json({ success: false, error: "Draft not found" });
      return;
    }

    if (draft.status !== "pending") {
      res.status(400).json({
        success: false,
        error: `Draft already ${draft.status}`,
      });
      return;
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

    res.json({
      success: true,
      data: { draft },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.post("/:id/redraft", async (req: Request, res: Response) => {
  try {
    await connectDB();
    const id = req.params.id;

    const draft = await DraftTrade.findById(id);
    if (!draft) {
      res.status(404).json({ success: false, error: "Draft not found" });
      return;
    }

    if (draft.status === "pending") {
      res.status(400).json({
        success: false,
        error: "Draft is already pending. Use re-analyze to refresh it.",
      });
      return;
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

    res.json({
      success: true,
      data: {
        draft: newDraft,
        message: "Draft created again and is pending review.",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.post("/:id/reanalyze", async (req: Request, res: Response) => {
  try {
    await connectDB();
    const id = req.params.id;

    const draft = await DraftTrade.findById(id);
    if (!draft) {
      res.status(404).json({ success: false, error: "Draft not found" });
      return;
    }

    const processId =
      draft.status === "pending"
        ? draft.processId || createTradeProcessId("draftproc")
        : createTradeProcessId("draftproc");

    if (draft.status === "pending" && !draft.processId) {
      draft.processId = processId;
      await draft.save();
    }

    await logProcessStep({
      accountId: draft.accountId || undefined,
      processId,
      type: "draft_process",
      action: "reanalyze_requested",
      symbol: draft.symbol,
      details: {
        draftId: draft._id.toString(),
        originalStatus: draft.status,
      },
      result: "processing",
    });

    const message = {
      messageId: draft.messageId,
      channelId: draft.channelId,
      author: draft.author,
      content: draft.originalContent,
      originalContent: draft.originalContent,
      messageUrl: draft.messageUrl,
      imageUrls: [...(draft.imageUrls || [])],
      timestamp: draft.sourceTimestamp || draft.createdAt || new Date(),
      sourceId: draft.accountId || undefined,
      processId,
    };

    const [result] = await analyzeMessagesWithAI([message]);
    if (!result) {
      res.status(500).json({
        success: false,
        error: "AI did not return any analysis result.",
      });
      return;
    }

    if (result.parseError) {
      res.status(500).json({ success: false, error: result.parseError });
      return;
    }

    const signal = result.signal;
    if (!signal || !signal.action || signal.action === "HOLD") {
      res.status(400).json({
        success: false,
        error: "AI no longer classifies this Discord message as an actionable trading signal.",
      });
      return;
    }

    if (signal.action === "CANCEL") {
      res.status(400).json({
        success: false,
        error: "AI re-analysis classified this message as a cancel/close instruction, not a draftable entry.",
      });
      return;
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

    await logProcessStep({
      accountId: draft.accountId || undefined,
      processId,
      type: "draft_process",
      action:
        draft.status === "pending"
          ? "reanalyze_completed"
          : "reanalyze_created_new_draft",
      symbol: signal.symbol,
      details: {
        originalDraftId: draft._id.toString(),
        resultingDraftId: refreshedDraft._id.toString(),
        action: signal.action,
      },
      result: "drafted",
    });

    res.json({
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
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
