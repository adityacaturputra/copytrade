import {
  connectDB,
  ProcessedMessage,
  Position,
  DraftTrade,
  TradeLog,
  Account,
  getTradingMode,
  IDraftTrade,
  IPosition,
  ITPTarget,
  buildTPTargets,
  recalculateTPAllocation,
} from "./database";
import { BaseSourceMessage } from "./source/types";
import { SourceFactory } from "./source/SourceFactory";
import { AIFactory } from "./ai/AIFactory";
import { TradingSignal, BulkMessageInput } from "./ai/types";
import { preprocessImagesWithVision } from "./ai/ImageAIFactory";
import {
  ExchangeFactory,
  ExchangeCredentials,
} from "./exchange/ExchangeFactory";
import { calculateRiskBasedPosition, getRiskConfig } from "./risk";
import { getSignalConfig } from "./signal-config";
import {
  TradeAction,
  PositionSide,
  OrderSide,
  ExchangeOrderType,
  SignalOrderType,
  PositionStatus,
  TradingMode,
  actionToSide,
  actionToOrderSide,
  closeSideForPosition,
  signalToExchangeOrderType,
} from "./enums";

/**
 * Auto-calculate Take Profit targets based on RR (Risk-Reward) ratio.
 * If a signal has entryPrice + stopLoss but no TP, generate TP levels using RR.
 *
 * Example: Entry=95000, SL=94000, RR=3
 *   riskDistance = 1000
 *   TP1 (1R) = 96000, TP2 (2R) = 97000, TP3 (3R) = 98000
 *
 * For SHORT (SELL): TP is below entry
 *   TP1 (1R) = 94000, TP2 (2R) = 93000, TP3 (3R) = 92000
 */
export function autoCalculateTPFromRR(
  entryPrice: number,
  stopLoss: number,
  rr: number,
  side: "LONG" | "SHORT",
): number[] {
  const riskDistance = Math.abs(entryPrice - stopLoss);
  const direction = side === "LONG" ? 1 : -1;
  const tps: number[] = [];

  for (let i = 1; i <= rr; i++) {
    const tp = entryPrice + direction * riskDistance * i;
    tps.push(tp);
  }

  return tps;
}

/**
 * Auto-calculate Stop Loss from TP distance using RR ratio.
 * Reverse of autoCalculateTPFromRR — when signal has TP but no SL.
 *
 * Example: Entry=95000, TP=98000 (3R), RR=3
 *   tpDistance = 3000
 *   slDistance = tpDistance / RR = 1000
 *   For LONG: SL = 95000 - 1000 = 94000
 *   For SHORT: SL = 95000 + 1000 = 96000
 */
function autoCalculateSLFromRR(
  entryPrice: number,
  tpPrice: number,
  rr: number,
  side: "LONG" | "SHORT",
): number {
  const tpDistance = Math.abs(tpPrice - entryPrice);
  const slDistance = tpDistance / rr;
  // SL is on the opposite side of entry from TP
  const direction = side === "LONG" ? -1 : 1;
  return entryPrice + direction * slDistance;
}

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

  console.log(
    `📊 TP qty split (lotSz=${lotSz}, qtyDecimals=${qtyDecimals}): [${quantities.map((q) => q.toFixed(qtyDecimals)).join(", ")}] total=${quantities.reduce((a, b) => a + b, 0).toFixed(qtyDecimals)} (filledQty=${totalQty.toFixed(qtyDecimals)})`,
  );

  return quantities;
}

/**
 * Sanitize leverage value from AI response.
 * AI may return leverage as "10x", "10-25x", or other string formats.
 * This extracts the first valid number and ensures it's a plain number.
 */
function sanitizeLeverage(
  leverage: number | string | undefined | null,
): number | null {
  if (leverage === undefined || leverage === null) return null;
  if (typeof leverage === "number") {
    return isNaN(leverage) ? null : leverage;
  }
  // String: try to extract first number from patterns like "10x", "10-25x"
  const match = String(leverage).match(/(\d+)/);
  if (match) {
    const num = parseInt(match[1], 10);
    return isNaN(num) ? null : num;
  }
  return null;
}

