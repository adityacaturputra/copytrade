import { connectDB, Position, Account } from "../database/index";
import { AIFactory } from "../ai/core/factory";
import { buildPositionAnalysisInput } from "../ai/position-monitor/context";
import {
  ExchangeFactory,
  buildExchangeCredentials,
} from "../exchange/ExchangeFactory";
import { ExchangeClient } from "../exchange/types";
import { getHttpErrorDetails } from "../http/error";
import { inspectPendingLimitOrder } from "./pending-order-sync";
import {
  logExecutorError,
  logExecutorInfo,
  logExecutorWarn,
  logProcessStep,
} from "../process/log";
import { ensurePersistedProcessId } from "../process/id";

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
      const creds = buildExchangeCredentials(
        account.tradingPlatform,
        account.exchangeData as Record<string, unknown>,
        { proxyAffinityKey: String(position.accountId) },
      );
      if (creds) return ExchangeFactory.getClientForAccount(creds);
    }
  }
  return ExchangeFactory.getPaperClient();
}

function getAccountPositionKey(
  accountId: string | undefined,
  symbol: string,
): string {
  return `${accountId || "__global__"}::${symbol}`;
}

export function calculatePositionPnlUsd(
  position: {
    entryPrice: number;
    quantity: number;
    side: string;
  },
  currentPrice: number,
): number | null {
  if (
    !Number.isFinite(position.entryPrice) ||
    !Number.isFinite(position.quantity) ||
    !Number.isFinite(currentPrice) ||
    position.entryPrice <= 0 ||
    position.quantity <= 0
  ) {
    return null;
  }

  const gross =
    position.side === "LONG"
      ? (currentPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - currentPrice) * position.quantity;
  return Number(gross.toFixed(4));
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

    await logExecutorInfo(`📊 Monitoring ${openPositions.length} open positions`, {
      type: "monitor",
      action: "monitor_started",
      level: "debug",
    });

    // ─── Check pending positions (limit orders waiting to fill) ────────
    const pendingPositions = await Position.find({ status: "pending" });
    if (pendingPositions.length > 0) {
      await logExecutorInfo(
        `⏳ Checking ${pendingPositions.length} pending positions (limit orders)`,
        {
          type: "monitor",
          action: "pending_positions_check",
          level: "debug",
        },
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
              const creds = buildExchangeCredentials(
                account.tradingPlatform,
                account.exchangeData as Record<string, unknown>,
                { proxyAffinityKey: String(accountId) },
              );
              exchange = creds
                ? ExchangeFactory.getClientForAccount(creds)
                : ExchangeFactory.getPaperClient();
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
          const processId = await ensurePersistedProcessId(position, "pendmon");

          try {
            await logProcessStep({
              accountId: position.accountId,
              processId,
              type: "monitor",
              action: "pending_position_check_started",
              symbol: position.symbol,
              details: {
                positionId: position._id.toString(),
                currentTime: new Date().toISOString(),
                orderId: position.orderId || null,
              },
              level: "debug",
              result: "processing",
            });

            const inspection = await inspectPendingLimitOrder(exchange, position);

            if (inspection.type === "live") {
              await logExecutorInfo(
                `⏳ Limit order still pending: ${position.symbol} ${position.side} (${inspection.reason})`,
                {
                  accountId: position.accountId,
                  processId,
                symbol: position.symbol,
                type: "monitor",
                action: "pending_limit_still_live",
                level: "debug",
              },
            );
              continue;
            }

            if (inspection.type === "cancelled") {
              position.status = "closed";
              position.closedAt = new Date();
              position.closeReason = inspection.reason;
              await position.save();

              await logExecutorInfo(
                `🚫 Limit order cancelled: ${position.symbol} ${position.side} (${inspection.reason})`,
                {
                  accountId: position.accountId,
                  processId,
                  symbol: position.symbol,
                  type: "monitor",
                  action: "limit_cancelled_summary",
                },
              );

              await logProcessStep({
                accountId: position.accountId,
                processId,
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

            await logExecutorInfo(
              `✅ Limit order filled: ${position.symbol} ${position.side} — promoted from ${oldStatus} to open (${inspection.reason})`,
              {
                accountId: position.accountId,
                processId,
                symbol: position.symbol,
                type: "monitor",
                action: "limit_filled_summary",
              },
            );

            await logProcessStep({
              accountId: position.accountId,
              processId,
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
            const httpDetails = getHttpErrorDetails(pendingErr);
            const responseSuffix = httpDetails.responseBody
              ? ` | response=${httpDetails.responseBody}`
              : "";
            result.errors.push(`Pending ${position.symbol}: ${errMsg}`);
            await logExecutorError(
              `Error checking pending position ${position.symbol}: ${errMsg}${responseSuffix}`,
              {
                accountId: position.accountId,
                processId,
                symbol: position.symbol,
                type: "monitor",
                action: "pending_position_check_error",
              },
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

    for (const [accountId] of openByAccount) {
      try {
        let exchange: ExchangeClient;
        if (accountId !== "__global__") {
          const account = await Account.findById(accountId).lean();
          if (account?.exchangeData) {
            const creds = buildExchangeCredentials(
              account.tradingPlatform,
              account.exchangeData as Record<string, unknown>,
              { proxyAffinityKey: String(accountId) },
            );
            exchange = creds
              ? ExchangeFactory.getClientForAccount(creds)
              : ExchangeFactory.getPaperClient();
          } else {
            exchange = ExchangeFactory.getPaperClient();
          }
        } else {
          exchange = ExchangeFactory.getPaperClient();
        }

        const exPositions = await exchange.getOpenPositions();
        for (const ep of exPositions) {
          exchangePositions.set(getAccountPositionKey(accountId, ep.symbol), {
            markPrice: ep.markPrice,
            unrealizedPnl: ep.unrealizedPnl,
            entryPrice: ep.entryPrice,
            quantity: ep.quantity,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const httpDetails = getHttpErrorDetails(err);
        const responseSuffix = httpDetails.responseBody
          ? ` | response=${httpDetails.responseBody}`
          : "";
        await logExecutorWarn(
          `⚠️ Failed to fetch exchange positions for account ${accountId}: ${errMsg}${responseSuffix}`,
          {
            accountId: accountId === "__global__" ? undefined : accountId,
            type: "monitor",
            action: "exchange_positions_fetch_failed",
          },
        );
      }
    }

    await logExecutorInfo(
      `📊 Exchange has ${exchangePositions.size} open positions across all accounts`,
      {
        type: "monitor",
        action: "exchange_positions_snapshot",
        level: "debug",
      },
    );

    // Find DB positions that are no longer on the exchange
    for (const position of openPositions) {
      const syncKey = getAccountPositionKey(position.accountId, position.symbol);

      if (!exchangePositions.has(syncKey)) {
        const processId = await ensurePersistedProcessId(position, "syncmon");

        await logExecutorInfo(
          `🔄 Sync: ${position.symbol} ${position.side} not found on exchange — marking as closed`,
          {
            accountId: position.accountId,
            processId,
            symbol: position.symbol,
            type: "monitor",
            action: "sync_close_detected",
            level: "debug",
          },
        );
        position.status = "closed";
        position.closedAt = new Date();
        position.closeReason = "Closed on Exchange (external)";
        await position.save();

        await logProcessStep({
          accountId: position.accountId,
          processId,
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
      const processId = await ensurePersistedProcessId(position, "posmon");

      try {
        await logProcessStep({
          accountId: position.accountId,
          processId,
          type: "monitor",
          action: "position_monitor_started",
          symbol: position.symbol,
          details: {
            positionId: position._id.toString(),
            currentTime: new Date().toISOString(),
            sourceMessageId: position.messageId || null,
            sourceChannelId: position.channelId || null,
          },
          level: "debug",
          result: "processing",
        });

        // Resolve exchange for this position based on accountId
        const exchange = await getExchangeForPosition(position);

        // Use exchange position data if available, otherwise fetch ticker
        const exPos = exchangePositions.get(
          getAccountPositionKey(position.accountId, position.symbol),
        );
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
        position.pnlUsd =
          exPos?.unrealizedPnl ?? calculatePositionPnlUsd(position, currentPrice);
        await position.save();

        // ─── Rule-based TP/SL checks ──────────────────────────────────

        // Check Stop Loss
        if (position.stopLossPrice) {
          const slHit =
            position.side === "LONG"
              ? currentPrice <= position.stopLossPrice
              : currentPrice >= position.stopLossPrice;

          if (slHit) {
            await logExecutorInfo(
              `🛑 SL hit for ${position.symbol} at ${currentPrice}`,
              {
                accountId: position.accountId,
                processId,
                symbol: position.symbol,
                type: "monitor",
                action: "stop_loss_hit",
              },
            );
            await closePosition(
              position,
              currentPrice,
              "Stop Loss Hit",
              processId,
            );
            result.actions++;
            continue;
          }
        }



        // ─── AI-assisted analysis ─────────────────────────────────────

        const analyzer = AIFactory.getAnalyzer();
        const aiInput = await buildPositionAnalysisInput(
          position,
          currentPrice,
          pnlPercent,
          processId,
        );

        await logProcessStep({
          accountId: position.accountId,
          processId,
          type: "monitor",
          action: "ai_analysis_requested",
          symbol: position.symbol,
          details: {
            currentTime: aiInput.currentTime,
            accountOpenPositionsCount: aiInput.accountOpenPositions?.length || 0,
            discordContextCount: aiInput.discordContextMessages?.length || 0,
          },
          result: "processing",
        });

        const analysis = await analyzer.analyzePosition(aiInput);

        await logProcessStep({
          accountId: position.accountId,
          processId,
          type: "monitor",
          action: "ai_analysis_completed",
          symbol: position.symbol,
          details: analysis,
          result: "analyzed",
        });

        await logExecutorInfo(
          `🤖 AI analysis for ${position.symbol}: ${analysis.decision} (${analysis.confidence}%)`,
          {
            accountId: position.accountId,
            processId,
            symbol: position.symbol,
            type: "monitor",
            action: "ai_analysis_summary",
          },
        );

        switch (analysis.decision) {
          case "CLOSE": {
            if (analysis.confidence >= 70) {
              await closePosition(
                position,
                currentPrice,
                `AI Close: ${analysis.reason}`,
                processId,
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

              await logProcessStep({
                accountId: position.accountId,
                processId,
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

                await logProcessStep({
                  accountId: position.accountId,
                  processId,
                  type: "monitor",
                  action: "partial_close",
                  symbol: position.symbol,
                  details: `Closed ${analysis.closePercentage || 50}% @ ${currentPrice}. Reason: ${analysis.reason}`,
                  result: "success",
                });
                result.actions++;
              } catch (err) {
                await logExecutorError(
                  `Failed to partial close ${position.symbol}: ${err instanceof Error ? err.message : String(err)}`,
                  {
                    accountId: position.accountId,
                    processId,
                    symbol: position.symbol,
                    type: "monitor",
                    action: "partial_close_error",
                  },
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

              await logProcessStep({
                accountId: position.accountId,
                processId,
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

        await logProcessStep({
          accountId: position.accountId,
          processId,
          type: "monitor",
          action: "error",
          symbol: position.symbol,
          error: errMsg,
          result: "failed",
        });

        await logExecutorError(`Error monitoring ${position.symbol}: ${errMsg}`, {
          accountId: position.accountId,
          processId,
          symbol: position.symbol,
          type: "monitor",
          action: "monitor_position_error",
        });
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`General: ${errMsg}`);
    await logExecutorError(`Position monitor error: ${errMsg}`, {
      type: "monitor",
      action: "monitor_general_error",
    });
  }

  await logExecutorInfo(
    `✅ Position monitor complete: ${result.checked} checked, ${result.actions} actions taken`,
    {
      type: "monitor",
      action: "monitor_completed",
      level: "debug",
    },
  );
  return result;
}

async function closePosition(
  position: import("../database/index").IPosition & { save: () => Promise<unknown> },
  currentPrice: number,
  reason: string,
  processId?: string,
): Promise<void> {
  let exchange: ExchangeClient | null = null;
  try {
    exchange = await getExchangeForPosition(position);
    await exchange.closePosition(
      position.symbol,
      position.orderId,
      position.quantity,
    );
  } catch (err) {
    await logExecutorWarn(
      `Exchange close failed for ${position.symbol}, marking as closed in DB: ${err instanceof Error ? err.message : String(err)}`,
      {
        accountId: position.accountId,
        processId,
        symbol: position.symbol,
        type: "monitor",
        action: "exchange_close_failed",
      },
    );
  }

  position.status = "closed";
  position.closedAt = new Date();
  position.closeReason = reason;
  position.currentPrice = currentPrice;
  position.pnlUsd =
    calculatePositionPnlUsd(position, currentPrice) ?? position.pnlUsd ?? null;
  await position.save();

  await logProcessStep({
    accountId: position.accountId,
    processId,
    type: "monitor",
    action: "close",
    symbol: position.symbol,
    details: `Closed @ ${currentPrice}. Reason: ${reason}`,
    result: "success",
  });

  await logExecutorInfo(`✅ Closed ${position.symbol}: ${reason}`, {
    accountId: position.accountId,
    processId,
    symbol: position.symbol,
    type: "monitor",
    action: "close_completed",
  });
}
