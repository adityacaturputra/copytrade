import { connectDB, Position, TradeLog } from "./database";
import { AIFactory } from "./ai/AIFactory";
import { ExchangeFactory } from "./exchange/ExchangeFactory";

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

      const exchange = ExchangeFactory.getClient();

      for (const position of pendingPositions) {
        try {
          // Check open orders on exchange to see if limit order is still live
          const openOrders = await exchange.getOpenOrders(position.symbol);
          const orderStillOpen = openOrders.some(
            (o) => o.orderId === position.orderId,
          );

          if (orderStillOpen) {
            // Limit order is still waiting — do nothing
            console.log(
              `⏳ Limit order still pending: ${position.symbol} ${position.side} (orderId: ${position.orderId})`,
            );
            continue;
          }

          // Order is no longer in open orders — check order history for fill status
          const orderHistory = await exchange.getOrderHistory(position.symbol);
          const matchingOrder = orderHistory.find(
            (o) => o.orderId === position.orderId,
          );

          if (matchingOrder) {
            const orderState =
              (matchingOrder as any).state || matchingOrder.status;
            if (
              orderState === "filled" ||
              orderState === "partially_filled" ||
              orderState === "FILLED" ||
              orderState === "PARTIALLY_FILLED"
            ) {
              // Order filled — promote to "open"
              const oldStatus = position.status;
              position.status = "open";
              if (matchingOrder.price && matchingOrder.price > 0) {
                position.entryPrice = matchingOrder.price;
              }
              await position.save();

              console.log(
                `✅ Limit order filled: ${position.symbol} ${position.side} — promoted from ${oldStatus} to open (fillPrice: ${matchingOrder.price})`,
              );

              await TradeLog.create({
                type: "monitor",
                action: "limit_filled",
                symbol: position.symbol,
                details: `Limit order filled on exchange. Promoted to open. Fill price: ${matchingOrder.price}`,
                result: "success",
              });

              result.actions++;
            } else if (
              orderState === "cancelled" ||
              orderState === "canceled" ||
              orderState === "CANCELLED" ||
              orderState === "CANCELED"
            ) {
              // Order was cancelled — mark as closed
              position.status = "closed";
              position.closedAt = new Date();
              position.closeReason = "Limit order cancelled on exchange";
              await position.save();

              console.log(
                `🚫 Limit order cancelled: ${position.symbol} ${position.side}`,
              );

              await TradeLog.create({
                type: "monitor",
                action: "limit_cancelled",
                symbol: position.symbol,
                details: `Limit order was cancelled on exchange. Marked as closed.`,
                result: "success",
              });

              result.syncedClosed++;
            } else {
              console.log(
                `ℹ️ Limit order state: ${position.symbol} = ${orderState}`,
              );
            }
          } else {
            // Order not found in open orders or history — it may have been filled
            // and the position is now on exchange. Check if position exists.
            const exPositions = await exchange.getOpenPositions();
            const hasPosition = exPositions.some(
              (ep) => ep.symbol === position.symbol,
            );

            if (hasPosition) {
              // Position exists on exchange — the order was filled
              position.status = "open";
              await position.save();

              console.log(
                `✅ Limit order filled (detected via position): ${position.symbol} ${position.side}`,
              );

              await TradeLog.create({
                type: "monitor",
                action: "limit_filled",
                symbol: position.symbol,
                details: `Limit order filled (detected via open position on exchange). Promoted to open.`,
                result: "success",
              });

              result.actions++;
            } else {
              // No open order, no history, no position — likely cancelled or expired
              console.warn(
                `⚠️ Limit order not found anywhere: ${position.symbol} — marking as closed`,
              );
              position.status = "closed";
              position.closedAt = new Date();
              position.closeReason =
                "Limit order not found on exchange (likely expired)";
              await position.save();

              result.syncedClosed++;
            }
          }
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

    // ─── Sync with exchange: detect positions closed on exchange ───────
    let exchangePositions: Map<
      string,
      {
        markPrice: number;
        unrealizedPnl: number;
        entryPrice: number;
        quantity: number;
      }
    > = new Map();
    try {
      const exchange = ExchangeFactory.getClient();
      const exPositions = await exchange.getOpenPositions();
      for (const ep of exPositions) {
        exchangePositions.set(ep.symbol, {
          markPrice: ep.markPrice,
          unrealizedPnl: ep.unrealizedPnl,
          entryPrice: ep.entryPrice,
          quantity: ep.quantity,
        });
      }
      console.log(`📊 Exchange has ${exchangePositions.size} open positions`);

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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ Failed to fetch exchange positions for sync: ${errMsg}`);
      // Continue with price-based monitoring even if sync fails
    }

    // Re-fetch open positions after sync (some may have been closed)
    const activePositions = await Position.find({ status: "open" });

    for (const position of activePositions) {
      try {
        // Use exchange position data if available, otherwise fetch ticker
        const exPos = exchangePositions.get(position.symbol);
        let currentPrice: number;
        if (exPos?.markPrice) {
          currentPrice = exPos.markPrice;
        } else {
          const exchange = ExchangeFactory.getClient();
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
                const ex = ExchangeFactory.getClient();
                await ex.closePosition(
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
    const exchange = ExchangeFactory.getClient();
    await exchange.closePosition(
      position.symbol,
      position.orderId,
      position.quantity,
    );
  } catch (err) {
    console.warn(
      `MEXC close failed for ${position.symbol}, marking as closed in DB:`,
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
