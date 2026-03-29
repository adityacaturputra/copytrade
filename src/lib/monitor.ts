import { connectDB, Position, TradeLog } from "./database";
import { AIFactory } from "./ai/AIFactory";
import { ExchangeFactory } from "./exchange/ExchangeFactory";

export async function runPositionMonitor(): Promise<{
  checked: number;
  actions: number;
  errors: string[];
}> {
  await connectDB();

  const result = {
    checked: 0,
    actions: 0,
    errors: [] as string[],
  };

  try {
    const openPositions = await Position.find({ status: "open" });
    result.checked = openPositions.length;

    console.log(`📊 Monitoring ${openPositions.length} open positions`);

    for (const position of openPositions) {
      try {
        // Get current price from exchange
        const exchange = ExchangeFactory.getClient();
        const currentPrice = await exchange.getTickerPrice(position.symbol);
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
        if (position.takeProfitPrice) {
          const tpHit =
            position.side === "LONG"
              ? currentPrice >= position.takeProfitPrice
              : currentPrice <= position.takeProfitPrice;

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
          position.takeProfitPrice ?? undefined,
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
              position.takeProfitPrice = analysis.newTakeProfit;
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
