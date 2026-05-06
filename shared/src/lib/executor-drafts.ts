import type { TradingSignal } from "./ai/types";
import { DraftTrade } from "./database";
import {
  autoCalculateSLFromRR,
  autoCalculateTPFromRR,
  sanitizeLeverage,
} from "./executor-signal-utils";
import type {
  DraftDocument,
  DraftExecutionOutcome,
  DraftSourceMessage,
  SignalExecutionResult,
} from "./executor-types";
import { logExecutorInfo, logProcessStep } from "./process-log";
import { resolveEffectiveRiskConfig } from "./risk";

function resolveOriginalContent(msg: DraftSourceMessage): string {
  const original = msg.originalContent?.trim();
  if (original) return original;

  const content = msg.content?.trim();
  if (content) return content;

  const imageCount = msg.imageUrls?.length || 0;
  const attachmentHint =
    imageCount > 0
      ? ` with ${imageCount} attachment${imageCount === 1 ? "" : "s"}`
      : "";
  const urlHint = msg.messageUrl ? ` ${msg.messageUrl}` : "";

  return `[source message had no text content${attachmentHint}]${urlHint}`;
}

async function buildDraftPayload(
  signal: TradingSignal,
  msg: DraftSourceMessage,
  accountId?: string,
): Promise<{
  accountId: string | null;
  processId: string | null;
  messageId: string;
  channelId: string;
  messageUrl: string;
  author: string;
  originalContent: string;
  imageUrls: string[];
  signalData: string;
  action: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number | null;
  takeProfitTargets: number[];
  stopLoss: number | null;
  leverage: number;
  quantity: number;
  confidence: number;
  reasoning: string;
  sourceTimestamp: Date | null;
}> {
  const riskCfg = await resolveEffectiveRiskConfig({
    accountId,
    channelId: msg.channelId,
  });
  const side = signal.action === "SELL" ? "SHORT" : "LONG";
  const quantity = signal.positionSize || riskCfg.defaultPositionSize;

  let tpTargets = signal.takeProfitTargets || [];
  let autoSL: number | null = null;

  if (!signal.stopLoss && tpTargets.length > 0 && signal.entryPrice) {
    const rr =
      signal.defaultRR && signal.defaultRR > 0
        ? signal.defaultRR
        : riskCfg.defaultRR;

    if (rr > 0) {
      autoSL = autoCalculateSLFromRR(
        signal.entryPrice,
        tpTargets[0],
        rr,
        side,
      );

      await logExecutorInfo(
        `📐 Auto-calculated SL from ${rr}RR using TP distance: entry=${signal.entryPrice}, TP=${tpTargets[0]} → SL=${autoSL}`,
        {
          accountId,
          processId: msg.processId,
          symbol: signal.symbol,
          action: "console_auto_sl_from_rr",
        },
      );
    }
  }

  if (
    tpTargets.length === 0 &&
    signal.entryPrice &&
    (signal.stopLoss || autoSL)
  ) {
    const rr =
      signal.defaultRR && signal.defaultRR > 0
        ? signal.defaultRR
        : riskCfg.defaultRR;

    if (rr > 0) {
      tpTargets = autoCalculateTPFromRR(
        signal.entryPrice,
        signal.stopLoss || autoSL!,
        rr,
        side,
      );

      await logExecutorInfo(
        `📐 Auto-calculated ${tpTargets.length} TP targets from ${rr}RR: [${tpTargets.join(", ")}]`,
        {
          accountId,
          processId: msg.processId,
          symbol: signal.symbol,
          action: "console_auto_tp_from_rr",
        },
      );
    }
  }

  return {
    accountId: accountId || null,
    processId: msg.processId || null,
    messageId: msg.messageId,
    channelId: msg.channelId,
    messageUrl: msg.messageUrl,
    author: msg.author,
    originalContent: resolveOriginalContent(msg),
    imageUrls: msg.imageUrls,
    signalData: JSON.stringify(signal),
    action: signal.action,
    symbol: signal.symbol,
    side,
    entryPrice: signal.entryPrice || null,
    takeProfitTargets: tpTargets,
    stopLoss: signal.stopLoss || autoSL || null,
    leverage: sanitizeLeverage(signal.leverage) || riskCfg.defaultLeverage,
    quantity,
    confidence: signal.confidence || 0,
    reasoning: signal.reasoning || "",
    sourceTimestamp: msg.timestamp || null,
  };
}

export function summarizeExecutionForDraft(
  execution: SignalExecutionResult,
): DraftExecutionOutcome {
  if (execution.type === "opened") {
    return {
      status: "accepted",
      result: "executed",
      positionId: execution.position._id.toString(),
    };
  }

  if (execution.type === "updated") {
    return {
      status: "accepted",
      result: "updated",
      message: execution.details,
    };
  }

  if (execution.type === "closed") {
    return {
      status: "accepted",
      result: "updated",
      message: `Closed ${execution.closedCount} position(s)`,
    };
  }

  if (execution.type === "noop") {
    return {
      status: "accepted",
      result: "noop",
      message: execution.details,
    };
  }

  return {
    status: "rejected",
    result: "rejected",
    message: execution.reason,
    error: execution.reason,
  };
}

export async function resolveDraftWithExecution(
  draft: DraftDocument,
  execution: SignalExecutionResult,
): Promise<DraftExecutionOutcome> {
  const outcome = summarizeExecutionForDraft(execution);
  draft.status = outcome.status;
  draft.resolvedAt = new Date();
  draft.positionId = outcome.positionId || undefined;
  await draft.save();
  return outcome;
}

export async function rejectDraftWithReason(
  draft: DraftDocument,
  reason: string,
): Promise<DraftExecutionOutcome> {
  draft.status = "rejected";
  draft.resolvedAt = new Date();
  await draft.save();

  return {
    status: "rejected",
    result: "rejected",
    message: reason,
    error: reason,
  };
}

export async function createDraft(
  signal: TradingSignal,
  msg: DraftSourceMessage,
  accountId?: string,
): Promise<DraftDocument> {
  const payload = await buildDraftPayload(signal, msg, accountId);
  const draft = await DraftTrade.create({
    ...payload,
    status: "pending",
  });

  await logExecutorInfo(
    `📝 Created draft: ${signal.action} ${signal.symbol} — sourceTimestamp: ${msg.timestamp}`,
    {
      accountId,
      processId: payload.processId,
      symbol: signal.symbol,
      action: "console_draft_created",
    },
  );

  if (payload.processId) {
    await logProcessStep({
      accountId,
      processId: payload.processId,
      type: "draft_process",
      action: "draft_created",
      symbol: signal.symbol,
      details: {
        draftId: draft._id.toString(),
        messageId: msg.messageId,
        draftStatus: "pending",
      },
      result: "drafted",
    });
  }

  return draft;
}

export async function refreshDraftFromSignal(
  draft: DraftDocument,
  signal: TradingSignal,
  msg: DraftSourceMessage,
): Promise<DraftDocument> {
  const payload = await buildDraftPayload(signal, msg, draft.accountId || undefined);
  Object.assign(draft, payload);
  await draft.save();

  if (payload.processId) {
    await logProcessStep({
      accountId: draft.accountId || undefined,
      processId: payload.processId,
      type: "draft_process",
      action: "draft_refreshed",
      symbol: signal.symbol,
      details: {
        draftId: draft._id.toString(),
        messageId: msg.messageId,
      },
      result: "drafted",
    });
  }

  return draft;
}
