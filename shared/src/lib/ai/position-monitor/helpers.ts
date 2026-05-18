import {
  ExchangeFactory,
  buildExchangeCredentials,
} from "../../exchange/ExchangeFactory";
import type { ExchangeCredentialValues } from "../../exchange/exchange-credentials";
import type { ExchangeClient } from "../../exchange/types";
import type { PositionContextSnapshot } from "../core/types";

export interface PositionLike {
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

export interface MonitorAccountLike {
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

export function calculateLivePnlPercent(
  position: PositionLike,
  currentPrice: number,
): number {
  const priceDiff =
    position.side === "LONG"
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

  return position.entryPrice
    ? (priceDiff / position.entryPrice) * 100 * position.leverage
    : 0;
}

export function getExchangeForMonitorAccount(
  account: MonitorAccountLike | null,
): ExchangeClient {
  if (account?.exchangeData) {
    const credentials = buildExchangeCredentials(
      account.tradingPlatform,
      account.exchangeData as Record<string, unknown>,
      { proxyAffinityKey: String(account._id) },
    );
    if (credentials) {
      return ExchangeFactory.getClientForAccount(credentials);
    }
  }

  return ExchangeFactory.getPaperClient();
}

export function mapPositionSnapshot(
  position: PositionLike,
): PositionContextSnapshot {
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
