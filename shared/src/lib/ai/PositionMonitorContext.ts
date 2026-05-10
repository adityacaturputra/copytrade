import { Account, Position } from "../database";
import { getSignalConfig } from "../signal-config";
import { SourceType } from "../enums";
import {
  ExchangeFactory,
  buildExchangeCredentials,
} from "../exchange/ExchangeFactory";
import type { ExchangeCredentialValues } from "../exchange/exchange-credentials";
import { ExchangeClient } from "../exchange/types";
import {
  PositionAnalysisInput,
  PositionContextMessage,
  PositionContextSnapshot,
} from "./types";
import {
  DiscordSourceConfig,
  DiscordSourceProvider,
} from "../source/DiscordSourceProvider";
import { logProcessStep } from "../process-log";

interface PositionLike {
  _id?: { toString(): string };
  accountId?: string;
  symbol: string;
  side: string;
  status: string;
  entryPrice: number;
  currentPrice?: number;
  quantity: number;
  leverage: number;
  stopLossPrice?: number;
  takeProfitTargets?: Array<{
    price: number;
    status?: string;
    percentage?: number;
  }>;
  pnl?: number;
  messageId?: string;
  channelId?: string;
  messageUrl?: string;
  openedAt?: Date;
}

interface MonitorAccountLike {
  _id: { toString(): string };
  name: string;
  sourceType?: string;
  exchangeData?: ExchangeCredentialValues;
  sourceData?: {
    method?: "bot" | "user";
    token?: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    autoRefresh?: boolean;
  };
  tradingPlatform?: string;
}

function calculateLivePnlPercent(position: PositionLike, currentPrice: number): number {
  const priceDiff =
    position.side === "LONG"
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

  return position.entryPrice
    ? (priceDiff / position.entryPrice) * 100 * position.leverage
    : 0;
}

function getExchangeForMonitorAccount(
  account: MonitorAccountLike | null,
): ExchangeClient {
  if (account?.exchangeData) {
    const credentials = buildExchangeCredentials(
      account.tradingPlatform,
      account.exchangeData as Record<string, unknown>,
    );
    if (credentials) {
      return ExchangeFactory.getClientForAccount(credentials);
    }
  }

  return ExchangeFactory.getPaperClient();
}

function mapPositionSnapshot(position: PositionLike): PositionContextSnapshot {
  return {
    symbol: position.symbol,
    side: position.side,
    status: position.status,
    entryPrice: position.entryPrice,
    currentPrice: position.currentPrice,
    quantity: position.quantity,
    leverage: position.leverage,
    stopLoss: position.stopLossPrice,
    takeProfitTargets: (position.takeProfitTargets || []).map((target) => ({
      price: target.price,
      status: target.status,
      percentage: target.percentage,
    })),
    pnl: position.pnl,
    messageId: position.messageId,
    openedAt: position.openedAt?.toISOString(),
  };
}

async function fetchDiscordContextMessages(
  position: PositionLike,
  account: MonitorAccountLike | null,
  processId: string,
): Promise<PositionContextMessage[]> {
  if (!position.channelId || !position.messageId) {
    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "monitor",
      action: "discord_context_skipped",
      symbol: position.symbol,
      details: {
        reason: "Position has no channelId or messageId",
      },
      result: "skipped",
    });
    return [];
  }

  if (
    !account ||
    account.sourceType !== SourceType.DISCORD ||
    !account.sourceData?.token ||
    !account.sourceData?.method
  ) {
    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "monitor",
      action: "discord_context_skipped",
      symbol: position.symbol,
      details: {
        reason: "Account is not a Discord source or missing source credentials",
      },
      result: "skipped",
    });
    return [];
  }

  const provider = new DiscordSourceProvider();
  const discordConfig: DiscordSourceConfig = {
    _id: account._id.toString(),
    name: account.name,
    type: SourceType.DISCORD,
    channelIds: [position.channelId],
    method: account.sourceData.method,
    token: account.sourceData.token,
    refreshToken: account.sourceData.refreshToken,
    tokenExpiresAt: account.sourceData.tokenExpiresAt,
    autoRefresh: account.sourceData.autoRefresh,
  };

  const messages = await provider.fetchMessageContext(
    discordConfig,
    position.channelId,
    position.messageId,
    10,
  );

  const config = await getSignalConfig();

  const normalized = messages.map((message) => ({
    messageId: message.messageId,
    author: message.author,
    content: message.originalContent || message.content,
    timestamp: message.timestamp.toISOString(),
    messageUrl: message.messageUrl,
    imageUrls: config.monitorVisionImages ? message.imageUrls : [],
    isSourceMessage: message.messageId === position.messageId,
  }));

  await logProcessStep({
    accountId: position.accountId,
    processId,
    type: "monitor",
    action: "discord_context_fetched",
    symbol: position.symbol,
    details: {
      anchorMessageId: position.messageId,
      fetchedCount: normalized.length,
      messages: normalized,
    },
    result: "fetched",
  });

  return normalized;
}