export type SignalExecutionResult =
  | { type: "opened"; position: IPosition }
  | { type: "closed"; closedCount: number }
  | { type: "updated"; code: string; details: string }
  | { type: "noop"; code: string; details: string }
  | { type: "skipped"; code: string; reason: string };

export interface DraftExecutionOutcome {
  status: "accepted" | "rejected";
  result: "executed" | "updated" | "noop" | "rejected";
  positionId?: string;
  message?: string;
  error?: string;
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
  draft: IDraftTrade,
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
  draft: IDraftTrade,
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
    console.log(`🔧 Trading mode: ${mode}`);

    // 2. Get signal config (fetchLimit = page size, timeWindowHours)
    const signalConfig = await getSignalConfig();
    console.log(
      `🔧 Signal config: pageSize=${signalConfig.fetchLimit}, timeWindowHours=${signalConfig.timeWindowHours}`,
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
    console.log(
      `📦 Found ${allProcessedIds.size} previously processed messages in DB (${processedByAccount.size} accounts)`,
    );

    // 4. Fetch messages from all active accounts via SourceFactory
    let allMessages: BaseSourceMessage[] = [];

    const activeAccounts = await Account.find({ isActive: true })
      .sort({ createdAt: 1 })
      .lean();

    if (!activeAccounts || activeAccounts.length === 0) {
      console.log("⚠️ No active accounts configured — skipping message fetch");
    } else {
      console.log(
        `📡 Found ${activeAccounts.length} active accounts, fetching messages...`,
      );

      for (const account of activeAccounts) {
        // Filter out disabled channels
        const disabledSet = new Set(account.disabledChannelIds || []);
        const activeChannelIds = account.channelIds.filter(
          (id: string) => !disabledSet.has(id),
        );

        if (activeChannelIds.length === 0) {
          console.log(
            `⏭️ Account "${account.name}": all channels disabled, skipping`,
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

          console.log(
            `📡 Account "${account.name}" (${account.sourceType}): fetched ${messages.length} messages from ${activeChannelIds.length} channels`,
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

          console.error(`❌ Account "${account.name}" error: ${errMsg}`);
        }
      }
    }

    result.checked = allMessages.length;
    console.log(`📡 Total messages fetched: ${allMessages.length}`);

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
    const newMessages = allMessages.filter(
      (m) => !existingKeys.has(`${m.messageId}::${m.sourceId || "null"}`),
    );

    if (newMessages.length === 0) {
      console.log("📭 No new messages to process");
    } else {
      console.log(
        `📨 ${newMessages.length} new messages to process (bulk batchSize=${signalConfig.batchSize})`,
      );

      // Bulk-create pending messages. Ignore duplicate-key races so
      // parallel signal-check runs won't fail the entire cycle.
      try {
        await ProcessedMessage.insertMany(
          newMessages.map((msg) => ({
            accountId: msg.sourceId || null,
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
        console.warn(
          "⚠️ Duplicate processed message keys detected during insertMany; continuing with existing records",
        );
      }

      // Batch AI parsing
      const analyzer = AIFactory.getAnalyzer();
      const batchSize = signalConfig.batchSize || 5;

      for (let i = 0; i < newMessages.length; i += batchSize) {
        const batch = newMessages.slice(i, i + batchSize);

        // Build BulkMessageInput[] — AI returns messageId so we can map back
        // Vision AI pre-layer: extract text from chart images before main AI
        const bulkInputs: BulkMessageInput[] = [];

        for (const msg of batch) {
          let content = msg.originalContent || msg.content;
          const imageUrls = msg.imageUrls || [];

          // If vision AI is enabled and message has images, preprocess through Gemini Vision
          if (signalConfig.visionAIEnabled && imageUrls.length > 0) {
            try {
              const { enhancedContent } = await preprocessImagesWithVision(
                content,
                imageUrls,
              );
              if (enhancedContent !== content) {
                console.log(
                  `👁️ Vision AI enhanced message ${msg.messageId} with chart data`,
                );
              }
              content = enhancedContent;
            } catch (visionErr) {
              console.warn(
                `⚠️ Vision AI failed for ${msg.messageId}, using original content: ${visionErr instanceof Error ? visionErr.message : String(visionErr)}`,
              );
            }
          }

          bulkInputs.push({
            messageId: msg.messageId,
            content,
            ...(signalConfig.includeImageUrls && imageUrls.length > 0
              ? { imageUrls }
              : {}),
          });
        }

        let batchResults: Array<{
          messageId: string;
          signal: TradingSignal | null;
          parseError?: string;
        }>;

        try {
          batchResults = await analyzer.parseBulkSignals(bulkInputs);
        } catch (bulkErr) {
          // If bulk fails entirely, fall back to individual parsing
          console.warn(
            `⚠️ Bulk AI call failed, falling back to individual: ${bulkErr instanceof Error ? bulkErr.message : String(bulkErr)}`,
          );
          batchResults = [];
          for (const input of bulkInputs) {
            try {
              const signal = await analyzer.parseSignal(input.content);
              batchResults.push({ messageId: input.messageId, signal });
            } catch (parseErr) {
              const parseError =
                parseErr instanceof Error
                  ? parseErr.message
                  : String(parseErr || "Unknown parse error");
              batchResults.push({
                messageId: input.messageId,
                signal: null,
                parseError,
              });
            }
          }
        }

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

              await TradeLog.create({
                accountId: msg.sourceId || undefined,
                type: "signal",
                action: "error",
                symbol: undefined,
                details: msg.content,
                result: "parse_failed",
                error: parseError,
              });

              console.error(`Error parsing message ${msg.messageId}:`, parseError);
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
              continue;
            }

            // Check for cancel requests on previously drafted signals
            if (signal.action === "CANCEL" && signal.symbol) {
              console.log(
                `🚫 Cancel request detected for ${signal.symbol} from ${msg.author}`,
              );

              // Find and reject any pending drafts for this symbol
              const cancelledDrafts = await DraftTrade.updateMany(
                { symbol: signal.symbol, status: "pending" },
                { status: "rejected", resolvedAt: new Date() },
              );

              if (cancelledDrafts.modifiedCount > 0) {
                console.log(
                  `🚫 Cancelled ${cancelledDrafts.modifiedCount} pending draft(s) for ${signal.symbol}`,
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

              await TradeLog.create({
                type: "signal",
                action: "cancel_request",
                symbol: signal.symbol,
                details: `Cancel request from ${msg.author}: ${signal.reasoning || "no reason provided"}. ${cancelledDrafts.modifiedCount} draft(s) cancelled.`,
                result:
                  cancelledDrafts.modifiedCount > 0
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
                            return ExchangeFactory.getClientForAccount({
                              provider:
                                (acct.tradingPlatform as any) || "paper",
                              ...acct.exchangeData,
                            });
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
                      console.log(
                        `🚫 Auto-cancelled position: ${pos.symbol} ${pos.side}`,
                      );
                    } catch (closeErr) {
                      console.warn(
                        `⚠️ Failed to auto-close ${pos.symbol}: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`,
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

              await TradeLog.create({
                accountId: msg.sourceId || undefined,
                type: "signal",
                action: signal.action,
                symbol: signal.symbol,
                details: JSON.stringify(signal),
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
                { status: "drafted" },
              );

              await TradeLog.create({
                accountId: msg.sourceId || undefined,
                type: "signal",
                action: signal.action,
                symbol: signal.symbol,
                details: JSON.stringify(signal),
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

            await TradeLog.create({
              accountId: msg.sourceId || undefined,
              type: "signal",
              action: "error",
              symbol: undefined,
              details: msg.content,
              error: errMsg,
            });

            console.error(`Error processing message ${msg.messageId}:`, errMsg);
          }
        } // end for batchResults
      } // end for batch
    } // end else (newMessages > 0)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`General: ${errMsg}`);
    console.error("Signal check error:", errMsg);
  }

  console.log(
    `✅ Signal check complete: ${result.checked} checked, ${result.newSignals} signals, ${result.executed} executed, ${result.drafted} drafted`,
  );
  return result;
}

async function createDraft(
  signal: TradingSignal,
  msg: {
    messageId: string;
    channelId: string;
    author: string;
    content: string;
    messageUrl: string;
    imageUrls: string[];
    timestamp?: Date;
  },
  accountId?: string,
): Promise<IDraftTrade> {
  const riskCfg = await getRiskConfig();
  const side = signal.action === "SELL" ? "SHORT" : "LONG";
  const quantity = signal.positionSize || riskCfg.defaultPositionSize;

  let tpTargets = signal.takeProfitTargets || [];
  let autoSL: number | null = null;

  // Auto-calculate SL from TP distance if no SL but has TP + entry + RR
  if (!signal.stopLoss && tpTargets.length > 0 && signal.entryPrice) {
    const rr =
      signal.defaultRR && signal.defaultRR > 0
        ? signal.defaultRR
        : riskCfg.defaultRR;
    if (rr > 0) {
      autoSL = autoCalculateSLFromRR(
        signal.entryPrice,
        tpTargets[0], // Use first TP target
        rr,
        side,
      );
      console.log(
        `📐 Auto-calculated SL from ${rr}RR using TP distance: entry=${signal.entryPrice}, TP=${tpTargets[0]} → SL=${autoSL}`,
      );
    }
  }

  // Auto-calculate TP from RR if no TP targets but we have entry + SL + RR
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
      console.log(
        `📐 Auto-calculated ${tpTargets.length} TP targets from ${rr}RR: [${tpTargets.join(", ")}]`,
      );
    }
  }

  const draft = await DraftTrade.create({
    accountId: accountId || null,
    messageId: msg.messageId,
    channelId: msg.channelId,
    messageUrl: msg.messageUrl,
    author: msg.author,
    originalContent: msg.content,
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
    status: "pending",
    sourceTimestamp: msg.timestamp || null,
  });

  console.log(
    `📝 Created draft: ${signal.action} ${signal.symbol} — sourceTimestamp: ${msg.timestamp}`,
  );

  return draft;
}

// ─── Result types for duplicate / max-positions checks ────────────
export type DuplicateCheckResult =
  | { type: "new" }
  | { type: "duplicate_exact" }
  | { type: "duplicate_updated"; updates: string[] }
  | { type: "duplicate_no_update" };

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

export interface ExecuteTradeInput {
  symbol: string;
  action: "BUY" | "SELL";
  entryPrice?: number;
  stopLoss?: number | null;
  takeProfitTargets: number[];
  leverage: number;
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  channelId?: string;
  messageId?: string;
  sourceName?: string;
  signalData: string;
  /** Custom log prefix for request tracing (e.g. "[accept-abc123]") */
  logPrefix?: string;
  /** Account ID — ties position to a specific account for per-account exchange */
  accountId?: string;
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
  } = input;

  const side = action === "SELL" ? ("SHORT" as const) : ("LONG" as const);
  const lp = logPrefix ? `${logPrefix} ` : "";

  // ─── Resolve exchange client (per-account or paper fallback) ────
  let exchange;
  if (accountId) {
    const account = await Account.findById(accountId).lean();
    if (account?.exchangeData) {
      const creds: ExchangeCredentials = {
        provider: (account.tradingPlatform as any) || "paper",
        apiKey: account.exchangeData.apiKey,
        secretKey: account.exchangeData.secretKey,
        passphrase: account.exchangeData.passphrase,
        simulated: account.exchangeData.simulated,
      };
      exchange = ExchangeFactory.getClientForAccount(creds);
    } else {
      console.warn(
        `${lp}⚠️ Account ${accountId} has no exchangeData, using paper exchange`,
      );
      exchange = ExchangeFactory.getPaperClient();
    }
  } else {
    console.warn(`${lp}⚠️ No accountId provided, using paper exchange`);
    exchange = ExchangeFactory.getPaperClient();
  }

  // ─── Risk-Based Position Sizing ─────────────────────────────────
  let orderQuantity = quantity;
  let orderLeverage = leverage;
  let riskAccountBalance: number | undefined;

  try {
    const account = await exchange.getAccountInfo();
    riskAccountBalance = account.availableBalance || account.totalBalance;
    console.log(
      `${lp}💰 Risk balance source (${exchange.name}): $${riskAccountBalance.toFixed(2)}`,
    );
  } catch (balanceErr) {
    console.warn(
      `${lp}⚠️ Failed to fetch account balance for risk sizing: ${balanceErr instanceof Error ? balanceErr.message : String(balanceErr)}`,
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
    );

    if (riskCalc.applied) {
      orderQuantity = riskCalc.quantity;
      orderLeverage = riskCalc.leverage;
      console.log(
        `${lp}🛡️ Risk management applied: qty=${orderQuantity.toFixed(6)} → ${orderQuantity}, leverage=${leverage} → ${orderLeverage}`,
      );
      console.log(
        `${lp}🛡️ Risk details: balance=$${riskCalc.accountBalance.toFixed(2)}, margin=$${riskCalc.marginUsdt.toFixed(2)}, slDist=${(riskCalc.slDistancePercent * 100).toFixed(2)}%, notional=$${riskCalc.notionalSize.toFixed(2)}`,
      );
    } else {
      console.warn(`${lp}⚠️ Risk management skipped: ${riskCalc.skipReason}`);
    }
  } else if (!entryPrice || entryPrice <= 0) {
    console.warn(`${lp}⚠️ Risk management skipped: no entry price available`);
  }

  // ─── Place order via exchange ────────────────────────────────────

  // Set leverage before placing order
  try {
    orderLeverage = await exchange.setLeverage(symbol, orderLeverage);
  } catch (levErr) {
    console.warn(
      `${lp}⚠️ Failed to set leverage (may already be set): ${levErr instanceof Error ? levErr.message : String(levErr)}`,
    );
  }

  const orderSide = action === "BUY" ? "BUY" : "SELL";
  const closeSide = orderSide === "BUY" ? "SELL" : "BUY";

  console.log(
    `${lp}🔄 Placing ${orderType} ${action} order: symbol=${symbol}, qty=${orderQuantity}, leverage=${orderLeverage}${orderType === "LIMIT" ? `, price=${entryPrice}` : ""}`,
  );

  const orderResult = await exchange.placeOrder({
    symbol,
    side: orderSide,
    type: orderType,
    quantity: orderQuantity,
    price: orderType === "LIMIT" ? entryPrice : undefined,
    leverage: orderLeverage,
  });

  console.log(
    `${lp}✅ Order placed: orderId=${orderResult.orderId}, price=${orderResult.price}, qty=${orderResult.quantity}`,
  );

  const filledQty = orderResult.quantity || orderQuantity;

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
        console.log(
          `${lp}🎯 Take Profit ${i + 1}/${tpTargets.length} set at ${tp} (qty: ${tpQty}/${filledQty}, plan order ${tpId})`,
        );
      } catch (tpErr) {
        console.warn(
          `${lp}⚠️ Failed to place TP at ${tp}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
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
        console.log(
          `${lp}🛑 Stop Loss set at ${stopLoss} (plan order ${slId})`,
        );
      } catch (slErr) {
        console.warn(
          `${lp}⚠️ Failed to place SL: ${slErr instanceof Error ? slErr.message : String(slErr)}`,
        );
      }
    }
  } else {
    console.log(
      `${lp}⏳ LIMIT order — skipping TP/SL placement. Will be placed by tp-sl-monitor after order fills.`,
    );
  }

  // ─── Save position to DB ────────────────────────────────────────
  const tpTargetObjects = buildTPTargets(tpTargets, filledQty);
  const positionStatus = orderType === "LIMIT" ? "pending" : "open";

  console.log(
    `${lp}💾 Saving position to database (status: ${positionStatus})...`,
  );

  const position = await Position.create({
    accountId: accountId || undefined,
    symbol,
    side,
    entryPrice: entryPrice || orderResult.price || 0,
    quantity: orderResult.quantity || orderQuantity,
    leverage: orderLeverage,
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

  console.log(
    `${lp}✅ ${orderType === "LIMIT" ? "Placed limit order for" : "Opened"} ${side} position: ${symbol} @ ${entryPrice || "market"} (status: ${positionStatus})`,
  );
  return position;
}

export async function executeSignal(
  signal: TradingSignal,
  messageId: string,
  channelId?: string,
  sourceName?: string,
  accountId?: string,
): Promise<SignalExecutionResult> {
  const riskCfg = await getRiskConfig();
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
          console.warn(
            `🚫 Max positions reached (${openCount}/${riskCfg.maxPositions}) — skipping ${signal.action} ${signal.symbol}`,
          );
          await TradeLog.create({
            type: "signal",
            action: "skipped_max_positions",
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
          console.log(
            `⚠️ Duplicate ${side} ${signal.symbol}: same entry=${existingEntry}, TP=${existingTP}, SL=${existingSL} — skipping`,
          );
          await TradeLog.create({
            type: "signal",
            action: "skipped_duplicate",
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
            console.log(
              `🔄 Updated ${side} ${signal.symbol} TP/SL: ${updates.join(", ")}`,
            );
            await TradeLog.create({
              type: "signal",
              action: "updated_tp_sl",
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
            console.log(
              `⚠️ Duplicate ${side} ${signal.symbol}: entry matches but no new TP/SL values to update — skipping`,
            );
            await TradeLog.create({
              type: "signal",
              action: "skipped_duplicate",
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
        console.log(
          `⚠️ Open ${side} ${signal.symbol} exists (entry=${existingEntry}) but new signal has different entry=${newEntry} — proceeding as new order`,
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
          console.log(
            `📐 Auto-calculated SL from ${rr}RR using TP distance: entry=${entryPrice}, TP=${signalTPs[0]} → SL=${effectiveSL}`,
          );
        }
      }

      // Check skipNoSL — skip trades without stop loss if setting is enabled
      if (!effectiveSL) {
        if (riskCfg.skipNoSL) {
          console.warn(
            `🚫 Skipping ${signal.action} ${signal.symbol}: no stop loss (and no TP to derive SL from) and skipNoSL is enabled`,
          );
          await TradeLog.create({
            type: "signal",
            action: "skipped_no_sl",
            symbol: signal.symbol,
            details: `Trade skipped: no stop loss provided and skipNoSL is enabled`,
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
          console.log(
            `📐 Auto-calculated ${tpTargets.length} TP targets from ${rr}RR: [${tpTargets.join(", ")}]`,
          );
        }
      }

      // ─── Execute trade via shared core function ───────────────────
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
              return ExchangeFactory.getClientForAccount({
                provider: (acct.tradingPlatform as any) || "paper",
                ...acct.exchangeData,
              });
            }
          }
          return ExchangeFactory.getPaperClient();
        })();
        await posExchange.closePosition(pos.symbol, pos.orderId, pos.quantity);

        pos.status = "closed";
        pos.closedAt = new Date();
        pos.closeReason = "AI Signal Close";
        await pos.save();

        console.log(`✅ Closed position: ${pos.symbol} ${pos.side}`);
      }
      if (positions.length === 0) {
        return {
          type: "noop",
          code: "no_open_position",
          details: `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to close`,
        };
      }
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

        console.log(
          `✅ Updated ${signal.action} for ${signal.symbol} (channel=${channelId || "any"}): SL=${position.stopLossPrice}, TPs=[${position.takeProfitTargets.map((t) => `${t.price}(${t.status})`).join(", ")}]`,
        );
        return {
          type: "updated",
          code: signal.action.toLowerCase(),
          details: `${signal.action} applied for ${signal.symbol}`,
        };
      } else {
        console.log(
          `⚠️ No open position found for ${signal.symbol} (channel=${channelId || "any"}) to update`,
        );
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
              return ExchangeFactory.getClientForAccount({
                provider: (acct.tradingPlatform as any) || "paper",
                ...acct.exchangeData,
              });
            }
          }
          if (accountId) {
            const acct = await Account.findById(accountId).lean();
            if (acct?.exchangeData) {
              return ExchangeFactory.getClientForAccount({
                provider: (acct.tradingPlatform as any) || "paper",
                ...acct.exchangeData,
              });
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
                console.warn(
                  `⚠️ Failed to place TP on exchange at ${newTpPrice}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
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
        console.log(
          `✅ Updated TPs for ${signal.symbol}: ${position.takeProfitTargets.map((t) => `${t.price}(${t.percentage}%)`).join(", ")}`,
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
        console.log(
          `⚠️ No open position found for ${signal.symbol} (channel=${channelId || "any"}) to add TP`,
        );
        return {
          type: "noop",
          code: "no_open_position",
          details: `No open position found for ${signal.symbol} (channel=${channelId || "any"}) to add TP`,
        };
      }
    }

    default:
      console.log(`⚠️ Unhandled signal action: ${signal.action}`);
      return {
        type: "skipped",
        code: "unhandled_action",
        reason: `Unhandled signal action: ${signal.action}`,
      };
  }
}
