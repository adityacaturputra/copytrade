import {
  connectDB,
  ProcessedMessage,
  Position,
  DraftTrade,
  Account,
  getTradingMode,
  IDraftTrade,
  IPosition,
  buildTPTargets,
  recalculateTPAllocation,
} from "./database";
import { BaseSourceMessage } from "./source/types";
import { SourceFactory } from "./source/SourceFactory";
import { TradingSignal } from "./ai/types";
import {
  ExchangeFactory,
  ExchangeCredentials,
  buildExchangeCredentials,
} from "./exchange/ExchangeFactory";
import {
  calculateRiskBasedPosition,
  getRiskConfig,
  resolveEffectiveRiskConfig,
} from "./risk";
import { getSignalConfig } from "./signal-config";
import {
  createTradeProcessId,
  logExecutorError,
  logExecutorInfo,
  logExecutorWarn,
  logProcessStep,
} from "./process-log";
import { analyzeMessagesWithAI } from "./executor-ai";
import {
  createDraft,
  refreshDraftFromSignal,
  rejectDraftWithReason,
  resolveDraftWithExecution,
} from "./executor-drafts";
import {
  autoCalculateTPFromRR,
  autoCalculateSLFromRR,
  sanitizeLeverage,
} from "./executor-signal-utils";
import type {
  DuplicateCheckResult,
  ExecuteTradeInput,
  ProcessTrackedMessage,
  SignalExecutionResult,
} from "./executor-types";

export { analyzeMessagesWithAI } from "./executor-ai";
export {
  createDraft,
  refreshDraftFromSignal,
  rejectDraftWithReason,
  resolveDraftWithExecution,
  summarizeExecutionForDraft,
} from "./executor-drafts";
export { autoCalculateTPFromRR } from "./executor-signal-utils";
export type {
  DraftExecutionOutcome,
  DuplicateCheckResult,
  ExecuteTradeInput,
  MessageAnalysisResult,
  SignalExecutionResult,
} from "./executor-types";

/**
 * Split a total quantity evenly across multiple TP levels,
 * respecting the exchange's lot size and quantity decimals.
 *
 * Each allocation is rounded down to the nearest lotSz multiple,
 * and the last level gets the remainder so the total is exact.
 *
 * @param totalQty  - Total filled quantity to split
 * @param numLevels - Number of TP levels
 * @param getSpecs  - Async function returning instrument specs (lotSz, qtyDecimals)
 * @returns Array of quantities, one per TP level
 */
export async function splitQuantityForTPs(
  totalQty: number,
  numLevels: number,
  getSpecs: () => Promise<{ lotSz: number; qtyDecimals: number }>,
): Promise<number[]> {
  if (numLevels <= 0) return [];
  if (numLevels === 1) return [totalQty];

  let lotSz = 1;
  let qtyDecimals = 4;
  try {
    const specs = await getSpecs();
    lotSz = specs.lotSz;
    qtyDecimals = specs.qtyDecimals;
  } catch {
    // Fallback to defaults
  }

  const mult = Math.pow(10, qtyDecimals);
  const totalUnits = Math.round(totalQty * mult);
  const lotUnits = Math.max(1, Math.round(lotSz * mult));
  const baseLotUnits =
    Math.floor(Math.floor(totalUnits / numLevels) / lotUnits) * lotUnits;

  const quantities: number[] = [];
  let allocated = 0;

  for (let i = 0; i < numLevels; i++) {
    if (i === numLevels - 1) {
      quantities.push((totalUnits - allocated) / mult);
    } else {
      quantities.push(baseLotUnits / mult);
      allocated += baseLotUnits;
    }
  }

  await logExecutorInfo(
    `📊 TP qty split (lotSz=${lotSz}, qtyDecimals=${qtyDecimals}): [${quantities.map((q) => q.toFixed(qtyDecimals)).join(", ")}] total=${quantities.reduce((a, b) => a + b, 0).toFixed(qtyDecimals)} (filledQty=${totalQty.toFixed(qtyDecimals)})`,
  );

  return quantities;
}