async function enrichAccountPositionsWithLivePrices(
  positions: PositionLike[],
  account: MonitorAccountLike | null,
  processId: string,
): Promise<PositionContextSnapshot[]> {
  const exchange = getExchangeForMonitorAccount(account);
  const liveSnapshots: PositionContextSnapshot[] = [];

  for (const accountPosition of positions) {
    const snapshot = mapPositionSnapshot(accountPosition);

    try {
      const livePrice = await exchange.getTickerPrice(accountPosition.symbol);
      snapshot.currentPrice = livePrice;
      snapshot.pnl = calculateLivePnlPercent(accountPosition, livePrice);

      await logProcessStep({
        accountId: accountPosition.accountId,
        processId,
        type: "monitor",
        action: "account_position_live_price_fetched",
        symbol: accountPosition.symbol,
        details: {
          positionId: accountPosition._id?.toString() || null,
          fetchedAt: new Date().toISOString(),
          currentPrice: livePrice,
          stopLoss: snapshot.stopLoss,
          takeProfitTargets: snapshot.takeProfitTargets,
        },
        result: "fetched",
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      await logProcessStep({
        accountId: accountPosition.accountId,
        processId,
        type: "monitor",
        action: "account_position_live_price_failed",
        symbol: accountPosition.symbol,
        details: {
          positionId: accountPosition._id?.toString() || null,
          fetchedAt: new Date().toISOString(),
        },
        result: "failed",
        error: errMsg,
      });
    }

    liveSnapshots.push(snapshot);
  }

  return liveSnapshots;
}

export async function buildPositionAnalysisInput(
  position: PositionLike,
  currentPrice: number,
  pnlPercent: number,
  processId: string,
): Promise<PositionAnalysisInput> {
  const currentTime = new Date().toISOString();
  const account = position.accountId
    ? ((await Account.findById(position.accountId).lean()) as MonitorAccountLike | null)
    : null;

  const accountPositions = await Position.find({
    accountId: position.accountId || null,
    status: { $in: ["open", "pending"] },
  })
    .sort({ openedAt: -1 })
    .lean();

  const accountOpenPositions = await enrichAccountPositionsWithLivePrices(
    accountPositions,
    account,
    processId,
  );

  await logProcessStep({
    accountId: position.accountId,
    processId,
    type: "monitor",
    action: "account_positions_snapshot",
    symbol: position.symbol,
    details: {
      currentTime,
      count: accountOpenPositions.length,
      positions: accountOpenPositions,
    },
    result: "fetched",
  });

  const discordContextMessages = await fetchDiscordContextMessages(
    position,
    account,
    processId,
  );

  return {
    symbol: position.symbol,
    side: position.side,
    entryPrice: position.entryPrice,
    currentPrice,
    takeProfitTargets: (position.takeProfitTargets || []).map((tp) => tp.price),
    stopLoss: position.stopLossPrice,
    pnl: pnlPercent,
    quantity: position.quantity,
    currentTime,
    accountName: account?.name,
    tradingPlatform: account?.tradingPlatform || undefined,
    sourceMessageId: position.messageId,
    sourceChannelId: position.channelId,
    sourceMessageUrl: position.messageUrl,
    accountOpenPositions,
    discordContextMessages,
  };
}
