import { connectDB, Position, TradeLog, Account } from "./database";
import { AIFactory } from "./ai/AIFactory";
import {
  ExchangeFactory,
  ExchangeCredentials,
} from "./exchange/ExchangeFactory";
import { ExchangeClient } from "./exchange/types";
import { inspectPendingLimitOrder } from "./pending-order-sync";

/**
 * Resolve the exchange client for a position based on its accountId.
 * If accountId is set, look up the Account and use its exchangeData.
 * Otherwise, fall back to paper exchange.
 */
async function getExchangeForPosition(position: {
  accountId?: string;
}): Promise<ExchangeClient> {
  if (position.accountId) {
    const account = await Account.findById(position.accountId).lean();
    if (account?.exchangeData) {
      const creds: ExchangeCredentials = {
        provider: (account.tradingPlatform as any) || "paper",
        apiKey: account.exchangeData.apiKey,
        secretKey: account.exchangeData.secretKey,
        passphrase: account.exchangeData.passphrase,
        simulated: account.exchangeData.simulated,
      };
      return ExchangeFactory.getClientForAccount(creds);
    }
  }
  return ExchangeFactory.getPaperClient();
}

export async function runPositionMonitor(): Promise<{
  checked: number;
  actions: number;
  errors: string[];
  syncedClosed: number;
}> {
  await connectDB();

  const result = {
    checked: 0,
    actions: 0,
    errors: [] as string[],
    syncedClosed: 0,
  };

  try {
    const openPositions = await Position.find({ status: "open" });
    result.checked = openPositions.length;

    console.log(`📊 Monitoring ${openPositions.length} open positions`);

    // ─── Check pending positions (limit orders waiting to fill) ────────
    const pendingPositions = await Position.find({ status: "pending" });
    if (pendingPositions.length > 0) {
      console.log(
        `⏳ Checking ${pendingPositions.length} pending positions (limit orders)`,
      );

      // Group pending positions by accountId to batch exchange calls
      const accountGroups = new Map<string, typeof pendingPositions>();
      for (const position of pendingPositions) {
        const key = position.accountId || "__global__";
        if (!accountGroups.has(key)) accountGroups.set(key, []);
        accountGroups.get(key)!.push(position);
      }

      for (const [accountId, positions] of accountGroups) {
        let exchange: ExchangeClient;
        try {
          if (accountId !== "__global__") {
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
              exchange = ExchangeFactory.getPaperClient();
            }
          } else {
            exchange = ExchangeFactory.getPaperClient();
          }
        } catch {
          exchange = ExchangeFactory.getPaperClient();
        }

        for (const position of positions) {
          try {
            const inspection = await inspectPendingLimitOrder(exchange, position);

            if (inspection.type === "live") {
              console.log(
                `⏳ Limit order still pending: ${position.symbol} ${position.side} (${inspection.reason})`,
              );
              continue;
            }

            if (inspection.type === "cancelled") {
              position.status = "closed";
              position.closedAt = new Date();
              position.closeReason = inspection.reason;
              await position.save();

              console.log(
                `🚫 Limit order cancelled: ${position.symbol} ${position.side} (${inspection.reason})`,
              );

              await TradeLog.create({
                type: "monitor",
                action: "limit_cancelled",
                symbol: position.symbol,
                details: inspection.reason,
                result: "success",
              });

              result.syncedClosed++;
              continue;
            }

            const oldStatus = position.status;
            position.status = "open";
            if (inspection.fillPrice && inspection.fillPrice > 0) {
              position.entryPrice = inspection.fillPrice;
            }
            await position.save();

            console.log(
              `✅ Limit order filled: ${position.symbol} ${position.side} — promoted from ${oldStatus} to open (${inspection.reason})`,
            );

            await TradeLog.create({
              type: "monitor",
              action: "limit_filled",
              symbol: position.symbol,
              details: `Limit order filled on exchange. Promoted to open. Fill price: ${position.entryPrice}. ${inspection.reason}`,
              result: "success",
            });

            result.actions++;
          } catch (pendingErr) {
            const errMsg =
              pendingErr instanceof Error
                ? pendingErr.message
                : String(pendingErr);
            result.errors.push(`Pending ${position.symbol}: ${errMsg}`);
            console.error(
              `Error checking pending position ${position.symbol}:`,
              errMsg,
            );
          }
        }
      }
    }

    // ─── Sync with exchange: detect positions closed on exchange ───────
    // Group open positions by accountId for per-account exchange sync
    const openByAccount = new Map<string, typeof openPositions>();
    for (const position of openPositions) {
      const key = position.accountId || "__global__";
      if (!openByAccount.has(key)) openByAccount.set(key, []);
      openByAccount.get(key)!.push(position);
    }

    // Collect all exchange positions across accounts
    let exchangePositions: Map<
      string,
      {
        markPrice: number;
        unrealizedPnl: number;
        entryPrice: number;
        quantity: number;
      }
    > = new Map();

    for (const [accountId, positions] of openByAccount) {
      try {
        let exchange: ExchangeClient;
        if (accountId !== "__global__") {
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
            exchange = ExchangeFactory.getPaperClient();
          }
        } else {
          exchange = ExchangeFactory.getPaperClient();
        }

        const exPositions = await exchange.getOpenPositions();
        for (const ep of exPositions) {
          exchangePositions.set(ep.symbol, {
            markPrice: ep.markPrice,
            unrealizedPnl: ep.unrealizedPnl,
            entryPrice: ep.entryPrice,
            quantity: ep.quantity,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          `⚠️ Failed to fetch exchange positions for account ${accountId}: ${errMsg}`,
        );
      }
    }

    console.log(
      `📊 Exchange has ${exchangePositions.size} open positions across all accounts`,
    );

    // Find DB positions that are no longer on the exchange
    for (const position of openPositions) {
      if (!exchangePositions.has(position.symbol)) {
        console.log(
          `🔄 Sync: ${position.symbol} ${position.side} not found on exchange — marking as closed`,
        );
        position.status = "closed";
        position.closedAt = new Date();
        position.closeReason = "Closed on Exchange (external)";
        await position.save();

        await TradeLog.create({
          type: "monitor",
          action: "sync_close",
          symbol: position.symbol,
          details: `Position ${position.side} ${position.symbol} was closed on the exchange externally. Marked as closed in DB.`,
          result: "success",
        });

        result.syncedClosed++;
      }
    }

    // Re-fetch open positions after sync (some may have been closed)
    const activePositions = await Position.find({ status: "open" });

    for (const position of activePositions) {
      try {
        // Resolve exchange for this position based on accountId
        const exchange = await getExchangeForPosition(position);

        // Use exchange position data if available, otherwise fetch ticker
        const exPos = exchangePositions.get(position.symbol);
        let currentPrice: number;
        if (exPos?.markPrice) {
          currentPrice = exPos.markPrice;
        } else {
          currentPrice = await exchange.getTickerPrice(position.symbol);
        }
        position.currentPrice = currentPrice;

        // Calculate PNL
        const priceDiff =
          position.side === "LONG"
            ? currentPrice - position.entryPrice
            : position.entryPrice - currentPrice;
        const pnlPercent = position.entryPrice
          ? (priceDiff / position.entryPrice) * 100 * position.leverage
          : 0;
        position.pnl = pnlPercent;
        await position.save();

        // ─── Rule-based TP/SL checks ──────────────────────────────────

        // Check Stop Loss
        if (position.stopLossPrice) {
          const slHit =
            position.side === "LONG"
              ? currentPrice <= position.stopLossPrice
              : currentPrice >= position.stopLossPrice;

          if (slHit) {
            console.log(`🛑 SL hit for ${position.symbol} at ${currentPrice}`);
            await closePosition(position, currentPrice, "Stop Loss Hit");
            result.actions++;
            continue;
          }
        }

        // Check Take Profit
        const nextTp = position.takeProfitTargets?.find(
          (t: any) => t.status === "pending",
        );
        if (nextTp) {
          const tpHit =
            position.side === "LONG"
              ? currentPrice >= nextTp.price
              : currentPrice <= nextTp.price;

          if (tpHit) {
            console.log(`🎯 TP hit for ${position.symbol} at ${currentPrice}`);
            await closePosition(position, currentPrice, "Take Profit Hit");
            result.actions++;
            continue;
          }
        }

        // ─── AI-assisted analysis ─────────────────────────────────────

        const analyzer = AIFactory.getAnalyzer();
        const analysis = await analyzer.analyzePosition(
          position.symbol,
          position.side,
          position.entryPrice,
          currentPrice,
          position.takeProfitTargets?.[0]?.price ?? undefined,
          position.stopLossPrice ?? undefined,
          pnlPercent,
          position.quantity,
        );

        console.log(
          `🤖 AI analysis for ${position.symbol}: ${analysis.decision} (${analysis.confidence}%)`,
        );

        switch (analysis.decision) {
          case "CLOSE": {
            if (analysis.confidence >= 70) {
              await closePosition(
                position,
                currentPrice,
                `AI Close: ${analysis.reason}`,
              );
              result.actions++;
            }
            break;
          }

          case "MOVE_SL": {
            if (analysis.newStopLoss && analysis.confidence >= 60) {
              const oldSL = position.stopLossPrice;
              position.stopLossPrice = analysis.newStopLoss;
              await position.save();

              await TradeLog.create({
                type: "monitor",
                action: "move_sl",
                symbol: position.symbol,
                details: `SL moved from ${oldSL} to ${analysis.newStopLoss}. Reason: ${analysis.reason}`,
                result: "success",
              });
              result.actions++;
            }
            break;
          }

          case "PARTIAL_CLOSE": {
            if (analysis.confidence >= 70) {
              const closeQty =
                analysis.closePercentage && position.quantity
                  ? (position.quantity * analysis.closePercentage) / 100
                  : position.quantity / 2;

              try {
                await exchange.closePosition(
                  position.symbol,
                  position.orderId,
                  closeQty,
                );

                // Update position with remaining quantity
                const remaining = position.quantity - closeQty;
                if (remaining > 0) {
                  position.quantity = remaining;
                  await position.save();
                } else {
                  position.status = "closed";
                  position.closedAt = new Date();
                  position.closeReason = `AI Partial Close: ${analysis.reason}`;
                  await position.save();
                }

                await TradeLog.create({
                  type: "monitor",
                  action: "partial_close",
                  symbol: position.symbol,
                  details: `Closed ${analysis.closePercentage || 50}% @ ${currentPrice}. Reason: ${analysis.reason}`,
                  result: "success",
                });
                result.actions++;
              } catch (err) {
                console.error(
                  `Failed to partial close ${position.symbol}:`,
                  err,
                );
              }
            }
            break;
          }

          case "UPDATE_TP": {
            if (analysis.newTakeProfit && analysis.confidence >= 60) {
              const firstPending = position.takeProfitTargets.findIndex(
                (t: any) => t.status === "pending",
              );
              if (firstPending >= 0) {
                position.takeProfitTargets[firstPending].price =
                  analysis.newTakeProfit;
              } else {
                position.takeProfitTargets.push({
                  price: analysis.newTakeProfit,
                  quantity: position.quantity,
                  percentage: 0,
                  status: "pending",
                });
              }
              await position.save();

              await TradeLog.create({
                type: "monitor",
                action: "update_tp",
                symbol: position.symbol,
                details: `TP updated to ${analysis.newTakeProfit}. Reason: ${analysis.reason}`,
                result: "success",
              });
              result.actions++;
            }
            break;
          }

          case "HOLD":
          default:
            // Position is healthy, do nothing
            break;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`${position.symbol}: ${errMsg}`);

        await TradeLog.create({
          type: "monitor",
          action: "error",
          symbol: position.symbol,
          error: errMsg,
        });

        console.error(`Error monitoring ${position.symbol}:`, errMsg);
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`General: ${errMsg}`);
    console.error("Position monitor error:", errMsg);
  }

  console.log(
    `✅ Position monitor complete: ${result.checked} checked, ${result.actions} actions taken`,
  );
  return result;
}

async function closePosition(
  position: import("./database").IPosition & { save: () => Promise<unknown> },
  currentPrice: number,
  reason: string,
): Promise<void> {
  try {
    const exchange = await getExchangeForPosition(position);
    await exchange.closePosition(
      position.symbol,
      position.orderId,
      position.quantity,
    );
  } catch (err) {
    console.warn(
      `Exchange close failed for ${position.symbol}, marking as closed in DB:`,
      err instanceof Error ? err.message : err,
    );
  }

  position.status = "closed";
  position.closedAt = new Date();
  position.closeReason = reason;
  position.currentPrice = currentPrice;
  await position.save();

  await TradeLog.create({
    type: "monitor",
    action: "close",
    symbol: position.symbol,
    details: `Closed @ ${currentPrice}. Reason: ${reason}`,
    result: "success",
  });

  console.log(`✅ Closed ${position.symbol}: ${reason}`);
}