export async function runSignalCheck(): Promise<{
  checked: number;
  newSignals: number;
  executed: number;
  drafted: number;
  errors: string[];
  sources: { name: string; channels: number; healthy: boolean }[];
}> {
  await connectDB();

  const result = {
    checked: 0,
    newSignals: 0,
    executed: 0,
    drafted: 0,
    errors: [] as string[],
    sources: [] as { name: string; channels: number; healthy: boolean }[],
  };

  try {
    // 1. Get trading mode
    const mode = await getTradingMode();
    await logExecutorInfo(`🔧 Trading mode: ${mode}`, { level: "debug" });

    // 2. Get signal config (fetchLimit = page size, timeWindowHours)
    const signalConfig = await getSignalConfig();
    await logExecutorInfo(
      `🔧 Signal config: pageSize=${signalConfig.fetchLimit}, timeWindowHours=${signalConfig.timeWindowHours}`,
      { level: "debug" },
    );

    // 3. Load all processed message IDs from DB (for pagination stop condition)
    const processedDocs = await ProcessedMessage.find(
      {},
      { messageId: 1, accountId: 1 },
    ).lean();
    // Build per-account processed message sets so that the same messageId
    // can be processed by different accounts (they may share channels).
    const processedByAccount = new Map<string, Set<string>>();
    const allProcessedIds = new Set<string>();
    for (const doc of processedDocs) {
      const aid = doc.accountId?.toString() || "null";
      if (!processedByAccount.has(aid)) processedByAccount.set(aid, new Set());
      processedByAccount.get(aid)!.add(doc.messageId);
      allProcessedIds.add(doc.messageId);
    }
    await logExecutorInfo(
      `📦 Found ${allProcessedIds.size} previously processed messages in DB (${processedByAccount.size} accounts)`,
      { level: "debug" },
    );

    // 4. Fetch messages from all active accounts via SourceFactory
    let allMessages: BaseSourceMessage[] = [];

    const activeAccounts = await Account.find({ isActive: true })
      .sort({ createdAt: 1 })
      .lean();

    if (!activeAccounts || activeAccounts.length === 0) {
      await logExecutorInfo(
        "⚠️ No active accounts configured — skipping message fetch",
        { level: "debug" },
      );
    } else {
      await logExecutorInfo(
        `📡 Found ${activeAccounts.length} active accounts, fetching messages...`,
        { level: "debug" },
      );

      for (const account of activeAccounts) {
        // Filter out disabled channels
        const disabledSet = new Set(account.disabledChannelIds || []);
        const activeChannelIds = account.channelIds.filter(
          (id: string) => !disabledSet.has(id),
        );

        if (activeChannelIds.length === 0) {
          await logExecutorInfo(
            `⏭️ Account "${account.name}": all channels disabled, skipping`,
            {
              accountId: account._id.toString(),
              level: "debug",
            },
          );
          result.sources.push({
            name: account.name,
            channels: account.channelIds.length,
            healthy: true,
          });
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

          // Use per-account processed set so the same messageId can be
          // fetched/processed by different accounts that share channels.
          const perAccountProcessed =
            processedByAccount.get(account._id.toString()) || new Set<string>();
          const messages = await provider.fetchMessages(
            config,
            signalConfig.fetchLimit,
            signalConfig.timeWindowHours,
            perAccountProcessed,
          );

          // Ensure sourceId/sourceName are set
          for (const m of messages) {
            if (!m.sourceId) m.sourceId = account._id.toString();
            if (!m.sourceName) m.sourceName = account.name;
          }

          allMessages = allMessages.concat(messages);

          // Update account health
          await Account.findByIdAndUpdate(account._id, {
            lastFetchedAt: new Date(),
            lastError: null,
          });

          result.sources.push({
            name: account.name,
            channels: account.channelIds.length,
            healthy: true,
          });

          await logExecutorInfo(
            `📡 Account "${account.name}" (${account.sourceType}): fetched ${messages.length} messages from ${activeChannelIds.length} channels`,
            {
              accountId: account._id.toString(),
              level: "debug",
            },
          );
        } catch (error) {
          const errMsg =
            error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Account "${account.name}": ${errMsg}`);
          result.sources.push({
            name: account.name,
            channels: account.channelIds.length,
            healthy: false,
          });

          await Account.findByIdAndUpdate(account._id, {
            lastError: errMsg,
          });

          await logExecutorError(`❌ Account "${account.name}" error: ${errMsg}`, {
            accountId: account._id.toString(),
          });
        }
      }
    }

    result.checked = allMessages.length;
    await logExecutorInfo(`📡 Total messages fetched: ${allMessages.length}`, {
      level: "debug",
    });

    // Sort ASCENDING (oldest first) for processing — so signals are
    // handled in chronological order.  Discord snowflake IDs are
    // lexicographically sortable by time.
    allMessages.sort((a, b) => {
      const channelCompare = a.channelId.localeCompare(b.channelId);
      if (channelCompare !== 0) return channelCompare;
      return a.messageId.localeCompare(b.messageId);
    });

    // ─── Bulk processing ────────────────────────────────────────────────────
    // Filter out already-processed messages using (messageId, accountId) pair
    // so the same messageId can be processed independently by different accounts.
    const existingProcessed = await ProcessedMessage.find(
      {
        $or: allMessages.map((m) => ({
          messageId: m.messageId,
          accountId: m.sourceId || null,
        })),
      },
      { messageId: 1, accountId: 1 },
    ).lean();
    const existingKeys = new Set(
      existingProcessed.map(
        (d) => `${d.messageId}::${d.accountId?.toString() || "null"}`,
      ),
    );
    const newMessages: ProcessTrackedMessage[] = allMessages
      .filter((m) => !existingKeys.has(`${m.messageId}::${m.sourceId || "null"}`))
      .map((msg) => ({
        ...msg,
        processId: createTradeProcessId("draftproc"),
      }));

    if (newMessages.length === 0) {
      await logExecutorInfo("📭 No new messages to process", {
        level: "debug",
      });
    } else {
      await logExecutorInfo(
        `📨 ${newMessages.length} new messages to process (bulk batchSize=${signalConfig.batchSize})`,
      );

      // Bulk-create pending messages. Ignore duplicate-key races so
      // parallel signal-check runs won't fail the entire cycle.
      try {
        await ProcessedMessage.insertMany(
          newMessages.map((msg) => ({
            accountId: msg.sourceId || null,
            processId: msg.processId || null,
            messageId: msg.messageId,
            channelId: msg.channelId,
            author: msg.author,
            content: msg.content,
            signalType: null,
            parsedSignal: null,
            status: "pending" as const,
            sourceTimestamp: msg.timestamp || null,
          })),
          { ordered: false },
        );
      } catch (error) {
        const isDuplicateKey =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: number }).code === 11000;
        if (!isDuplicateKey) throw error;
        await logExecutorWarn(
          "⚠️ Duplicate processed message keys detected during insertMany; continuing with existing records",
        );
      }

      await Promise.all(
        newMessages.map((msg) =>
          logProcessStep({
            accountId: msg.sourceId,
            processId: msg.processId,
            type: "draft_process",
            action: "message_fetched",
            details: {
              messageId: msg.messageId,
              channelId: msg.channelId,
              author: msg.author,
              sourceName: msg.sourceName || null,
              timestamp: msg.timestamp || null,
              imageCount: msg.imageUrls?.length || 0,
            },
            result: "fetched",
          }),
        ),
      );

      const batchSize = signalConfig.batchSize || 5;

      for (let i = 0; i < newMessages.length; i += batchSize) {
        const batch = newMessages.slice(i, i + batchSize);
        const batchResults = await analyzeMessagesWithAI(batch);

        // Build a lookup map from messageId → original Discord message
        const msgLookup = new Map<string, (typeof batch)[number]>();
        for (const m of batch) {
          msgLookup.set(m.messageId, m);
        }

        // Process each result in the batch — map by messageId
        for (const { messageId: resultMsgId, signal, parseError } of batchResults) {
          const msg = msgLookup.get(resultMsgId);
          if (!msg) continue;

          // Attach messageId and rawSignal to signal for downstream use
          if (signal) {
            signal.messageId = msg.messageId;
            signal.rawSignal = msg.originalContent || msg.content;
          }

          try {
            if (parseError) {
              const errMsg = `AI parse failed: ${parseError}`;
              result.errors.push(`Message ${msg.messageId}: ${errMsg}`);

              await ProcessedMessage.updateOne(
                {
                  messageId: msg.messageId,
                  accountId: msg.sourceId || null,
                },
                { status: "failed", processedAt: new Date() },
              );

              await logProcessStep({
                accountId: msg.sourceId,
                processId: msg.processId,
                type: "draft_process",
                action: "message_parse_failed",
                details: msg.content,
                result: "parse_failed",
                error: parseError,
              });

              await logExecutorError(
                `Error parsing message ${msg.messageId}: ${parseError}`,
                {
                  accountId: msg.sourceId,
                  processId: msg.processId,
                  action: "console_parse_error",
                },
              );
              continue;
            }

            if (!signal || !signal.action || signal.action === "HOLD") {
              await ProcessedMessage.updateOne(
                {
                  messageId: msg.messageId,
                  accountId: msg.sourceId || null,
                },
                { status: "ignored", processedAt: new Date() },
              );

              await logProcessStep({
                accountId: msg.sourceId,
                processId: msg.processId,
                type: "draft_process",
                action: "message_ignored",
                details: {
                  messageId: msg.messageId,
                  reason: "No actionable trading signal detected",
                },
                result: "ignored",
              });
              continue;
            }

            // Check for cancel requests on previously drafted signals
            if (signal.action === "CANCEL" && signal.symbol) {
              await logExecutorInfo(
                `🚫 Cancel request detected for ${signal.symbol} from ${msg.author}`,
                {
                  accountId: msg.sourceId,
                  processId: msg.processId,
                  symbol: signal.symbol,
                },
              );

              const draftsToCancel = await DraftTrade.find({
                symbol: signal.symbol,
                status: "pending",
              });

              for (const pendingDraft of draftsToCancel) {
                pendingDraft.status = "rejected";
                pendingDraft.resolvedAt = new Date();
                await pendingDraft.save();

                await logProcessStep({
                  accountId: pendingDraft.accountId || undefined,
                  processId: pendingDraft.processId || undefined,
                  type: "draft_process",
                  action: "draft_rejected_by_cancel_signal",
                  symbol: pendingDraft.symbol,
                  details: {
                    draftId: pendingDraft._id.toString(),
                    cancelMessageId: msg.messageId,
                    author: msg.author,
                  },
                  result: "rejected",
                });
              }

              if (draftsToCancel.length > 0) {
                await logExecutorInfo(
                  `🚫 Cancelled ${draftsToCancel.length} pending draft(s) for ${signal.symbol}`,
                  {
                    accountId: msg.sourceId,
                    processId: msg.processId,
                    symbol: signal.symbol,
                  },
                );
              }

              await ProcessedMessage.updateOne(
                {
                  messageId: msg.messageId,
                  accountId: msg.sourceId || null,
                },
                {
                  signalType: "CANCEL",
                  parsedSignal: JSON.stringify(signal),
                  status: "processed",
                  processedAt: new Date(),
                },
              );

              await logProcessStep({
                accountId: msg.sourceId,
                processId: msg.processId,
                type: "draft_process",
                action: "cancel_request",
                symbol: signal.symbol,
                details: `Cancel request from ${msg.author}: ${signal.reasoning || "no reason provided"}. ${draftsToCancel.length} draft(s) cancelled.`,
                result:
                  draftsToCancel.length > 0
                    ? "cancelled_drafts"
                    : "no_pending_drafts",
              });

              // In auto mode, also close open positions if requested
              if (mode === "auto") {
                const openPositions = await Position.find({
                  symbol: signal.symbol,
                  status: "open",
                });

                if (openPositions.length > 0) {
                  for (const pos of openPositions) {
                    try {
                      // Resolve exchange for this position's account
                      const posExchange = await (async () => {
                        if (pos.accountId) {
                          const acct = await Account.findById(
                            pos.accountId,
                          ).lean();
                          if (acct?.exchangeData) {
                            const creds = buildExchangeCredentials(
                              acct.tradingPlatform,
                              (acct.exchangeData as Record<string, unknown>) ||
                                {},
                            );
                            if (creds) {
                              return ExchangeFactory.getClientForAccount(creds);
                            }
                          }
                        }
                        return ExchangeFactory.getPaperClient();
                      })();
                      await posExchange.closePosition(
                        pos.symbol,
                        pos.orderId,
                        pos.quantity,
                      );
                      pos.status = "closed";
                      pos.closedAt = new Date();
                      pos.closeReason = `Cancel request by ${msg.author}: ${signal.reasoning || "signal author requested cancellation"}`;
                      await pos.save();
                      await logExecutorInfo(
                        `🚫 Auto-cancelled position: ${pos.symbol} ${pos.side}`,
                        {
                          accountId: pos.accountId || msg.sourceId,
                          processId: msg.processId,
                          symbol: pos.symbol,
                        },
                      );
                    } catch (closeErr) {
                      await logExecutorWarn(
                        `⚠️ Failed to auto-close ${pos.symbol}: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`,
                        {
                          accountId: pos.accountId || msg.sourceId,
                          processId: msg.processId,
                          symbol: pos.symbol,
                        },
                      );
                    }
                  }
                }
              }

              continue;
            }

            result.newSignals++;

            // Update message with parsed signal
            await ProcessedMessage.updateOne(
              {
                messageId: msg.messageId,
                accountId: msg.sourceId || null,
              },
              {
                signalType: signal.action,
                parsedSignal: JSON.stringify(signal),
                status: "processed",
                processedAt: new Date(),
              },
            );

            await logProcessStep({
              accountId: msg.sourceId,
              processId: msg.processId,
              type: "draft_process",
              action: "signal_detected",
              symbol: signal.symbol,
              details: {
                messageId: msg.messageId,
                action: signal.action,
                tradingMode: mode,
              },
              result: "processed",
            });

            let autoDraft: IDraftTrade | null = null;

            // Execute or draft based on trading mode
            if (mode === "auto") {
              autoDraft = await createDraft(signal, msg, msg.sourceId);
              const execution = await executeSignal(
                signal,
                msg.messageId,
                msg.channelId,
                msg.sourceName,
                msg.sourceId,
                msg.processId,
              );
              const draftOutcome = await resolveDraftWithExecution(
                autoDraft,
                execution,
              );

              await ProcessedMessage.updateOne(
                {
                  messageId: msg.messageId,
                  accountId: msg.sourceId || null,
                },
                {
                  status:
                    draftOutcome.status === "accepted" ? "executed" : "failed",
                  processedAt: new Date(),
                },
              );

              if (draftOutcome.status === "accepted") {
                result.executed++;
              }

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
            } else {
              // Manual mode: create a draft for user review
              await createDraft(signal, msg, msg.sourceId);
              result.drafted++;

              await ProcessedMessage.updateOne(
                {
                  messageId: msg.messageId,
                  accountId: msg.sourceId || null,
                },
                { status: "drafted", processedAt: new Date() },
              );

              await logProcessStep({
                accountId: msg.sourceId,
                processId: msg.processId,
                type: "draft_process",
                action: "manual_draft_ready",
                symbol: signal.symbol,
                details: {
                  messageId: msg.messageId,
                  action: signal.action,
                },
                result: "drafted",
              });
            }
          } catch (error) {
            const errMsg =
              error instanceof Error ? error.message : "Unknown error";
            result.errors.push(`Message ${msg.messageId}: ${errMsg}`);

            await ProcessedMessage.updateOne(
              {
                messageId: msg.messageId,
                accountId: msg.sourceId || null,
              },
              { status: "failed", processedAt: new Date() },
            );

            const autoDraft = await DraftTrade.findOne({
              accountId: msg.sourceId || null,
              messageId: msg.messageId,
              status: "pending",
            });
            if (autoDraft) {
              await rejectDraftWithReason(autoDraft, errMsg);
            }

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
        } // end for batchResults
      } // end for batch
    } // end else (newMessages > 0)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`General: ${errMsg}`);
    await logExecutorError(`Signal check error: ${errMsg}`, {
      action: "console_signal_check_error",
    });
  }

  await logExecutorInfo(
    `✅ Signal check complete: ${result.checked} checked, ${result.newSignals} signals, ${result.executed} executed, ${result.drafted} drafted`,
    { level: "debug" },
  );
  return result;
}


/**
 * Check for duplicate open positions (same symbol + side + channel).
 * Shared by both auto (executeSignal) and manual (accept) paths.
 */
export async function checkDuplicatePosition(
  symbol: string,
  side: "LONG" | "SHORT",
  channelId: string | undefined,
  entryPrice: number | null | undefined,
  takeProfitTargets: number[],
  stopLoss: number | null | undefined,
): Promise<DuplicateCheckResult> {
  const existingPos = await Position.findOne({
    symbol,
    side,
    channelId: channelId || null,
    status: "open",
  });

  if (!existingPos) return { type: "new" };

  const newTP = takeProfitTargets?.[0] ?? null;
  const newSL = stopLoss ?? null;
  const existingTP = existingPos.takeProfitTargets?.[0]?.price ?? null;
  const existingSL = existingPos.stopLossPrice ?? null;
  const existingEntry = existingPos.entryPrice ?? null;
  const newEntry = entryPrice ?? null;

  const numEqual = (
    a: number | null | undefined,
    b: number | null | undefined,
  ) => {
    if ((a === null || a === undefined) && (b === null || b === undefined))
      return true;
    if (a === null || a === undefined || b === null || b === undefined)
      return false;
    return Math.abs(a - b) < 0.01;
  };

  // null entry from same channel = referring to existing position
  const entryMatch =
    newEntry === null ? true : numEqual(newEntry, existingEntry);
  const tpMatch = numEqual(newTP, existingTP);
  const slMatch = numEqual(newSL, existingSL);

  if (entryMatch && tpMatch && slMatch) {
    return { type: "duplicate_exact" };
  }

  if (entryMatch) {
    let updated = false;
    const updates: string[] = [];

    if (!tpMatch && newTP !== null) {
      const newTargets = buildTPTargets([newTP], existingPos.quantity);
      existingPos.takeProfitTargets = newTargets;
      updates.push(`TP: ${existingTP} → ${newTP}`);
      updated = true;
    }
    if (!slMatch && newSL !== null) {
      existingPos.stopLossPrice = newSL;
      updates.push(`SL: ${existingSL} → ${newSL}`);
      updated = true;
    }

    if (updated) {
      await existingPos.save();
      return { type: "duplicate_updated", updates };
    }
    return { type: "duplicate_no_update" };
  }

  // Different entry price — genuinely new signal
  return { type: "new" };
}

/**
 * Core trade execution — single source of truth for:
 *   Risk sizing → Set leverage → Place order → TP/SL → Save position
 *
 * Called by both `executeSignal` (auto mode) and `/api/drafts/[id]/accept` (manual mode).
 * Does NOT handle duplicate checks, max-positions, or skipNoSL — those are
 * the caller's responsibility.
 */
export async function executeTrade(
  input: ExecuteTradeInput,
): Promise<IPosition> {
  const {
    symbol,
    action,
    entryPrice,
    stopLoss,
    takeProfitTargets: tpTargets,
    leverage,
    quantity,
    orderType,
    channelId,
    messageId,
    sourceName,
    signalData,
    logPrefix = "",
    accountId,
    processId,
  } = input;

  const side = action === "SELL" ? ("SHORT" as const) : ("LONG" as const);
  const lp = logPrefix ? `${logPrefix} ` : "";

  // ─── Resolve exchange client (per-account or paper fallback) ────
  let exchange;
  if (accountId) {
    const account = await Account.findById(accountId).lean();
    if (account?.exchangeData) {
      const creds =
        buildExchangeCredentials(
          account.tradingPlatform,
          (account.exchangeData as Record<string, unknown>) || {},
        ) ||
        ({
          provider: "paper",
        } as ExchangeCredentials);
      exchange = ExchangeFactory.getClientForAccount(creds);
    } else {
      await logExecutorWarn(
        `${lp}⚠️ Account ${accountId} has no exchangeData, using paper exchange`,
        {
          accountId,
          processId,
          symbol,
          action: "console_exchange_fallback",
        },
      );
      exchange = ExchangeFactory.getPaperClient();
    }
  } else {
    await logExecutorWarn(`${lp}⚠️ No accountId provided, using paper exchange`, {
      processId,
      symbol,
      action: "console_exchange_fallback",
    });
    exchange = ExchangeFactory.getPaperClient();
  }

  // ─── Risk-Based Position Sizing ─────────────────────────────────
  let orderQuantity = quantity;
  let orderLeverage = leverage;
  let riskAccountBalance: number | undefined;
  let plannedMarginUsdt: number | undefined;

  try {
    const account = await exchange.getAccountInfo();
    riskAccountBalance = account.availableBalance || account.totalBalance;
    await logExecutorInfo(
      `${lp}💰 Risk balance source (${exchange.name}): $${riskAccountBalance.toFixed(2)}`,
      {
        accountId,
        processId,
        symbol,
        action: "console_risk_balance",
      },
    );
  } catch (balanceErr) {
    await logExecutorWarn(
      `${lp}⚠️ Failed to fetch account balance for risk sizing: ${balanceErr instanceof Error ? balanceErr.message : String(balanceErr)}`,
      {
        accountId,
        processId,
        symbol,
        action: "console_risk_balance_failed",
      },
    );
  }

  if (entryPrice && entryPrice > 0 && stopLoss) {
    const riskCalc = await calculateRiskBasedPosition(
      entryPrice,
      stopLoss,
      side,
      quantity,
      leverage,
      riskAccountBalance,
      {
        accountId,
        channelId,
      },
    );

    if (riskCalc.applied) {
      const originalOrderQuantity = orderQuantity;
      const originalOrderLeverage = orderLeverage;
      orderQuantity = riskCalc.quantity;
      orderLeverage = riskCalc.leverage;
      plannedMarginUsdt = riskCalc.marginUsdt;
      await logExecutorInfo(
        `${lp}🛡️ Risk management applied: qty=${originalOrderQuantity.toFixed(6)} → ${orderQuantity.toFixed(6)}, leverage=${originalOrderLeverage} → ${orderLeverage}`,
        {
          accountId,
          processId,
          symbol,
          action: "console_risk_applied",
        },
      );
      await logExecutorInfo(
        `${lp}🛡️ Risk details: balance=$${riskCalc.accountBalance.toFixed(2)}, margin=$${riskCalc.marginUsdt.toFixed(2)}, slDist=${(riskCalc.slDistancePercent * 100).toFixed(2)}%, notional=$${riskCalc.notionalSize.toFixed(2)}`,
        {
          accountId,
          processId,
          symbol,
          action: "console_risk_details",
        },
      );
    } else {
      await logExecutorWarn(
        `${lp}⚠️ Risk management skipped: ${riskCalc.skipReason}`,
        {
          accountId,
          processId,
          symbol,
          action: "console_risk_skipped",
        },
      );
    }
  } else if (!entryPrice || entryPrice <= 0) {
    await logExecutorWarn(
      `${lp}⚠️ Risk management skipped: no entry price available`,
      {
        accountId,
        processId,
        symbol,
        action: "console_risk_skipped",
      },
    );
  }

  // ─── Place order via exchange ────────────────────────────────────

  // Set leverage before placing order
  try {
    orderLeverage = await exchange.setLeverage(symbol, orderLeverage);
  } catch (levErr) {
    await logExecutorWarn(
      `${lp}⚠️ Failed to set leverage (may already be set): ${levErr instanceof Error ? levErr.message : String(levErr)}`,
      {
        accountId,
        processId,
        symbol,
        action: "console_set_leverage_failed",
      },
    );
  }

  const orderSide = action === "BUY" ? "BUY" : "SELL";
  const closeSide = orderSide === "BUY" ? "SELL" : "BUY";

  await logExecutorInfo(
    `${lp}🔄 Placing ${orderType} ${action} order: symbol=${symbol}, qty=${orderQuantity}, leverage=${orderLeverage}${orderType === "LIMIT" ? `, price=${entryPrice}` : ""}`,
    {
      accountId,
      processId,
      symbol,
      action: "console_place_order",
    },
  );

  const orderResult = await exchange.placeOrder({
    symbol,
    side: orderSide,
    type: orderType,
    quantity: orderQuantity,
    price: orderType === "LIMIT" ? entryPrice : undefined,
    leverage: orderLeverage,
  });

  await logExecutorInfo(
    `${lp}✅ Order placed: orderId=${orderResult.orderId}, price=${orderResult.price}, qty=${orderResult.quantity}`,
    {
      accountId,
      processId,
      symbol,
      action: "console_order_placed",
    },
  );

  const filledQty = orderResult.quantity || orderQuantity;
  const effectiveEntryPrice = entryPrice || orderResult.price || 0;
  const estimatedMarginUsdt =
    orderLeverage > 0 && effectiveEntryPrice > 0
      ? (filledQty * effectiveEntryPrice) / orderLeverage
      : undefined;

  // ─── Place TP/SL via plan orders ────────────────────────────────
  // Only for MARKET orders. For LIMIT orders, deferred to tp-sl-monitor.
  if (orderType !== "LIMIT") {
    // Split quantity across TP levels using lot-size-aware rounding
    const tpQuantities = await splitQuantityForTPs(
      filledQty,
      tpTargets.length,
      () => exchange.getInstrumentSpecs(symbol),
    );

    for (let i = 0; i < tpTargets.length; i++) {
      const tp = tpTargets[i];
      const tpQty = tpQuantities[i];
      try {
        const tpId = await exchange.placeTakeProfit(
          symbol,
          tp,
          tp,
          closeSide,
          tpQty,
        );
        await logExecutorInfo(
          `${lp}🎯 Take Profit ${i + 1}/${tpTargets.length} set at ${tp} (qty: ${tpQty}/${filledQty}, plan order ${tpId})`,
          {
            accountId,
            processId,
            symbol,
            action: "console_take_profit_set",
          },
        );
      } catch (tpErr) {
        await logExecutorWarn(
          `${lp}⚠️ Failed to place TP at ${tp}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
          {
            accountId,
            processId,
            symbol,
            action: "console_take_profit_failed",
          },
        );
      }
    }

    if (stopLoss) {
      try {
        const slId = await exchange.placeStopLoss(
          symbol,
          stopLoss,
          stopLoss,
          closeSide,
          filledQty,
        );
        await logExecutorInfo(
          `${lp}🛑 Stop Loss set at ${stopLoss} (plan order ${slId})`,
          {
            accountId,
            processId,
            symbol,
            action: "console_stop_loss_set",
          },
        );
      } catch (slErr) {
        await logExecutorWarn(
          `${lp}⚠️ Failed to place SL: ${slErr instanceof Error ? slErr.message : String(slErr)}`,
          {
            accountId,
            processId,
            symbol,
            action: "console_stop_loss_failed",
          },
        );
      }
    }
  } else {
    await logExecutorInfo(
      `${lp}⏳ LIMIT order — skipping TP/SL placement. Will be placed by tp-sl-monitor after order fills.`,
      {
        accountId,
        processId,
        symbol,
        action: "console_limit_skip_tp_sl",
      },
    );
  }

  // ─── Save position to DB ────────────────────────────────────────
  const tpTargetObjects = buildTPTargets(tpTargets, filledQty);
  const positionStatus = orderType === "LIMIT" ? "pending" : "open";

  await logExecutorInfo(
    `${lp}💾 Saving position to database (status: ${positionStatus})...`,
    {
      accountId,
      processId,
      symbol,
      action: "console_save_position",
    },
  );

  const position = await Position.create({
    accountId: accountId || undefined,
    processId: processId || undefined,
    symbol,
    side,
    entryPrice: effectiveEntryPrice,
    quantity: filledQty,
    leverage: orderLeverage,
    marginType: "isolated",
    margin: plannedMarginUsdt ?? estimatedMarginUsdt,
    takeProfitTargets: tpTargetObjects,
    stopLossPrice: stopLoss || undefined,
    orderId: orderResult.orderId,
    status: positionStatus,
    tpSlPlaced: orderType !== "LIMIT",
    channelId: channelId || undefined,
    sourceName: sourceName || undefined,
    messageId: messageId || undefined,
    signalData,
  });

  await logExecutorInfo(
    `${lp}✅ ${orderType === "LIMIT" ? "Placed limit order for" : "Opened"} ${side} position: ${symbol} @ ${entryPrice || "market"} (status: ${positionStatus})`,
    {
      accountId,
      processId,
      symbol,
      action: "console_position_saved",
    },
  );
  return position;
}

