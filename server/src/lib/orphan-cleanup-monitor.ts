import { Account, Position } from "@copytrade/shared/lib/database/index";
import { getSignalConfig } from "@copytrade/shared/lib/signal/config";
import { ExchangeFactory } from "@copytrade/shared/lib/exchange/ExchangeFactory";
import { createTradeLog } from "@copytrade/shared/lib/trade-log/store";
import {
  toExchangeCredentials,
  type AccountRecord,
} from "./agent/tooling/shared";

export async function runOrphanCleanupMonitor() {
  const result = {
    accountsChecked: 0,
    algoOrdersChecked: 0,
    orphansCancelled: 0,
    symbolsCleaned: [] as string[],
    cancelledOrderIds: [] as string[],
    errors: [] as string[],
  };

  try {
    const activeAccounts = await Account.find({ isActive: true }).exec();

    if (!activeAccounts || activeAccounts.length === 0) {
      console.log(
        `[OrphanCleanup] No active accounts found — nothing to clean`,
      );
      return result;
    }

    // Fast Database Gate:
    // If there are no open/pending positions AND no positions closed within the configured lookback window,
    // there cannot be any new orphaned protection orders. Skip exchange calls to conserve proxy quota.
    const signalCfg = await getSignalConfig();
    const lookbackHours = Math.max(
      1,
      Number(signalCfg.orphanCleanupLookbackHours) || 6,
    );
    const recentCutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const activeOrRecentPositionsCount = await Position.countDocuments?.({
      $or: [
        { status: { $in: ["open", "pending"] } },
        { closedAt: { $gte: recentCutoff } },
      ],
    }).catch(() => null);

    if (activeOrRecentPositionsCount === 0) {
      console.log(
        `[OrphanCleanup] No open, pending, or recently closed positions in DB — skipping exchange audit to conserve proxy quota`,
      );
      return result;
    }

    for (const account of activeAccounts) {
      try {
        result.accountsChecked++;

        // Ensure exchange is configured
        if (!account.tradingPlatform || !account.exchangeData) {
          console.log(
            `[OrphanCleanup] Skipping account "${account.name}" because exchange is not configured`,
          );
          continue;
        }

        const credentials = toExchangeCredentials(
          account as unknown as AccountRecord,
        );
        const exchange = ExchangeFactory.getClientForAccount(credentials);

        console.log(
          `[OrphanCleanup] Checking account "${account.name}" on ${exchange.name}`,
        );

        // Fetch exchange state. Orphan cleanup must only preserve protection
        // for symbols that still have a tracked or live position.
        const [algoOrders, openPositions, trackedPositions] = await Promise.all(
          [
            exchange.getAlgoOrders(), // Call without symbol to get all
            exchange.getOpenPositions(),
            Position.find({
              accountId: String(account._id),
              status: { $in: ["open", "pending"] },
            })
              .lean()
              .exec(),
          ],
        );

        if (!algoOrders || algoOrders.length === 0) {
          console.log(
            `[OrphanCleanup] Account "${account.name}": no algo orders found`,
          );
          continue;
        }

        result.algoOrdersChecked += algoOrders.length;

        // Collect valid symbols
        const trackedSymbols = new Set(
          trackedPositions.map((pos: any) => pos.symbol),
        );
        const livePositionSymbols = new Set(
          openPositions.map((pos: any) => pos.symbol),
        );

        // Find orphaned algo orders
        const orphanCandidates = algoOrders.filter(
          (order: any) =>
            !trackedSymbols.has(order.symbol) &&
            !livePositionSymbols.has(order.symbol),
        );

        if (orphanCandidates.length === 0) {
          console.log(
            `[OrphanCleanup] Account "${account.name}": no orphan protection orders (algo=${algoOrders.length}, tracked=${trackedSymbols.size}, live=${livePositionSymbols.size})`,
          );
          continue;
        }

        const symbolsToCleanup = [
          ...new Set(orphanCandidates.map((o: any) => o.symbol)),
        ];

        console.log(
          `[OrphanCleanup] Account "${account.name}": found ${orphanCandidates.length} orphan protection order(s) across ${symbolsToCleanup.length} symbol(s): ${symbolsToCleanup.join(", ")}`,
        );

        await createTradeLog({
          type: "cron",
          action: "orphan_cleanup_candidate",
          details: `Account "${account.name}": ${orphanCandidates.length} orphan order(s) found — symbols: [${symbolsToCleanup.join(", ")}], tracked: [${[...trackedSymbols].join(", ")}], live: [${[...livePositionSymbols].join(", ")}]`,
          level: "info",
          result: "candidates_found",
        });

        if (symbolsToCleanup.length > 0) {
          for (const targetSymbol of symbolsToCleanup) {
            try {
              const cancelResult =
                await exchange.cancelAlgoOrders(targetSymbol);
              result.orphansCancelled += cancelResult.cancelled.length;
              result.symbolsCleaned.push(targetSymbol);
              result.cancelledOrderIds.push(...cancelResult.cancelled);
              console.log(
                `[OrphanCleanup] Account "${account.name}" cleaned ${targetSymbol}: cancelled=${cancelResult.cancelled.join(", ") || "-"} errors=${cancelResult.errors.length}`,
              );
              await createTradeLog({
                type: "cron",
                action: "orphan_cleanup_cancelled",
                details: `Account "${account.name}" cancelled ${cancelResult.cancelled.length} algo order(s) for ${targetSymbol} — order IDs: [${cancelResult.cancelled.join(", ")}]`,
                level: "info",
                result: "cancelled",
              });
              if (cancelResult.errors.length > 0) {
                result.errors.push(...cancelResult.errors);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              result.errors.push(
                `[${account.name}] Failed to cancel algo orders for ${targetSymbol}: ${msg}`,
              );
              console.warn(
                `[OrphanCleanup] Account "${account.name}" failed cleaning ${targetSymbol}: ${msg}`,
              );
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`[${account.name}] Account error: ${msg}`);
        console.warn(`[OrphanCleanup] Account "${account.name}" error: ${msg}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Monitor error: ${msg}`);
    throw error; // Rethrow to let the cron router catch it
  }

  // Final summary — always visible in server logs AND persisted to DB
  if (result.orphansCancelled > 0) {
    const summary = `Cancelled ${result.orphansCancelled} orphan order(s) across ${result.symbolsCleaned.length} symbol(s) [${result.symbolsCleaned.join(", ")}] — order IDs: [${result.cancelledOrderIds.join(", ")}]`;
    console.log(`[OrphanCleanup] ✅ Summary: ${summary}`);
    await createTradeLog({
      type: "cron",
      action: "orphan_cleanup_summary",
      details: summary,
      level: "info",
      result: "success",
    });
  } else {
    const summary = `No orphans found (accounts=${result.accountsChecked}, algoOrdersChecked=${result.algoOrdersChecked})`;
    console.log(`[OrphanCleanup] ✅ Summary: ${summary}`);
    await createTradeLog({
      type: "cron",
      action: "orphan_cleanup_summary",
      details: summary,
      level: "debug",
      result: "success",
    });
  }

  return result;
}
