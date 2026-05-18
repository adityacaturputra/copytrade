import { Account, IPosition } from "../../database";
import {
  ExchangeCredentials,
  ExchangeFactory,
  buildExchangeCredentials,
} from "../../exchange/ExchangeFactory";
import { ExchangeClient } from "../../exchange/types";

export function roundUpToStep(
  value: number,
  step: number,
  decimals: number,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step) || step <= 0) {
    return Number(value.toFixed(Math.max(0, decimals)));
  }

  const ratio = value / step;
  const roundedRatio = Math.round(ratio);
  const units =
    Math.abs(ratio - roundedRatio) <= 1e-9
      ? roundedRatio
      : Math.ceil(ratio - 1e-12);
  return Number((units * step).toFixed(Math.max(0, decimals)));
}

export function formatUsd(value: number): string {
  return value.toFixed(2);
}

export function calculatePositionPnlUsd(
  position: Pick<IPosition, "entryPrice" | "quantity" | "side">,
  exitPrice: number,
): number | null {
  if (
    !Number.isFinite(position.entryPrice) ||
    !Number.isFinite(position.quantity) ||
    !Number.isFinite(exitPrice) ||
    position.entryPrice <= 0 ||
    position.quantity <= 0
  ) {
    return null;
  }

  const gross =
    position.side === "LONG"
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;
  return Number(gross.toFixed(4));
}

export async function resolveExitPrice(
  exchange: { getTickerPrice(symbol: string): Promise<number> },
  position: Pick<IPosition, "symbol" | "currentPrice">,
): Promise<number | null> {
  const rawCurrentPrice = position.currentPrice;
  const currentPrice =
    typeof rawCurrentPrice === "number" ? rawCurrentPrice : null;

  if (
    currentPrice !== null &&
    Number.isFinite(currentPrice) &&
    currentPrice > 0
  ) {
    return currentPrice;
  }

  try {
    const price = await exchange.getTickerPrice(position.symbol);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function resolveExchangeForAccount(
  accountId?: string,
): Promise<ReturnType<typeof ExchangeFactory.getPaperClient>> {
  if (accountId) {
    const account = await Account.findById(accountId).lean();
    if (account?.exchangeData) {
      const creds =
        buildExchangeCredentials(
          account.tradingPlatform,
          (account.exchangeData as Record<string, unknown>) || {},
          { proxyAffinityKey: String(accountId) },
        ) ||
        ({
          provider: "paper",
        } as ExchangeCredentials);
      return ExchangeFactory.getClientForAccount(creds);
    }
  }

  return ExchangeFactory.getPaperClient();
}

export async function resolveExchangeForPosition(
  positionAccountId?: string,
  fallbackAccountId?: string,
  options?: { allowNullWhenUnavailable?: boolean },
): Promise<ExchangeClient | null> {
  const maybeFrom = async (
    accountId?: string,
  ): Promise<ExchangeClient | null> => {
    if (!accountId) return null;
    const account = await Account.findById(accountId).lean();
    if (!account?.exchangeData) return null;
    const creds = buildExchangeCredentials(
      account.tradingPlatform,
      (account.exchangeData as Record<string, unknown>) || {},
      { proxyAffinityKey: String(accountId) },
    );
    return creds ? ExchangeFactory.getClientForAccount(creds) : null;
  };

  const primary = await maybeFrom(positionAccountId);
  if (primary) return primary;

  const fallback = await maybeFrom(fallbackAccountId);
  if (fallback) return fallback;

  if (options?.allowNullWhenUnavailable) return null;
  return ExchangeFactory.getPaperClient();
}
