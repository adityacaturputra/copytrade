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
import { mexcPlaceOrder } from "./mexc-api";

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

        // 5. Parse with AI
        const analyzer = AIFactory.getAnalyzer();
        const signal = await analyzer.parseSignal(msg.content);

        if (!signal || !signal.action || signal.action === "HOLD") {
          await ProcessedMessage.updateOne(
            { messageId: msg.messageId },
            { status: "ignored", processedAt: new Date() },
          );
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
  });

  console.log(
    `📝 Created draft: ${signal.action} ${signal.symbol} (manual mode)`,
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

      // Place order on MEXC
      const orderResult = await mexcPlaceOrder({
        symbol: signal.symbol,
        side: signal.action === "BUY" ? "BUY" : "SELL",
        type: signal.orderType || "market",
        quantity,
        price: signal.orderType === "limit" ? entryPrice : undefined,
        leverage,
      });

      // Save position to DB
      const position = await Position.create({
        symbol: signal.symbol,
        side,
        entryPrice: entryPrice || orderResult.price || 0,
        quantity: orderResult.quantity || quantity,
        leverage,
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

      for (const pos of positions) {
        const closeSide = pos.side === "LONG" ? "SELL" : "BUY";
        await mexcPlaceOrder({
          symbol: pos.symbol,
          side: closeSide,
          type: "market",
          quantity: pos.quantity,
        });

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
