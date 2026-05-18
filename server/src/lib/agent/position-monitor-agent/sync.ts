import {
  Account,
  Position,
  type IPosition,
} from "@copytrade/shared/lib/database/index";
import {
  ExchangeFactory,
  buildExchangeCredentials,
} from "@copytrade/shared/lib/exchange/ExchangeFactory";
import type { ExchangeClient } from "@copytrade/shared/lib/exchange/types";
import { inspectPendingLimitOrder } from "@copytrade/shared/lib/monitor/pending-order-sync";
import {
  logExecutorError,
  logExecutorInfo,
  logExecutorWarn,
  logProcessStep,
} from "@copytrade/shared/lib/process/log";
import { getHttpErrorDetails } from "@copytrade/shared/lib/http/error";
import { ensurePersistedProcessId } from "@copytrade/shared/lib/process/id";
import { createTradeLog } from "@copytrade/shared/lib/trade-log/store";

type PositionDocLike = IPosition;

type ExchangePositionMap = Map<
  string,
  {
    markPrice: number;
    unrealizedPnl: number;
    entryPrice: number;
    quantity: number;
    side?: string;
  }
>;

export async function getExchangeForPosition(position: {
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
      if (creds) {
        return ExchangeFactory.getClientForAccount(creds);
      }
    }
  }

  return ExchangeFactory.getPaperClient();
}

