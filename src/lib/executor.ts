import {
  connectDB,
  ProcessedMessage,
  Position,
  DraftTrade,
  TradeLog,
  DiscordSource,
  getTradingMode,
  getActiveDiscordSources,
  IPosition,
  ITPTarget,
  buildTPTargets,
  recalculateTPAllocation,
} from "./database";
import {
  fetchRecentMessages,
  fetchMessagesFromSource,
  checkTokenHealth,
  DiscordSourceConfig,
  DiscordMessage,
} from "./discord";
import { AIFactory } from "./ai/AIFactory";
import { TradingSignal, BulkMessageInput } from "./ai/types";
import { ExchangeFactory } from "./exchange/ExchangeFactory";
import { calculateRiskBasedPosition, getRiskConfig } from "./risk";
import { getSignalConfig } from "./signal-config";

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
function autoCalculateTPFromRR(
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
      { messageId: 1 },
    ).lean();
    const processedMessageIds = new Set(processedDocs.map((d) => d.messageId));
    console.log(
      `📦 Found ${processedMessageIds.size} previously processed messages in DB`,
    );

    // 4. Get Discord sources (DB first, fallback to env)
    const dbSources = await getActiveDiscordSources();
    let allMessages: DiscordMessage[] = [];

    if (dbSources && dbSources.length > 0) {
      console.log(
        `📡 Found ${dbSources.length} Discord sources in DB, fetching messages...`,
      );

      for (const source of dbSources) {
        const sourceConfig: DiscordSourceConfig = {
          _id: (source as any)._id.toString(),
          name: source.name,
          method: source.method,
          token: source.token,
          channelIds: source.channelIds,
          refreshToken: source.refreshToken,
          tokenExpiresAt: source.tokenExpiresAt,
          autoRefresh: source.autoRefresh,
        };

        try {
          // Auto health check before fetching
          if (source.autoRefresh) {
            const health = await checkTokenHealth(source.method, source.token);
            if (!health.valid) {
              console.warn(
                `⚠️ Source "${source.name}" token unhealthy: ${health.error}`,
              );
              await DiscordSource.findByIdAndUpdate(source._id, {
                lastError: health.error,
                isActive: health.needsRefresh ? false : source.isActive,
              });
              result.sources.push({
                name: source.name,
                channels: source.channelIds.length,
                healthy: false,
              });
              continue;
            }
          }

          const messages = await fetchMessagesFromSource(
            sourceConfig,
            signalConfig.fetchLimit,
            signalConfig.timeWindowHours,
            processedMessageIds,
          );
          allMessages = allMessages.concat(messages);

          // Update source health
          await DiscordSource.findByIdAndUpdate(source._id, {
            lastFetchedAt: new Date(),
            lastError: null,
          });

          result.sources.push({
            name: source.name,
            channels: source.channelIds.length,
            healthy: true,
          });

          console.log(
            `📡 Source "${source.name}": ${messages.length} messages from ${source.channelIds.length} channels`,
          );
        } catch (error) {
          const errMsg =
            error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Source "${source.name}": ${errMsg}`);
          result.sources.push({
            name: source.name,
            channels: source.channelIds.length,
            healthy: false,
          });

          await DiscordSource.findByIdAndUpdate(source._id, {
            lastError: errMsg,
          });

          console.error(`❌ Source "${source.name}" error: ${errMsg}`);
        }
      }
    } else {
      // Fallback to env config
      console.log("📡 No DB sources, falling back to env config...");
      allMessages = await fetchRecentMessages();
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
    // Filter out already-processed messages in one query
    const existingProcessed = await ProcessedMessage.find(
      { messageId: { $in: allMessages.map((m) => m.messageId) } },
      { messageId: 1 },
    ).lean();
    const existingIds = new Set(existingProcessed.map((d) => d.messageId));
    const newMessages = allMessages.filter(
      (m) => !existingIds.has(m.messageId),
    );

    if (newMessages.length === 0) {
      console.log("📭 No new messages to process");
    } else {
      console.log(
        `📨 ${newMessages.length} new messages to process (bulk batchSize=${signalConfig.batchSize})`,
      );

      // Bulk-create pending messages
      await ProcessedMessage.insertMany(
        newMessages.map((msg) => ({
          messageId: msg.messageId,
          channelId: msg.channelId,
          author: msg.author,
          content: msg.content,
          signalType: null,
          parsedSignal: null,
          status: "pending" as const,
        })),
        { ordered: false },
      );

      // Batch AI parsing
      const analyzer = AIFactory.getAnalyzer();
      const batchSize = signalConfig.batchSize || 5;

      for (let i = 0; i < newMessages.length; i += batchSize) {
        const batch = newMessages.slice(i, i + batchSize);

        // Build BulkMessageInput[] — AI returns messageId so we can map back
        const bulkInputs: BulkMessageInput[] = batch.map((msg) => ({
          messageId: msg.messageId,
          content: msg.originalContent || msg.content,
          ...(signalConfig.includeImageUrls && msg.imageUrls?.length > 0
            ? { imageUrls: msg.imageUrls }
            : {}),
        }));

        let batchResults: Array<{
          messageId: string;
          signal: TradingSignal | null;
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
            } catch {
              batchResults.push({ messageId: input.messageId, signal: null });
            }
          }
        }

        // Build a lookup map from messageId → original Discord message
        const msgLookup = new Map<string, (typeof batch)[number]>();
        for (const m of batch) {
          msgLookup.set(m.messageId, m);
        }

        // Process each result in the batch — map by messageId
        for (const { messageId: resultMsgId, signal } of batchResults) {
          const msg = msgLookup.get(resultMsgId);
          if (!msg) continue;

          // Attach messageId and rawSignal to signal for downstream use
          if (signal) {
            signal.messageId = msg.messageId;
            signal.rawSignal = msg.originalContent || msg.content;
          }

          try {
            if (!signal || !signal.action || signal.action === "HOLD") {
              await ProcessedMessage.updateOne(
                { messageId: msg.messageId },
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
                { messageId: msg.messageId },
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
                  const exchange = ExchangeFactory.getClient();
                  for (const pos of openPositions) {
                    try {
                      await exchange.closePosition(
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
              { messageId: msg.messageId },
              {
                signalType: signal.action,
                parsedSignal: JSON.stringify(signal),
                status: "processed",
                processedAt: new Date(),
              },
            );

            // Execute or draft based on trading mode
            if (mode === "auto") {
              await executeSignal(
                signal,
                msg.messageId,
                msg.channelId,
                msg.sourceName,
              );
              result.executed++;

              await TradeLog.create({
                type: "signal",
                action: signal.action,
                symbol: signal.symbol,
                details: JSON.stringify(signal),
                result: "executed",
              });
            } else {
              // Manual mode: create a draft for user review
              await createDraft(signal, msg);
              result.drafted++;

              await ProcessedMessage.updateOne(
                { messageId: msg.messageId },
                { status: "drafted" },
              );

              await TradeLog.create({
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

            await TradeLog.create({
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
): Promise<void> {
  const riskCfg = await getRiskConfig();
  const side = signal.action === "SELL" ? "SHORT" : "LONG";
  const quantity = signal.positionSize || riskCfg.defaultPositionSize;

  // Auto-calculate TP from RR if no TP targets but we have entry + SL + RR
  let tpTargets = signal.takeProfitTargets || [];
  if (tpTargets.length === 0 && signal.entryPrice && signal.stopLoss) {
    const rr =
      signal.defaultRR && signal.defaultRR > 0
        ? signal.defaultRR
        : riskCfg.defaultRR;
    if (rr > 0) {
      tpTargets = autoCalculateTPFromRR(
        signal.entryPrice,
        signal.stopLoss,
        rr,
        side,
      );
      console.log(
        `📐 Auto-calculated ${tpTargets.length} TP targets from ${rr}RR: [${tpTargets.join(", ")}]`,
      );
    }
  }

  await DraftTrade.create({
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
    stopLoss: signal.stopLoss || null,
    leverage: sanitizeLeverage(signal.leverage) || riskCfg.defaultLeverage,
    quantity,
    confidence: signal.confidence || 0,
    reasoning: signal.reasoning || "",
    status: "pending",
    discordTimestamp: msg.timestamp || null,
  });

  console.log(
    `📝 Created draft: ${signal.action} ${signal.symbol} (manual mode) — discordTimestamp: ${msg.timestamp}`,
  );
}

export async function executeSignal(
  signal: TradingSignal,
  messageId: string,
  channelId?: string,
  sourceName?: string,
): Promise<IPosition | null> {
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
        const openCount = await Position.countDocuments({ status: "open" });
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
          return null;
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
          return null;
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
          }
          return null;
        }

        // Different entry price — this is a genuinely new signal, don't block it
        // (the exchange may reject it anyway if hedging is not enabled)
        console.log(
          `⚠️ Open ${side} ${signal.symbol} exists (entry=${existingEntry}) but new signal has different entry=${newEntry} — proceeding as new order`,
        );
      }

      // Check skipNoSL — skip trades without stop loss if setting is enabled
      if (!signal.stopLoss) {
        const riskCfg = await getRiskConfig();
        if (riskCfg.skipNoSL) {
          console.warn(
            `🚫 Skipping ${signal.action} ${signal.symbol}: no stop loss and skipNoSL is enabled`,
          );
          await TradeLog.create({
            type: "signal",
            action: "skipped_no_sl",
            symbol: signal.symbol,
            details: `Trade skipped: no stop loss provided and skipNoSL is enabled`,
            result: "skipped",
          });
          return null;
        }
      }

      // ─── Risk-Based Position Sizing ─────────────────────────────────
      let orderQuantity = quantity;
      let orderLeverage = leverage;

      if (entryPrice && entryPrice > 0) {
        const riskCalc = await calculateRiskBasedPosition(
          entryPrice,
          signal.stopLoss || null,
          side,
          quantity,
          leverage,
        );

        if (riskCalc.applied) {
          orderQuantity = riskCalc.quantity;
          orderLeverage = riskCalc.leverage;
          console.log(
            `🛡️ Risk management applied: qty=${orderQuantity.toFixed(6)}, leverage=${orderLeverage}x (balance=$${riskCalc.accountBalance.toFixed(2)}, margin=$${riskCalc.marginUsdt.toFixed(2)}, slDist=${(riskCalc.slDistancePercent * 100).toFixed(2)}%)`,
          );
        } else {
          console.warn(`⚠️ Risk management skipped: ${riskCalc.skipReason}`);
        }
      }

      // Place order via exchange
      const exchange = ExchangeFactory.getClient();

      // Set leverage before placing order
      try {
        await exchange.setLeverage(signal.symbol, orderLeverage);
      } catch (levErr) {
        console.warn(
          `⚠️ Failed to set leverage: ${levErr instanceof Error ? levErr.message : String(levErr)}`,
        );
      }

      const orderSide = signal.action === "BUY" ? "BUY" : "SELL";
      const closeSide = orderSide === "BUY" ? "SELL" : "BUY";
      const orderType = signal.orderType === "limit" ? "LIMIT" : "MARKET";

      const orderResult = await exchange.placeOrder({
        symbol: signal.symbol,
        side: orderSide,
        type: orderType as "LIMIT" | "MARKET",
        quantity: orderQuantity,
        price: signal.orderType === "limit" ? entryPrice : undefined,
        leverage: orderLeverage,
      });

      const filledQty = orderResult.quantity || orderQuantity;

      // ─── Place TP/SL via plan orders ────────────────────────────────
      // Auto-calculate TP from RR if no TP targets but we have entry + SL + RR
      let tpTargets = signal.takeProfitTargets || [];
      if (tpTargets.length === 0 && entryPrice && signal.stopLoss) {
        const riskCfg = await getRiskConfig();
        const rr =
          signal.defaultRR && signal.defaultRR > 0
            ? signal.defaultRR
            : riskCfg.defaultRR;
        if (rr > 0) {
          tpTargets = autoCalculateTPFromRR(
            entryPrice,
            signal.stopLoss,
            rr,
            side,
          );
          console.log(
            `📐 Auto-calculated ${tpTargets.length} TP targets from ${rr}RR: [${tpTargets.join(", ")}]`,
          );
        }
      }

      const sl = signal.stopLoss;

      // Place ALL TP targets on the exchange (not just the first one)
      for (const tp of tpTargets) {
        try {
          const tpId = await exchange.placeTakeProfit(
            signal.symbol,
            tp,
            tp,
            closeSide,
            filledQty,
          );
          console.log(`🎯 Take Profit set at ${tp} (plan order ${tpId})`);
        } catch (tpErr) {
          console.warn(
            `⚠️ Failed to place TP at ${tp}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
          );
        }
      }

      if (sl) {
        try {
          const slId = await exchange.placeStopLoss(
            signal.symbol,
            sl,
            sl,
            closeSide,
            filledQty,
          );
          console.log(`🛑 Stop Loss set at ${sl} (plan order ${slId})`);
        } catch (slErr) {
          console.warn(
            `⚠️ Failed to place SL: ${slErr instanceof Error ? slErr.message : String(slErr)}`,
          );
        }
      }

      // Build TP target objects for DB storage with percentage allocation
      const tpTargetObjects = buildTPTargets(tpTargets, filledQty);

      // Save position to DB
      const position = await Position.create({
        symbol: signal.symbol,
        side,
        entryPrice: entryPrice || orderResult.price || 0,
        quantity: orderResult.quantity || orderQuantity,
        leverage: orderLeverage,
        takeProfitTargets: tpTargetObjects,
        stopLossPrice: signal.stopLoss || undefined,
        orderId: orderResult.orderId,
        status: "open",
        channelId: channelId || undefined,
        sourceName: sourceName || undefined,
        messageId,
        signalData: JSON.stringify(signal),
      });

      console.log(
        `✅ Opened ${side} position: ${signal.symbol} @ ${entryPrice || "market"}`,
      );
      return position;
    }

    case "CLOSE": {
      const positions = await Position.find({
        symbol: signal.symbol,
        channelId: channelId || null,
        status: "open",
      });

      const exchange = ExchangeFactory.getClient();
      for (const pos of positions) {
        await exchange.closePosition(pos.symbol, pos.orderId, pos.quantity);

        pos.status = "closed";
        pos.closedAt = new Date();
        pos.closeReason = "AI Signal Close";
        await pos.save();

        console.log(`✅ Closed position: ${pos.symbol} ${pos.side}`);
      }
      return null;
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
      } else {
        console.log(
          `⚠️ No open position found for ${signal.symbol} (channel=${channelId || "any"}) to update`,
        );
      }
      return null;
    }

    case "ADD_TP": {
      const position = await Position.findOne({
        symbol: signal.symbol,
        channelId: channelId || null,
        status: "open",
      });

      if (position && signal.takeProfitTargets?.length) {
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
      } else {
        console.log(
          `⚠️ No open position found for ${signal.symbol} (channel=${channelId || "any"}) to add TP`,
        );
      }
      return null;
    }

    default:
      console.log(`⚠️ Unhandled signal action: ${signal.action}`);
      return null;
  }
}