export async function executeSignal(
  signal: TradingSignal,
  messageId: string,
  channelId?: string,
  sourceName?: string,
  accountId?: string,
  processId?: string,
): Promise<SignalExecutionResult> {
  const riskCfg = await resolveEffectiveRiskConfig({
    accountId,
    channelId,
  });
  const side = signal.action === "SELL" ? "SHORT" : "LONG";
  const leverage = sanitizeLeverage(signal.leverage) || riskCfg.defaultLeverage;
  const quantity = signal.positionSize || riskCfg.defaultPositionSize;
  const entryPrice = signal.entryPrice;

  switch (signal.action) {
    case "BUY":
    case "SELL": {
      // ─── Max positions check ─────────────────────────────────────────
      if (riskCfg.maxPositions > 0) {
        const openCount = await Position.countDocuments({
          status: { $in: ["open", "pending"] },
        });
        if (openCount >= riskCfg.maxPositions) {
          await logExecutorWarn(
            `🚫 Max positions reached (${openCount}/${riskCfg.maxPositions}) — skipping ${signal.action} ${signal.symbol}`,
            {
              accountId,
              processId,
              symbol: signal.symbol,
              action: "console_max_positions",
            },
          );
          await logProcessStep({
            accountId,
            processId,
            type: "draft_process",
            action: "execution_skipped_max_positions",
            symbol: signal.symbol,
            details: `Trade skipped: ${openCount} open positions, max is ${riskCfg.maxPositions}`,
            result: "skipped",
          });
          return {
            type: "skipped",
            code: "max_positions",
            reason: `Trade skipped: ${openCount} open positions, max is ${riskCfg.maxPositions}`,
          };
        }
      }

      // Check for duplicate open positions on same symbol+side+channel
      const existingPos = await Position.findOne({
        symbol: signal.symbol,
        side,
        channelId: channelId || null,
        status: "open",
      });

      if (existingPos) {
        // Compare entry, TP, and SL to decide: skip or update TP/SL only
        const newTP = signal.takeProfitTargets?.[0] ?? null;
        const newSL = signal.stopLoss ?? null;
        const existingTP = existingPos.takeProfitTargets?.[0]?.price ?? null;
        const existingSL = existingPos.stopLossPrice ?? null;
        const existingEntry = existingPos.entryPrice ?? null;
        const newEntry = entryPrice ?? null;

        // Helper: compare two numbers with tolerance for floating point
        const numEqual = (a: number | null, b: number | null) => {
          if (a === null && b === null) return true;
          if (a === null || b === null) return false;
          return Math.abs(a - b) < 0.01;
        };

        // null entry from same channel = referring to existing position
        const entryMatch =
          newEntry === null ? true : numEqual(newEntry, existingEntry);
        const tpMatch = numEqual(newTP, existingTP);
        const slMatch = numEqual(newSL, existingSL);

        if (entryMatch && tpMatch && slMatch) {
          // Exact duplicate: same symbol, side, entry, TP, SL — skip entirely
          await logExecutorInfo(
            `⚠️ Duplicate ${side} ${signal.symbol}: same entry=${existingEntry}, TP=${existingTP}, SL=${existingSL} — skipping`,
            {
              accountId,
              processId,
              symbol: signal.symbol,
              action: "console_duplicate_exact",
            },
          );
          await logProcessStep({
            accountId,
            processId,
            type: "draft_process",
            action: "execution_skipped_duplicate",
            symbol: signal.symbol,
            details: `Exact duplicate: open ${side} position exists with same entry=${existingEntry}, TP=${existingTP}, SL=${existingSL}`,
            result: "skipped",
          });
          return {
            type: "skipped",
            code: "duplicate_exact",
            reason: `Exact duplicate: open ${side} position exists with same entry=${existingEntry}, TP=${existingTP}, SL=${existingSL}`,
          };
        }

        // Entry matches but TP or SL changed — update only the TP/SL
        if (entryMatch) {
          let updated = false;
          const updates: string[] = [];

          if (!tpMatch && newTP !== null) {
            const newTargets = buildTPTargets([newTP], existingPos.quantity);
            existingPos.takeProfitTargets = newTargets;
            updates.push(`TP: ${existingTP} → ${newTP}`);
            updated = true;
          }
          if (!slMatch && newSL !== null) {
            existingPos.stopLossPrice = newSL;
            updates.push(`SL: ${existingSL} → ${newSL}`);
            updated = true;
          }

          if (updated) {
            await existingPos.save();
            await logExecutorInfo(
              `🔄 Updated ${side} ${signal.symbol} TP/SL: ${updates.join(", ")}`,
              {
                accountId,
                processId,
                symbol: signal.symbol,
                action: "console_duplicate_updated",
              },
            );
            await logProcessStep({
              accountId,
              processId,
              type: "draft_process",
              action: "execution_updated_tp_sl",
              symbol: signal.symbol,
              details: `Existing position TP/SL updated instead of opening duplicate: ${updates.join(", ")}`,
              result: "updated",
            });
            return {
              type: "updated",
              code: "updated_tp_sl",
              details: updates.join(", "),
            };
          } else {
            await logExecutorInfo(
              `⚠️ Duplicate ${side} ${signal.symbol}: entry matches but no new TP/SL values to update — skipping`,
              {
                accountId,
                processId,
                symbol: signal.symbol,
                action: "console_duplicate_no_update",
              },
            );
            await logProcessStep({
              accountId,
              processId,
              type: "draft_process",
              action: "execution_skipped_duplicate",
              symbol: signal.symbol,
              details: `Open ${side} position exists with same entry but no valid TP/SL update provided`,
              result: "skipped",
            });
            return {
              type: "skipped",
              code: "duplicate_no_update",
              reason: `Open ${side} position exists with same entry but no valid TP/SL update provided`,
            };
          }
        }

        // Different entry price — this is a genuinely new signal, don't block it
        // (the exchange may reject it anyway if hedging is not enabled)
        await logExecutorInfo(
          `⚠️ Open ${side} ${signal.symbol} exists (entry=${existingEntry}) but new signal has different entry=${newEntry} — proceeding as new order`,
          {
            accountId,
            processId,
            symbol: signal.symbol,
            action: "console_duplicate_proceed_new_order",
          },
        );
      }

      // ─── Auto-calculate SL from TP distance if no SL but has TP + entry ────
      let effectiveSL = signal.stopLoss || null;
      const signalTPs = signal.takeProfitTargets || [];
      if (!effectiveSL && signalTPs.length > 0 && entryPrice) {
        const rr =
          signal.defaultRR && signal.defaultRR > 0
            ? signal.defaultRR
            : riskCfg.defaultRR;
        if (rr > 0) {
          effectiveSL = autoCalculateSLFromRR(
            entryPrice,
            signalTPs[0],
            rr,
            side,
          );
          await logExecutorInfo(
            `📐 Auto-calculated SL from ${rr}RR using TP distance: entry=${entryPrice}, TP=${signalTPs[0]} → SL=${effectiveSL}`,
            {
              accountId,
              processId,
              symbol: signal.symbol,
              action: "console_auto_sl_from_rr",
            },
          );
        }
      }

      // Check skipNoSL — skip trades without stop loss if setting is enabled
      if (!effectiveSL) {
        if (riskCfg.skipNoSL) {
          await logExecutorWarn(
            `🚫 Skipping ${signal.action} ${signal.symbol}: no stop loss (and no TP to derive SL from) and skipNoSL is enabled`,
            {
              accountId,
              processId,
              symbol: signal.symbol,
              action: "console_skip_no_sl",
            },
          );
          await logProcessStep({
            accountId,
            processId,
            type: "draft_process",
            action: "execution_skipped_no_sl",
            symbol: signal.symbol,
            details: "Trade skipped: no stop loss provided and skipNoSL is enabled",
            result: "skipped",
          });
          return {
            type: "skipped",
            code: "no_stop_loss",
            reason: "Trade skipped: no stop loss provided and skipNoSL is enabled",
          };
        }
      }

      // Auto-calculate TP from RR if no TP targets but we have entry + SL + RR
      let tpTargets = signal.takeProfitTargets || [];
      if (tpTargets.length === 0 && entryPrice && effectiveSL) {
        const rr =
          signal.defaultRR && signal.defaultRR > 0
            ? signal.defaultRR
            : riskCfg.defaultRR;
        if (rr > 0) {
          tpTargets = autoCalculateTPFromRR(entryPrice, effectiveSL, rr, side);
          await logExecutorInfo(
            `📐 Auto-calculated ${tpTargets.length} TP targets from ${rr}RR: [${tpTargets.join(", ")}]`,
            {
              accountId,
              processId,
              symbol: signal.symbol,
              action: "console_auto_tp_from_rr",
            },
          );
        }
      }

      // ─── Execute trade via shared core function ───────────────────
      await logProcessStep({
        accountId,
        processId,
        type: "draft_process",
        action: "execution_started",
        symbol: signal.symbol,
        details: {
          messageId,
          orderType: signal.orderType === "limit" ? "LIMIT" : "MARKET",
          leverage,
          quantity,
        },
        result: "processing",
      });

      const position = await executeTrade({
        symbol: signal.symbol,
        action: signal.action,
        entryPrice: entryPrice || undefined,
        stopLoss: effectiveSL,
        takeProfitTargets: tpTargets,
        leverage,
        quantity,
        orderType: signal.orderType === "limit" ? "LIMIT" : "MARKET",
        channelId,
        messageId,
        sourceName,
        signalData: JSON.stringify(signal),
        accountId,
        processId,
      });

      await logProcessStep({
        accountId,
        processId,
        type: "draft_process",
        action: "execution_completed",
        symbol: signal.symbol,
        details: {
          positionId: position._id.toString(),
          side: position.side,
        },
        result: "executed",
      });

      return { type: "opened", position };
    }

    case "CLOSE": {
      const positions = await Position.find({
        symbol: signal.symbol,
        channelId: channelId || null,
        status: "open",
      });

      // Resolve exchange per position (each may belong to different account)
      for (const pos of positions) {
        const posExchange = await (async () => {
          if (pos.accountId) {
            const acct = await Account.findById(pos.accountId).lean();
            if (acct?.exchangeData) {
              const creds = buildExchangeCredentials(
                acct.tradingPlatform,
                (acct.exchangeData as Record<string, unknown>) || {},
              );
              if (creds) return ExchangeFactory.getClientForAccount(creds);
            }
          }
          return ExchangeFactory.getPaperClient();
        })();
        await posExchange.closePosition(pos.symbol, pos.orderId, pos.quantity);

        pos.status = "closed";
        pos.closedAt = new Date();
        pos.closeReason = "AI Signal Close";
        await pos.save();

        await logExecutorInfo(`✅ Closed position: ${pos.symbol} ${pos.side}`, {
          accountId: pos.accountId || accountId,
          processId,
          symbol: pos.symbol,
          action: "console_close_position",
        });
      }
      if (positions.length === 0) {
        await logProcessStep({
          accountId,
          processId,
          type: "draft_process",
          action: "close_no_open_position",
          symbol: signal.symbol,
          details: `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to close`,
          result: "noop",
        });
        return {
          type: "noop",
          code: "no_open_position",
          details: `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to close`,
        };
      }

      await logProcessStep({
        accountId,
        processId,
        type: "draft_process",
        action: "close_completed",
        symbol: signal.symbol,
        details: {
          closedCount: positions.length,
        },
        result: "updated",
      });

      return { type: "closed", closedCount: positions.length };
    }

    case "UPDATE_SL":
    case "UPDATE_TP": {
      const position = await Position.findOne({
        symbol: signal.symbol,
        channelId: channelId || null,
        status: "open",
      });

      if (position) {
        if (signal.stopLoss && signal.action === "UPDATE_SL") {
          position.stopLossPrice = signal.stopLoss;
        }
        if (signal.takeProfitTargets?.[0] && signal.action === "UPDATE_TP") {
          // UPDATE_TP replaces the first pending TP price
          const firstPending = position.takeProfitTargets.findIndex(
            (t) => t.status === "pending",
          );
          if (firstPending >= 0) {
            position.takeProfitTargets[firstPending].price =
              signal.takeProfitTargets[0];
          } else {
            const newTargets = buildTPTargets(
              signal.takeProfitTargets,
              position.quantity,
            );
            position.takeProfitTargets.push(...newTargets);
          }
          // Recalculate percentages for all TPs
          position.takeProfitTargets = recalculateTPAllocation(
            position.takeProfitTargets,
            position.quantity,
          );
        }
        await position.save();

        await logExecutorInfo(
          `✅ Updated ${signal.action} for ${signal.symbol} (channel=${channelId || "any"}): SL=${position.stopLossPrice}, TPs=[${position.takeProfitTargets.map((t) => `${t.price}(${t.status})`).join(", ")}]`,
          {
            accountId,
            processId,
            symbol: signal.symbol,
            action: "console_position_updated",
          },
        );
        await logProcessStep({
          accountId,
          processId,
          type: "draft_process",
          action: "position_update_completed",
          symbol: signal.symbol,
          details: `${signal.action} applied for ${signal.symbol}`,
          result: "updated",
        });
        return {
          type: "updated",
          code: signal.action.toLowerCase(),
          details: `${signal.action} applied for ${signal.symbol}`,
        };
      } else {
        await logExecutorInfo(
          `⚠️ No open position found for ${signal.symbol} (channel=${channelId || "any"}) to update`,
          {
            accountId,
            processId,
            symbol: signal.symbol,
            action: "console_position_update_noop",
          },
        );
        await logProcessStep({
          accountId,
          processId,
          type: "draft_process",
          action: "position_update_noop",
          symbol: signal.symbol,
          details: `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to update`,
          result: "noop",
        });
        return {
          type: "noop",
          code: "no_open_position",
          details: `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to update`,
        };
      }
    }

    case "ADD_TP": {
      const position = await Position.findOne({
        symbol: signal.symbol,
        channelId: channelId || null,
        status: "open",
      });

      if (position && signal.takeProfitTargets?.length) {
        const posExchange = await (async () => {
          if (position.accountId) {
            const acct = await Account.findById(position.accountId).lean();
            if (acct?.exchangeData) {
              const creds = buildExchangeCredentials(
                acct.tradingPlatform,
                (acct.exchangeData as Record<string, unknown>) || {},
              );
              if (creds) return ExchangeFactory.getClientForAccount(creds);
            }
          }
          if (accountId) {
            const acct = await Account.findById(accountId).lean();
            if (acct?.exchangeData) {
              const creds = buildExchangeCredentials(
                acct.tradingPlatform,
                (acct.exchangeData as Record<string, unknown>) || {},
              );
              if (creds) return ExchangeFactory.getClientForAccount(creds);
            }
          }
          return null;
        })();
        const closeSide = position.side === "LONG" ? "SELL" : "BUY";
        let addedCount = 0;

        for (const newTpPrice of signal.takeProfitTargets) {
          const alreadyExists = position.takeProfitTargets.some(
            (t) => Math.abs(t.price - newTpPrice) < 0.01,
          );
          if (!alreadyExists) {
            position.takeProfitTargets.push({
              price: newTpPrice,
              quantity: 0, // will be recalculated below
              percentage: 0,
              status: "pending",
            });
            addedCount++;

            if (posExchange) {
              try {
                await posExchange.placeTakeProfit(
                  signal.symbol,
                  newTpPrice,
                  newTpPrice,
                  closeSide,
                  position.quantity,
                );
              } catch (tpErr) {
                await logExecutorWarn(
                  `⚠️ Failed to place TP on exchange at ${newTpPrice}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
                  {
                    accountId: position.accountId || accountId,
                    processId,
                    symbol: signal.symbol,
                    action: "console_add_tp_failed",
                  },
                );
              }
            }
          }
        }
        // Recalculate percentages & quantities for ALL TPs
        position.takeProfitTargets = recalculateTPAllocation(
          position.takeProfitTargets,
          position.quantity,
        );
        await position.save();
        await logExecutorInfo(
          `✅ Updated TPs for ${signal.symbol}: ${position.takeProfitTargets.map((t) => `${t.price}(${t.percentage}%)`).join(", ")}`,
          {
            accountId: position.accountId || accountId,
            processId,
            symbol: signal.symbol,
            action: "console_add_tp_updated",
          },
        );
        return addedCount > 0
          ? {
              type: "updated",
              code: "add_tp",
              details: `Added ${addedCount} TP target(s) for ${signal.symbol}`,
            }
          : {
              type: "noop",
              code: "tp_exists",
              details: `All requested TP levels already exist for ${signal.symbol}`,
            };
      } else {
        await logExecutorInfo(
          `⚠️ No open position found for ${signal.symbol} (channel=${channelId || "any"}) to add TP`,
          {
            accountId,
            processId,
            symbol: signal.symbol,
            action: "console_add_tp_noop",
          },
        );
        return {
          type: "noop",
          code: "no_open_position",
          details: `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to add TP`,
        };
      }
    }

    default:
      await logExecutorInfo(`⚠️ Unhandled signal action: ${signal.action}`, {
        accountId,
        processId,
        symbol: signal.symbol,
        action: "console_unhandled_action",
      });
      return {
        type: "skipped",
        code: "unhandled_action",
        reason: `Unhandled signal action: ${signal.action}`,
      };
  }
}
