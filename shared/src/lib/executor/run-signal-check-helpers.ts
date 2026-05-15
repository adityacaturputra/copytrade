import {
  Account,
  DraftTrade,
  IDraftTrade,
  ProcessedMessage,
} from "../database/index";
import { BaseSourceMessage } from "../source/types";
import { SourceFactory } from "../source/SourceFactory";
import {
  createTradeProcessId,
  logExecutorError,
  logExecutorInfo,
  logExecutorWarn,
  logProcessStep,
} from "../process/log";
import {
  createDraft,
  refreshDraftFromSignal,
  rejectDraftWithReason,
  resolveDraftWithExecution,
} from "./drafts";
import { analyzeMessagesWithAI } from "./ai";
import { executeSignal } from "./execute-signal";
import type { ProcessTrackedMessage } from "./types";

export async function loadProcessedMessages() {
  const processedDocs = await ProcessedMessage.find({}, { messageId: 1, accountId: 1 }).lean();
  const processedByAccount = new Map<string, Set<string>>();
  const allProcessedIds = new Set<string>();
  for (const doc of processedDocs) {
    const accountId = doc.accountId?.toString() || "null";
    if (!processedByAccount.has(accountId)) processedByAccount.set(accountId, new Set());
    processedByAccount.get(accountId)!.add(doc.messageId);
    allProcessedIds.add(doc.messageId);
  }
  return { processedByAccount, allProcessedIds };
}

