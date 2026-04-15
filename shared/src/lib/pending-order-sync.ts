import { IPosition } from "./database";
import { ExchangeClient, HistoricalOrder, OpenOrderInfo } from "./exchange/types";

const PENDING_ORDER_VISIBILITY_GRACE_MS = 5 * 60 * 1000;

export type PendingOrderInspection =
  | { type: "live"; reason: string }
  | { type: "filled"; reason: string; fillPrice?: number }
  | { type: "cancelled"; reason: string };

function normalizeOrderState(status?: string): string {
  return String(status || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

function isWorkingOrderState(status?: string): boolean {
  const state = normalizeOrderState(status);
  return (
    state === "NEW" ||
    state === "LIVE" ||
    state === "OPEN" ||
    state === "PARTIALLY_FILLED" ||
    state === "PARTIALLYFILLED"
  );
}

function isFilledOrderState(status?: string): boolean {
  const state = normalizeOrderState(status);
  return state === "FILLED";
}

function isCancelledOrderState(status?: string): boolean {
  const state = normalizeOrderState(status);
  return (
    state === "CANCELLED" ||
    state === "CANCELED" ||
    state === "EXPIRED" ||
    state === "REJECTED"
  );
}

function findMatchingOrder<T extends { orderId: string }>(
  orders: T[],
  orderId: string,
): T | undefined {
  return orders.find((order) => String(order.orderId) === orderId);
}

function resolveOrderState(order?: HistoricalOrder): string {
  return String((order?.raw as { state?: string } | undefined)?.state || order?.status || "");
}

export async function inspectPendingLimitOrder(
  exchange: ExchangeClient,
  position: Pick<IPosition, "symbol" | "side" | "orderId" | "openedAt">,
): Promise<PendingOrderInspection> {
  const orderId = String(position.orderId || "");
  const openOrders = await exchange.getOpenOrders(position.symbol);
  const matchingOpenOrder = findMatchingOrder(openOrders, orderId);

  if (matchingOpenOrder) {
    return {
      type: "live",
      reason: `Order ${orderId} is still open on exchange`,
    };
  }

  const orderHistory = await exchange.getOrderHistory(position.symbol, 100);
  const matchingOrder = findMatchingOrder(orderHistory, orderId);

  if (matchingOrder) {
    const orderState = resolveOrderState(matchingOrder);

    if (isFilledOrderState(orderState)) {
      return {
        type: "filled",
        reason: `Order ${orderId} is filled`,
        fillPrice:
          matchingOrder.price && matchingOrder.price > 0
            ? matchingOrder.price
            : undefined,
      };
    }

    if (isWorkingOrderState(orderState)) {
      return {
        type: "live",
        reason: `Order ${orderId} is still working (${orderState})`,
      };
    }

    if (isCancelledOrderState(orderState)) {
      return {
        type: "cancelled",
        reason: `Limit order ${orderId} is ${orderState.toLowerCase()} on exchange`,
      };
    }

    return {
      type: "live",
      reason: `Treating exchange order state ${orderState || "unknown"} as still pending`,
    };
  }

  const exchangePositions = await exchange.getOpenPositions();
  const hasMatchingPosition = exchangePositions.some(
    (exchangePosition) =>
      exchangePosition.symbol === position.symbol &&
      exchangePosition.side === position.side,
  );

  if (hasMatchingPosition) {
    return {
      type: "filled",
      reason: `Detected filled order via open ${position.side} position on exchange`,
    };
  }

  const orderAgeMs = Date.now() - new Date(position.openedAt).getTime();
  if (orderAgeMs < PENDING_ORDER_VISIBILITY_GRACE_MS) {
    return {
      type: "live",
      reason: `Order ${orderId} is temporarily not visible yet (${Math.round(orderAgeMs / 1000)}s old)`,
    };
  }

  return {
    type: "cancelled",
    reason: `Limit order ${orderId} not found on exchange after ${Math.round(orderAgeMs / 1000)}s`,
  };
}