export async function syncPendingPositions(
  result: { actions: number; errors: string[]; syncedClosed: number },
  getErrorMessage: (error: unknown) => string,
) {
  const pendingPositions = (await Position.find({ status: "pending" })) as PositionDocLike[];
  if (pendingPositions.length === 0) {
    return;
  }

  await logExecutorInfo(
    `⏳ Position monitor agent checking ${pendingPositions.length} pending positions`,
    {
      type: "monitor",
      action: "pending_positions_check",
      level: "debug",
    },
  );

  for (const position of pendingPositions) {
    const processId = await ensurePersistedProcessId(position, "pendmon");

    try {
      const exchange = await getExchangeForPosition(position);
      const inspection = await inspectPendingLimitOrder(exchange, position);

      if (inspection.type === "live") continue;

      if (inspection.type === "cancelled") {
        position.status = "closed";
        position.closedAt = new Date();
        position.closeReason = inspection.reason;
        await position.save();
        result.syncedClosed++;
        continue;
      }

      position.status = "open";
      if (inspection.fillPrice && inspection.fillPrice > 0) {
        position.entryPrice = inspection.fillPrice;
      }
      await position.save();
      result.actions++;

      await logProcessStep({
        accountId: position.accountId,
        processId,
        type: "monitor",
        action: "limit_filled",
        symbol: position.symbol,
        details: `Limit order filled on exchange. Promoted to open. Fill price: ${position.entryPrice}. ${inspection.reason}`,
        result: "success",
      });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      const httpDetails = getHttpErrorDetails(error);
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

export async function buildExchangePositionMap(
  openPositions: PositionDocLike[],
  getAccountPositionKey: (
    accountId: string | undefined,
    symbol: string,
    side?: string,
  ) => string,
  getErrorMessage: (error: unknown) => string,
): Promise<ExchangePositionMap> {
  const openByAccount = new Map<string, PositionDocLike[]>();
  for (const position of openPositions) {
    const key = position.accountId || "__global__";
    if (!openByAccount.has(key)) {
      openByAccount.set(key, []);
    }
    openByAccount.get(key)!.push(position);
  }

  const exchangePositions: ExchangePositionMap = new Map();

  for (const [, positions] of openByAccount) {
    const exchange = await getExchangeForPosition(positions[0]);

    try {
      const livePositions = await exchange.getOpenPositions();
      for (const livePosition of livePositions) {
        exchangePositions.set(
          getAccountPositionKey(
            positions[0].accountId,
            livePosition.symbol,
            livePosition.side,
          ),
          {
            markPrice: livePosition.markPrice,
            unrealizedPnl: livePosition.unrealizedPnl,
            entryPrice: livePosition.entryPrice,
            quantity: livePosition.quantity,
            side: livePosition.side,
          },
        );
      }
    } catch (error) {
      await logExecutorWarn(
        `⚠️ Failed to fetch exchange positions for account ${positions[0].accountId || "__global__"}: ${getErrorMessage(error)}`,
        {
          accountId: positions[0].accountId,
          type: "monitor",
          action: "exchange_positions_fetch_failed",
        },
      );
    }
  }

  return exchangePositions;
}

export async function syncClosedPositions(
  openPositions: PositionDocLike[],
  exchangePositions: ExchangePositionMap,
  result: { syncedClosed: number },
  getAccountPositionKey: (
    accountId: string | undefined,
    symbol: string,
    side?: string,
  ) => string,
) {
  if (openPositions.length === 0) {
    console.log("[PositionMonitor] No open positions to sync");
    return;
  }

  const syncSummary: string[] = [];
  for (const position of openPositions) {
    const exactKey = getAccountPositionKey(position.accountId, position.symbol, position.side);
    const fallbackKey = getAccountPositionKey(position.accountId, position.symbol);

    if (exchangePositions.has(exactKey) || exchangePositions.has(fallbackKey)) {
      const matchedKey = exchangePositions.has(exactKey) ? exactKey : fallbackKey;
      const liveData = exchangePositions.get(matchedKey)!;
      console.log(
        `[PositionMonitor] ✅ ${position.symbol} ${position.side} — still on exchange (markPrice=${liveData.markPrice}, unrealizedPnl=${liveData.unrealizedPnl})`,
      );
      syncSummary.push(`${position.symbol} ${position.side}: open`);
      continue;
    }

    const processId = await ensurePersistedProcessId(position, "syncmon");
    position.status = "closed";
    position.closedAt = new Date();
    position.closeReason = "Closed on Exchange (external)";
    await position.save();

    console.log(
      `[PositionMonitor] 🔒 ${position.symbol} ${position.side} — NOT on exchange, marking closed in DB`,
    );

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "monitor",
      action: "sync_close",
      symbol: position.symbol,
      details: `Position ${position.side} ${position.symbol} was closed on the exchange externally. Marked as closed in DB.`,
      result: "success",
    });

    await createTradeLog({
      accountId: position.accountId,
      processId,
      type: "position_monitor",
      action: "sync_closed",
      symbol: position.symbol,
      details: `${position.side} ${position.symbol} no longer on exchange — marked closed in DB (externally closed)`,
      level: "info",
      result: "closed",
    }).catch(() => {});

    result.syncedClosed++;
    syncSummary.push(`${position.symbol} ${position.side}: synced-closed`);
  }

  console.log(
    `[PositionMonitor] Sync summary: ${syncSummary.length} positions checked, ${result.syncedClosed} closed externally`,
  );
}

export async function cleanupOrphanProtectionForAccounts(
  positions: PositionDocLike[],
  result: { actions: number; errors: string[] },
  cleanupOrphanProtectionOrders: (args: {
    accountId: string;
    dryRun: boolean;
  }) => Promise<string>,
  getErrorMessage: (error: unknown) => string,
) {
  const uniqueAccountIds = [
    ...new Set(
      positions
        .map((position) => position.accountId)
        .filter((accountId): accountId is string => Boolean(accountId)),
    ),
  ];

  for (const accountId of uniqueAccountIds) {
    try {
      const raw = await cleanupOrphanProtectionOrders({
        accountId,
        dryRun: false,
      });
      const parsed = JSON.parse(raw) as {
        cleanupResults?: Array<{ cancelled?: string[] }>;
      };
      const cancelledCount =
        parsed.cleanupResults?.reduce(
          (sum, item) => sum + (item.cancelled?.length || 0),
          0,
        ) || 0;
      result.actions += cancelledCount;
    } catch (error) {
      result.errors.push(`Cleanup ${accountId}: ${getErrorMessage(error)}`);
    }
  }
}
