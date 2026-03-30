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
} from "./database";
import {
  fetchRecentMessages,
  fetchMessagesFromSource,
  checkTokenHealth,
  DiscordSourceConfig,
  DiscordMessage,
} from "./discord";
import { AIFactory } from "./ai/AIFactory";
import { TradingSignal } from "./ai/types";
import { ExchangeFactory } from "./exchange/ExchangeFactory";
import { calculateRiskBasedPosition, getRiskConfig } from "./risk";

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

    // 2. Get Discord sources (DB first, fallback to env)
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

          const messages = await fetchMessagesFromSource(sourceConfig);
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

    for (const msg of allMessages) {
      try {
        // 3. Check if message was already processed
        const existing = await ProcessedMessage.findOne({
          messageId: msg.messageId,
        });
        if (existing) continue;

        // 4. Save message as pending
        await ProcessedMessage.create({
          messageId: msg.messageId,
          channelId: msg.channelId,
          author: msg.author,
          content: msg.content,
          signalType: null,
          parsedSignal: null,
          status: "pending",
        });

        // 5. Parse with AI — use original content for replies so AI sees the quoted signal
        const analyzer = AIFactory.getAnalyzer();
        const aiContent = msg.originalContent || msg.content;
        const signal = await analyzer.parseSignal(aiContent);

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

        // 6. Update message with parsed signal
        await ProcessedMessage.updateOne(
          { messageId: msg.messageId },
          {
            signalType: signal.action,
            parsedSignal: JSON.stringify(signal),
            status: "processed",
            processedAt: new Date(),
          },
        );

        // 7. Execute or draft based on trading mode
        if (mode === "auto") {
          await executeSignal(signal, msg.messageId);
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
        const errMsg = error instanceof Error ? error.message : "Unknown error";
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
    } // end for loop
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
  const side = signal.action === "SELL" ? "SHORT" : "LONG";
  const quantity =
    signal.positionSize ||
    parseFloat(process.env.DEFAULT_POSITION_SIZE || "50");

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
    takeProfitTargets: signal.takeProfitTargets || [],
    stopLoss: signal.stopLoss || null,
    leverage: signal.leverage || parseInt(process.env.DEFAULT_LEVERAGE || "10"),
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
): Promise<IPosition | null> {
  const side = signal.action === "SELL" ? "SHORT" : "LONG";
  const leverage = signal.leverage || 10;
  const quantity =
    signal.positionSize ||
    parseFloat(process.env.DEFAULT_POSITION_SIZE || "50");
  const entryPrice = signal.entryPrice;

  switch (signal.action) {
    case "BUY":
    case "SELL": {
      // Check for duplicate open positions on same symbol with same side
      const existingPos = await Position.findOne({
        symbol: signal.symbol,
        side,
        status: "open",
      });

      if (existingPos) {
        console.log(
          `⚠️ Already have open ${side} position for ${signal.symbol}, skipping`,
        );
        await TradeLog.create({
          type: "signal",
          action: "skipped_duplicate",
          symbol: signal.symbol,
          details: `Already have open ${side} position`,
          result: "skipped",
        });
        return null;
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
      const tp = signal.takeProfitTargets?.[0];
      const sl = signal.stopLoss;

      if (tp) {
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
            `⚠️ Failed to place TP: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
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

      // Save position to DB
      const position = await Position.create({
        symbol: signal.symbol,
        side,
        entryPrice: entryPrice || orderResult.price || 0,
        quantity: orderResult.quantity || orderQuantity,
        leverage: orderLeverage,
        takeProfitPrice: signal.takeProfitTargets?.[0] || undefined,
        stopLossPrice: signal.stopLoss || undefined,
        orderId: orderResult.orderId,
        status: "open",
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
        status: "open",
      });

      if (position) {
        if (signal.stopLoss && signal.action === "UPDATE_SL") {
          position.stopLossPrice = signal.stopLoss;
        }
        if (signal.takeProfitTargets?.[0] && signal.action === "UPDATE_TP") {
          position.takeProfitPrice = signal.takeProfitTargets[0];
        }
        await position.save();

        console.log(
          `✅ Updated ${signal.action} for ${signal.symbol}: SL=${position.stopLossPrice}, TP=${position.takeProfitPrice}`,
        );
      }
      return null;
    }

    default:
      console.log(`⚠️ Unhandled signal action: ${signal.action}`);
      return null;
  }
}