export async function fetchMessagesForActiveAccounts({
  processedByAccount,
  fetchLimit,
  timeWindowHours,
  result,
}: {
  processedByAccount: Map<string, Set<string>>;
  fetchLimit: number;
  timeWindowHours: number;
  result: { errors: string[]; sources: { name: string; channels: number; healthy: boolean }[] };
}) {
  let allMessages: BaseSourceMessage[] = [];
  const activeAccounts = await Account.find({ isActive: true }).sort({ createdAt: 1 }).lean();

  if (!activeAccounts?.length) {
    await logExecutorInfo("⚠️ No active accounts configured — skipping message fetch", { level: "debug" });
    return allMessages;
  }

  await logExecutorInfo(`📡 Found ${activeAccounts.length} active accounts, fetching messages...`, { level: "debug" });

  for (const account of activeAccounts) {
    const disabledSet = new Set(account.disabledChannelIds || []);
    const activeChannelIds = account.channelIds.filter((id: string) => !disabledSet.has(id));

    if (activeChannelIds.length === 0) {
      await logExecutorInfo(`⏭️ Account "${account.name}": all channels disabled, skipping`, {
        accountId: account._id.toString(),
        level: "debug",
      });
      result.sources.push({ name: account.name, channels: account.channelIds.length, healthy: true });
      continue;
    }

    try {
      const provider = SourceFactory.getProvider(account.sourceType);
      const config = {
        _id: account._id.toString(),
        name: account.name,
        type: account.sourceType,
        channelIds: activeChannelIds,
        ...((account.sourceData as Record<string, unknown>) || {}),
      };
      const messages = await provider.fetchMessages(
        config,
        fetchLimit,
        timeWindowHours,
        processedByAccount.get(account._id.toString()) || new Set<string>(),
      );

      for (const message of messages) {
        if (!message.sourceId) message.sourceId = account._id.toString();
        if (!message.sourceName) message.sourceName = account.name;
      }

      allMessages = allMessages.concat(messages);
      await Account.findByIdAndUpdate(account._id, { lastFetchedAt: new Date(), lastError: null });
      result.sources.push({ name: account.name, channels: account.channelIds.length, healthy: true });

      await logExecutorInfo(
        `📡 Account "${account.name}" (${account.sourceType}): fetched ${messages.length} messages from ${activeChannelIds.length} channels`,
        { accountId: account._id.toString(), level: "debug" },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown source error";
      result.errors.push(`Account "${account.name}": ${errMsg}`);
      result.sources.push({ name: account.name, channels: account.channelIds.length, healthy: false });
      await Account.findByIdAndUpdate(account._id, { lastError: errMsg });
      await logExecutorWarn(`❌ Account "${account.name}" error: ${errMsg}`, {
        accountId: account._id.toString(),
        action: "console_source_fetch_failed",
      });
    }
  }

  return allMessages;
}

export async function processTrackedMessages({
  messages,
  mode,
  result,
}: {
  messages: ProcessTrackedMessage[];
  mode: string;
  result: { checked: number; newSignals: number; executed: number; drafted: number; errors: string[] };
}) {
  for (const msg of messages) {
    result.checked++;
    try {
      const batchResults = await analyzeMessagesWithAI([msg]);
      const batchResult = batchResults[0];

      if (!batchResult?.signal) {
        await ProcessedMessage.updateOne(
          { messageId: msg.messageId, accountId: msg.sourceId || null },
          { status: batchResult?.parseError ? "failed" : "ignored", processedAt: new Date() },
          { upsert: true },
        );
        continue;
      }

      const signal = batchResult.signal;
      result.newSignals++;
      msg.processId = createTradeProcessId(msg.messageId);

      await logProcessStep({
        accountId: msg.sourceId,
        processId: msg.processId,
        type: "draft_process",
        action: "signal_detected",
        symbol: signal.symbol,
        details: { messageId: msg.messageId, action: signal.action, tradingMode: mode },
        result: "processed",
      });

      if (mode === "auto") {
        await processAutoMode(msg, signal, result);
      } else {
        await createDraft(signal, msg, msg.sourceId);
        result.drafted++;
        await ProcessedMessage.updateOne(
          { messageId: msg.messageId, accountId: msg.sourceId || null },
          { status: "drafted", processedAt: new Date() },
        );
        await logProcessStep({
          accountId: msg.sourceId,
          processId: msg.processId,
          type: "draft_process",
          action: "manual_draft_ready",
          symbol: signal.symbol,
          details: { messageId: msg.messageId, action: signal.action },
          result: "drafted",
        });
      }
    } catch (error) {
      await handleProcessMessageError(msg, error, result);
    }
  }
}

async function processAutoMode(
  msg: ProcessTrackedMessage,
  signal: NonNullable<Awaited<ReturnType<typeof analyzeMessagesWithAI>>[number]["signal"]>,
  result: { executed: number },
) {
  const autoDraft = await createDraft(signal, msg, msg.sourceId);
  const execution = await executeSignal(signal, msg.messageId, msg.channelId, msg.sourceName, msg.sourceId, msg.processId);
  const draftOutcome = await resolveDraftWithExecution(autoDraft, execution);

  await ProcessedMessage.updateOne(
    { messageId: msg.messageId, accountId: msg.sourceId || null },
    { status: draftOutcome.status === "accepted" ? "executed" : "failed", processedAt: new Date() },
  );

  if (draftOutcome.status === "accepted") result.executed++;

  await logProcessStep({
    accountId: msg.sourceId,
    processId: msg.processId,
    type: "draft_process",
    action: "auto_execution_completed",
    symbol: signal.symbol,
    details: {
      messageId: msg.messageId,
      draftId: autoDraft._id.toString(),
      outcome: draftOutcome.result,
      status: draftOutcome.status,
    },
    result: draftOutcome.result,
    error: draftOutcome.error,
  });
}

async function handleProcessMessageError(
  msg: ProcessTrackedMessage,
  error: unknown,
  result: { errors: string[] },
) {
  const errMsg = error instanceof Error ? error.message : "Unknown error";
  result.errors.push(`Message ${msg.messageId}: ${errMsg}`);
  await ProcessedMessage.updateOne(
    { messageId: msg.messageId, accountId: msg.sourceId || null },
    { status: "failed", processedAt: new Date() },
  );

  const autoDraft = await DraftTrade.findOne({
    accountId: msg.sourceId || null,
    messageId: msg.messageId,
    status: "pending",
  });
  if (autoDraft) await rejectDraftWithReason(autoDraft, errMsg);

  await logProcessStep({
    accountId: msg.sourceId,
    processId: msg.processId,
    type: "draft_process",
    action: "process_failed",
    details: msg.content,
    result: "failed",
    error: errMsg,
  });

  await logExecutorError(`Error processing message ${msg.messageId}: ${errMsg}`, {
    accountId: msg.sourceId,
    processId: msg.processId,
    action: "console_process_error",
  });
}
