import { Account, type IPosition } from "../database/index";
import {
  ExchangeFactory,
  buildExchangeCredentials,
} from "../exchange/ExchangeFactory";
import type { ExchangeClient } from "../exchange/types";
import { logExecutorWarn, logProcessStep } from "../process/log";
import { ensurePersistedProcessId } from "../process/id";

export type PositionDocLike = IPosition;

export type ExchangePositionMap = Map<
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

export async function buildExchangePositionMap(
  openPositions: PositionDocLike[],
  getAccountPositionKey: (
    accountId: string | undefined,
    symbol: string,
    side?: string,
  ) => string,
  getErrorMessage: (error: unknown) => string,
  logContext: {
    label: string;
    type: string;
    action: string;
  },
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
          type: logContext.type,
          action: logContext.action,
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
  logContext: {
    prefix: string;
    processIdPrefix: string;
    processType: string;
  },
) {
  if (openPositions.length === 0) {
    console.log(`${logContext.prefix} No open positions to sync`);
    return;
  }

  const syncSummary: string[] = [];
  for (const position of openPositions) {
    const exactKey = getAccountPositionKey(
      position.accountId,
      position.symbol,
      position.side,
    );
    const fallbackKey = getAccountPositionKey(position.accountId, position.symbol);

    if (exchangePositions.has(exactKey) || exchangePositions.has(fallbackKey)) {
      syncSummary.push(`${position.symbol} ${position.side}: open`);
      continue;
    }

    const processId = await ensurePersistedProcessId(
      position,
      logContext.processIdPrefix,
    );
    position.status = "closed";
    position.closedAt = new Date();
    position.closeReason = "Closed on Exchange (external)";
    await position.save();

    console.log(
      `${logContext.prefix} 🔒 ${position.symbol} ${position.side} — NOT on exchange, marking closed in DB`,
    );

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: logContext.processType,
      action: "sync_close_external",
      symbol: position.symbol,
      details: `Position ${position.side} ${position.symbol} was closed on the exchange externally. Marked as closed in DB.`,
      result: "success",
    });

    result.syncedClosed++;
    syncSummary.push(`${position.symbol} ${position.side}: synced-closed`);
  }

  console.log(
    `${logContext.prefix} Sync summary: ${syncSummary.length} positions checked, ${result.syncedClosed} closed externally`,
  );
}
