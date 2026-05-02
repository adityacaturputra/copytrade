import { Account, Position } from "@copytrade/shared/lib/database";
import { ExchangeFactory } from "@copytrade/shared/lib/exchange/ExchangeFactory";
import { toExchangeCredentials, type AccountRecord } from "./agent/tooling/shared";

export async function runOrphanCleanupMonitor() {
  const result = {
    accountsChecked: 0,
    algoOrdersChecked: 0,
    orphansCancelled: 0,
    errors: [] as string[],
  };

  try {
    const activeAccounts = await Account.find({ isActive: true }).exec();

    for (const account of activeAccounts) {
      try {
        result.accountsChecked++;
        
        // Ensure exchange is configured
        if (!account.tradingPlatform || !account.exchangeData) {
          continue;
        }

        const credentials = toExchangeCredentials(account as unknown as AccountRecord);
        const exchange = ExchangeFactory.getClientForAccount(credentials);
        
        // Fetch exchange state
        const [algoOrders, openPositions, openOrders, trackedPositions] = await Promise.all([
          exchange.getAlgoOrders(), // Call without symbol to get all
          exchange.getOpenPositions(),
          exchange.getOpenOrders(), // Fetch live limit pending orders
          Position.find({
            accountId: String(account._id),
            status: { $in: ["open", "pending"] },
          }).lean().exec(),
        ]);

        if (!algoOrders || algoOrders.length === 0) {
          continue;
        }

        result.algoOrdersChecked += algoOrders.length;

        // Collect valid symbols
        const trackedSymbols = new Set(trackedPositions.map((pos: any) => pos.symbol));
        const livePositionSymbols = new Set(openPositions.map((pos: any) => pos.symbol));
        const openOrderSymbols = new Set(openOrders.map((order: any) => order.symbol));

        // Find orphaned algo orders
        const orphanCandidates = algoOrders.filter(
          (order: any) =>
            !trackedSymbols.has(order.symbol) &&
            !livePositionSymbols.has(order.symbol) &&
            !openOrderSymbols.has(order.symbol)
        );

        const symbolsToCleanup = [...new Set(orphanCandidates.map((o: any) => o.symbol))];

        if (symbolsToCleanup.length > 0) {
          for (const targetSymbol of symbolsToCleanup) {
            try {
              const cancelResult = await exchange.cancelAlgoOrders(targetSymbol);
              result.orphansCancelled += cancelResult.cancelled.length;
              if (cancelResult.errors.length > 0) {
                result.errors.push(...cancelResult.errors);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              result.errors.push(`[${account.name}] Failed to cancel algo orders for ${targetSymbol}: ${msg}`);
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`[${account.name}] Account error: ${msg}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Monitor error: ${msg}`);
    throw error; // Rethrow to let the cron router catch it
  }

  return result;
}
