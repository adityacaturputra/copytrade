/**
 * Backward-compatible convenience wrappers.
 *
 * All logic has been moved to src/lib/exchange/.
 * These functions delegate to ExchangeFactory.getClient() so existing
 * consumers (executor, monitor, routes) keep working without changes.
 *
 * NEW CODE should import from `@copytrade/shared/lib/exchange/ExchangeFactory` directly.
 */

import { ExchangeFactory } from "@copytrade/shared/lib/exchange/ExchangeFactory";
import { OrderParams, OrderResult } from "@copytrade/shared/lib/exchange/types";

// Re-export exchange types for convenience
export type { OrderParams as MexcOrderParams } from "@copytrade/shared/lib/exchange/types";

export interface MexcPosition {
  symbol: string;
  positionId: number;
  type: 1 | 2;
  leverage: number;
  openType: 1 | 2;
  entryPrice: number;
  holdQty: number;
  margin: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  marketPrice: number;
  autoMargin?: boolean;
}

export interface MexcAccountInfo {
  totalBalance: number;
  availableBalance: number;
  unrealizedPnl: number;
}

// ==================== Convenience Wrappers ====================

export async function mexcPlaceOrder(
  params: Omit<OrderParams, "type"> & { type: string },
): Promise<{ orderId: string; price: number; quantity: number }> {
  const client = ExchangeFactory.getClient();
  const result: OrderResult = await client.placeOrder({
    ...params,
    type: (params.type?.toUpperCase() || "MARKET") as "LIMIT" | "MARKET",
  });
  return {
    orderId: result.orderId,
    price: result.price,
    quantity: result.quantity,
  };
}

export async function mexcGetTickerPrice(symbol: string): Promise<number> {
  return ExchangeFactory.getClient().getTickerPrice(symbol);
}

export async function mexcGetOpenPositions(): Promise<MexcPosition[]> {
  const positions = await ExchangeFactory.getClient().getOpenPositions();
  // Map normalized PositionInfo → legacy MexcPosition shape
  return positions.map((p) => ({
    symbol: p.symbol,
    positionId: parseInt(p.positionId) || 0,
    type: p.side === "LONG" ? (1 as const) : (2 as const),
    leverage: p.leverage,
    openType: p.marginType === "isolated" ? (1 as const) : (2 as const),
    entryPrice: p.entryPrice,
    holdQty: p.quantity,
    margin: p.margin,
    unrealizedPnl: p.unrealizedPnl,
    liquidationPrice: p.liquidationPrice,
    marketPrice: p.markPrice,
  }));
}

export async function mexcClosePosition(
  symbol: string,
  positionId?: number,
): Promise<void> {
  return ExchangeFactory.getClient().closePosition(
    symbol,
    positionId != null ? String(positionId) : undefined,
  );
}

export async function mexcGetAccountInfo(): Promise<MexcAccountInfo> {
  const info = await ExchangeFactory.getClient().getAccountInfo();
  return {
    totalBalance: info.totalBalance,
    availableBalance: info.availableBalance,
    unrealizedPnl: info.unrealizedPnl,
  };
}

export async function mexcGetKlines(
  symbol: string,
  interval?: string,
  limit?: number,
) {
  return ExchangeFactory.getClient().getKlines(symbol, interval, limit);
}

/** @deprecated Use ExchangeFactory.getClient() directly */
export function getMexcClient() {
  return ExchangeFactory.getClient();
}
