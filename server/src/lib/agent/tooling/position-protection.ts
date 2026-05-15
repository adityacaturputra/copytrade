import type {
  AlgoOrderInfo,
  ExchangeClient,
} from "@copytrade/shared/lib/exchange/types";
import { roundPrice, toClosingSide, type PositionRecord } from "./shared";

const PRICE_MATCH_ABSOLUTE_TOLERANCE = 0.01;
const PRICE_MATCH_RELATIVE_TOLERANCE = 0.001;

type ProtectionOrderSummary = {
  orderId: string | null;
  type: "tp" | "sl";
  price: number;
  quantity: number;
  side?: string;
  status?: string;
};

export type ProtectionSnapshot = {
  liveStopLossOrders: ProtectionOrderSummary[];
  liveTakeProfitOrders: ProtectionOrderSummary[];
  dbStopLossPrice: number | null;
  dbTakeProfitTargets: Array<{
    price: number;
    quantity: number;
    percentage: number;
    status?: string;
    orderId?: string | null;
  }>;
  missingLiveStopLoss: boolean;
  extraLiveStopLossOrders: ProtectionOrderSummary[];
  missingLiveTakeProfits: Array<{
    price: number;
    quantity: number;
    percentage: number;
    status?: string;
    orderId?: string | null;
  }>;
  extraLiveTakeProfitOrders: ProtectionOrderSummary[];
  hasMismatch: boolean;
};

function pricesRoughlyEqual(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const absoluteDiff = Math.abs(left - right);
  if (absoluteDiff <= PRICE_MATCH_ABSOLUTE_TOLERANCE) return true;
  const base = Math.max(Math.abs(left), Math.abs(right), 1);
  return absoluteDiff / base <= PRICE_MATCH_RELATIVE_TOLERANCE;
}

function normalizeAlgoOrdersForPosition(
  position: PositionRecord,
  algoOrders: AlgoOrderInfo[],
): ProtectionOrderSummary[] {
  const closingSide = toClosingSide(position.side);

  return algoOrders
    .filter(
      (order) =>
        order.symbol === position.symbol &&
        (!order.side || order.side === closingSide),
    )
    .map((order) => ({
      orderId: order.orderId || null,
      type: (order.type === "sl" ? "sl" : "tp") as "sl" | "tp",
      price: order.triggerPrice,
      quantity: order.quantity,
      side: order.side,
      status: order.status,
    }))
    .sort((left, right) => left.price - right.price);
}

export function getDbTakeProfitTargets(position: PositionRecord) {
  return (position.takeProfitTargets || []).map((target) => ({
    price: target.price,
    quantity: target.quantity,
    percentage: target.percentage,
    status: target.status,
    orderId: target.orderId || null,
  }));
}

export async function buildProtectionSnapshot(
  position: PositionRecord,
  exchange: ExchangeClient,
): Promise<ProtectionSnapshot> {
  const algoOrders = await exchange.getAlgoOrders(position.symbol);
  const normalizedOrders = normalizeAlgoOrdersForPosition(position, algoOrders);
  const liveStopLossOrders = normalizedOrders.filter(
    (order) => order.type === "sl",
  );
  const liveTakeProfitOrders = normalizedOrders.filter(
    (order) => order.type === "tp",
  );
  const dbStopLossPrice = position.stopLossPrice ?? null;
  const dbTakeProfitTargets = getDbTakeProfitTargets(position);
  const pendingDbTakeProfits = dbTakeProfitTargets.filter(
    (target) => target.status !== "cancelled" && target.status !== "hit",
  );

  const missingLiveStopLoss = Boolean(
    dbStopLossPrice &&
    !liveStopLossOrders.some((order) =>
      pricesRoughlyEqual(order.price, dbStopLossPrice),
    ),
  );
  const extraLiveStopLossOrders = liveStopLossOrders.filter(
    (order) =>
      !dbStopLossPrice || !pricesRoughlyEqual(order.price, dbStopLossPrice),
  );

  const missingLiveTakeProfits = pendingDbTakeProfits.filter(
    (target) =>
      !liveTakeProfitOrders.some(
        (order) =>
          pricesRoughlyEqual(order.price, target.price) &&
          pricesRoughlyEqual(order.quantity, target.quantity),
      ),
  );

  const extraLiveTakeProfitOrders = liveTakeProfitOrders.filter(
    (order) =>
      !pendingDbTakeProfits.some(
        (target) =>
          pricesRoughlyEqual(order.price, target.price) &&
          pricesRoughlyEqual(order.quantity, target.quantity),
      ),
  );

  return {
    liveStopLossOrders,
    liveTakeProfitOrders,
    dbStopLossPrice,
    dbTakeProfitTargets,
    missingLiveStopLoss,
    extraLiveStopLossOrders,
    missingLiveTakeProfits,
    extraLiveTakeProfitOrders,
    hasMismatch:
      missingLiveStopLoss ||
      extraLiveStopLossOrders.length > 0 ||
      missingLiveTakeProfits.length > 0 ||
      extraLiveTakeProfitOrders.length > 0,
  };
}

export function normalizeProtectionTargets(
  rawTargets: unknown,
  liveQuantity: number,
): Array<{
  price: number;
  quantity: number;
  percentage: number;
}> {
  if (!Array.isArray(rawTargets)) {
    throw new Error("takeProfits must be an array when provided");
  }

  if (rawTargets.length === 0) {
    return [];
  }

  const fallbackPercentage = 100 / rawTargets.length;
  const normalized = rawTargets.map((target, index) => {
    if (!target || typeof target !== "object") {
      throw new Error(`takeProfits[${index}] must be an object`);
    }

    const price = (target as { price?: unknown }).price;
    const quantity = (target as { quantity?: unknown }).quantity;
    const percentage = (target as { percentage?: unknown }).percentage;

    if (typeof price !== "number" || Number.isNaN(price) || price <= 0) {
      throw new Error(`takeProfits[${index}].price must be a positive number`);
    }

    let resolvedPercentage =
      typeof percentage === "number" && percentage > 0
        ? percentage
        : fallbackPercentage;
    let resolvedQuantity =
      typeof quantity === "number" && quantity > 0
        ? quantity
        : (liveQuantity * resolvedPercentage) / 100;

    if (!(resolvedQuantity > 0)) {
      throw new Error(
        `takeProfits[${index}] produced a non-positive quantity; provide quantity or percentage`,
      );
    }

    if (
      !(typeof percentage === "number" && percentage > 0) &&
      typeof quantity === "number" &&
      quantity > 0 &&
      liveQuantity > 0
    ) {
      resolvedPercentage = (resolvedQuantity / liveQuantity) * 100;
    }

    return {
      price: roundPrice(price),
      quantity: resolvedQuantity,
      percentage: resolvedPercentage,
    };
  });

  const totalQuantity = normalized.reduce(
    (sum, target) => sum + target.quantity,
    0,
  );
  if (totalQuantity > liveQuantity * 1.001) {
    throw new Error(
      `takeProfits total quantity ${totalQuantity} exceeds live position quantity ${liveQuantity}`,
    );
  }

  return normalized;
}
