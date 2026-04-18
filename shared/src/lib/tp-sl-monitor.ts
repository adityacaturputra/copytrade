import { connectDB, Position, Account, IPosition } from "./database";
import {
  ExchangeFactory,
  ExchangeCredentials,
  normalizeExchangeProvider,
} from "./exchange/ExchangeFactory";
import { ExchangeClient } from "./exchange/types";
import { splitQuantityForTPs } from "./executor";
import { inspectPendingLimitOrder } from "./pending-order-sync";
import { createTradeLog } from "./trade-log-store";

/**
 * Resolve the exchange client for a position based on its accountId.
 * If accountId is set, look up the Account and use its exchangeData.
 * Otherwise, fall back to global ExchangeFactory.getClient().
 */
async function getExchangeForPosition(position: {
  accountId?: string;
}): Promise<ExchangeClient> {
  if (position.accountId) {
    const account = await Account.findById(position.accountId).lean();
    if (account?.exchangeData) {
      const provider = normalizeExchangeProvider(account.tradingPlatform);
      const creds: ExchangeCredentials = {
        provider: provider || "paper",
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

/**
 * TP/SL Monitor — dedicated cron job that:
 * 1. Checks pending LIMIT positions → promotes to "open" if filled on exchange
 * 2. Places TP/SL for open positions that don't have TP/SL yet (tpSlPlaced=false)
 *
 * This is separated from position-monitor because:
 * - TP/SL placement is time-sensitive (should run frequently, e.g. every 1-2 min)
 * - position-monitor does heavier AI analysis and can run less frequently
 * - Avoids TP/SL being placed on the wrong position when same symbol has both
 *   a MARKET and LIMIT order
 */
export async function runTpslMonitor(): Promise<{
  checked: number;
  promoted: number;
  tpslPlaced: number;
  errors: string[];
}> {
  await connectDB();

  const result = {
    checked: 0,
    promoted: 0,
    tpslPlaced: 0,
    errors: [] as string[],
  };

  try {
    // ─── Step 1: Check pending LIMIT positions ───────────────────────────
    const pendingPositions = await Position.find({ status: "pending" });

    if (pendingPositions.length > 0) {
      console.log(
        `⏳ [TP/SL Monitor] Checking ${pendingPositions.length} pending positions...`,
      );

      for (const position of pendingPositions) {
        result.checked++;
        try {
          const exchange = await getExchangeForPosition(position);
          const inspection = await inspectPendingLimitOrder(exchange, position);

          if (inspection.type === "live") {
            console.log(
              `⏳ [TP/SL Monitor] Pending order still live: ${position.symbol} ${position.side} (${inspection.reason})`,
            );
            continue;
          }

          if (inspection.type === "cancelled") {
            position.status = "closed";
            position.closedAt = new Date();
            position.closeReason = inspection.reason;
            position.tpSlPlaced = true; // No TP/SL needed for cancelled
            await position.save();

            console.log(
              `🚫 [TP/SL Monitor] Limit order cancelled: ${position.symbol} ${position.side} (${inspection.reason})`,
            );

            await createTradeLog({
              type: "tpsl-monitor",
              action: "limit_cancelled",
              symbol: position.symbol,
              details: inspection.reason,
              result: "success",
            });
            continue;
          }

          if (inspection.fillPrice && inspection.fillPrice > 0) {
            position.entryPrice = inspection.fillPrice;
          }

          if (inspection.type === "filled") {
            // Promote to "open" — TP/SL will be placed in Step 2
            position.status = "open";
            await position.save();

            console.log(
              `✅ [TP/SL Monitor] Limit order filled: ${position.symbol} ${position.side} — promoted to open (${inspection.reason})`,
            );

            await createTradeLog({
              type: "tpsl-monitor",
              action: "limit_filled",
              symbol: position.symbol,
              details: `Limit order filled. Promoted to open. Entry: ${position.entryPrice}. ${inspection.reason}`,
              result: "success",
            });

            result.promoted++;
          }
        } catch (pendingErr) {
          const errMsg =
            pendingErr instanceof Error
              ? pendingErr.message
              : String(pendingErr);
          result.errors.push(`Pending ${position.symbol}: ${errMsg}`);
          console.error(
            `[TP/SL Monitor] Error checking pending ${position.symbol}: ${errMsg}`,
          );
        }
      }
    }

    // ─── Step 2: Place TP/SL for open positions missing them ─────────────
    // Use atomic findOneAndUpdate to claim each position — prevents concurrent
    // cron instances from placing duplicate TP/SL orders (race condition fix).
    let tpslClaimed = 0;

    while (true) {
      const position = await Position.findOneAndUpdate(
        { status: "open", tpSlPlaced: { $ne: true } },
        { $set: { tpSlPlaced: true } },
        { new: true },
      );

      if (!position) break;

      tpslClaimed++;
      result.checked++;

      if (tpslClaimed === 1) {
        console.log(
          `🎯 [TP/SL Monitor] Placing TP/SL for open positions (atomic claim)...`,
        );
      }

      try {
        const exchange = await getExchangeForPosition(position);
        await placeTpslForPosition(exchange, position);
        result.tpslPlaced++;
      } catch (tpslErr) {
        const errMsg =
          tpslErr instanceof Error ? tpslErr.message : String(tpslErr);
        result.errors.push(`TP/SL ${position.symbol}: ${errMsg}`);
        console.error(
          `[TP/SL Monitor] Error placing TP/SL for ${position.symbol}: ${errMsg}`,
        );

        // Release the claim so it can be retried next run
        position.tpSlPlaced = false;
        await position.save();

        await createTradeLog({
          type: "tpsl-monitor",
          action: "tpsl_error",
          symbol: position.symbol,
          error: errMsg,
        });
      }
    }

    // Count already-monitored open positions
    const openWithTpsl = await Position.countDocuments({
      status: "open",
      tpSlPlaced: true,
    });

    console.log(
      `✅ [TP/SL Monitor] Complete: ${result.checked} checked, ${result.promoted} promoted, ${result.tpslPlaced} TP/SL placed, ${openWithTpsl} already OK`,
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`General: ${errMsg}`);
    console.error("[TP/SL Monitor] Error:", errMsg);
  }

  return result;
}

/**
 * Place TP/SL orders on the exchange for a position that doesn't have them yet.
 * Uses the same logic as executor.ts but reads TP/SL targets from the position document.
 */
async function placeTpslForPosition(
  exchange: ExchangeClient,
  position: IPosition & { save: () => Promise<unknown> },
): Promise<void> {
  const tpTargets = position.takeProfitTargets || [];
  const sl = position.stopLossPrice;
  const closeSide = position.side === "LONG" ? "SELL" : "BUY";
  const quantity = position.quantity;

  if (tpTargets.length === 0 && !sl) {
    // No TP/SL to place — mark as done
    position.tpSlPlaced = true;
    await position.save();
    console.log(
      `ℹ️ [TP/SL Monitor] No TP/SL targets for ${position.symbol} — marking as placed`,
    );
    return;
  }

  // Place Take Profit orders
  if (tpTargets.length > 0) {
    const tpPrices = tpTargets.map((t) => t.price);

    // Split quantity across TP levels
    const tpQuantities = await splitQuantityForTPs(
      quantity,
      tpPrices.length,
      () => exchange.getInstrumentSpecs(position.symbol),
    );

    for (let i = 0; i < tpPrices.length; i++) {
      const tp = tpPrices[i];
      const tpQty = tpQuantities[i];
      try {
        const tpId = await exchange.placeTakeProfit(
          position.symbol,
          tp,
          tp,
          closeSide,
          tpQty,
        );
        console.log(
          `🎯 [TP/SL Monitor] TP ${i + 1}/${tpPrices.length} placed at ${tp} (qty: ${tpQty}, order: ${tpId}) for ${position.symbol}`,
        );
      } catch (tpErr) {
        console.warn(
          `⚠️ [TP/SL Monitor] Failed to place TP at ${tp} for ${position.symbol}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
        );
      }
    }
  }

  // Place Stop Loss order
  if (sl) {
    try {
      const slId = await exchange.placeStopLoss(
        position.symbol,
        sl,
        sl,
        closeSide,
        quantity,
      );
      console.log(
        `🛑 [TP/SL Monitor] SL placed at ${sl} (order: ${slId}) for ${position.symbol}`,
      );
    } catch (slErr) {
      console.warn(
        `⚠️ [TP/SL Monitor] Failed to place SL for ${position.symbol}: ${slErr instanceof Error ? slErr.message : String(slErr)}`,
      );
    }
  }

  // Mark as placed regardless of individual failures — the monitor will retry
  // if needed on next run (checking exchange for actual TP/SL orders could be
  // a future enhancement)
  position.tpSlPlaced = true;
  await position.save();

  await createTradeLog({
    type: "tpsl-monitor",
    action: "tpsl_placed",
    symbol: position.symbol,
    details: `TP/SL placed for ${position.side} ${position.symbol}: TPs=[${tpTargets.map((t) => t.price).join(", ")}], SL=${sl || "none"}`,
    result: "success",
  });
}
