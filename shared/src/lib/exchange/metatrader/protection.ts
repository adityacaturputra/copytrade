import type { AlgoOrderInfo } from "../types";
import type { MetaTraderPositionRow } from "./types";
import {
  normalizeMetaTraderSide,
  normalizeMetaTraderSymbol,
  parseMetaTraderNumber,
  parseMetaTraderTimestamp,
} from "./utils";

export async function updateMetaTraderPositionProtection(input: {
  symbol: string;
  toSymbol: (symbol: string) => string;
  getPositionsRaw: (symbol?: string) => Promise<MetaTraderPositionRow[]>;
  request: <T>(
    method: "POST",
    path: string,
    options?: { data?: Record<string, unknown> },
  ) => Promise<T>;
  values: { stopLoss?: number | null; takeProfit?: number | null };
}): Promise<string> {
  const positions = (await input.getPositionsRaw(input.symbol)).filter(
    (row) =>
      input.toSymbol(String(row.symbol || "")) === input.toSymbol(input.symbol) &&
      (parseMetaTraderNumber(row.quantity) || parseMetaTraderNumber(row.volume) || parseMetaTraderNumber(row.lots)) > 0,
  );

  if (positions.length === 0) {
    throw new Error(`No open MetaTrader position found for ${input.symbol}`);
  }

  const results: string[] = [];
  for (const row of positions) {
    const positionId = String(row.positionId || row.ticket || row.id || "");
    await input.request("POST", "/positions/protection", {
      data: {
        symbol: input.toSymbol(input.symbol),
        positionId,
        stopLoss:
          typeof input.values.stopLoss === "number"
            ? input.values.stopLoss
            : input.values.stopLoss === null
              ? null
              : undefined,
        takeProfit:
          typeof input.values.takeProfit === "number"
            ? input.values.takeProfit
            : input.values.takeProfit === null
              ? null
              : undefined,
      },
    });
    results.push(positionId || input.toSymbol(input.symbol));
  }

  return results.join(",");
}

export async function clearMetaTraderSyntheticProtectionOrder(input: {
  orderId: string;
  symbol: string;
  toSymbol: (symbol: string) => string;
  request: <T>(
    method: "POST",
    path: string,
    options?: { data?: Record<string, unknown> },
  ) => Promise<T>;
}): Promise<boolean> {
  if (!input.orderId.startsWith("mt-sl:") && !input.orderId.startsWith("mt-tp:")) {
    return false;
  }

  const [prefix, positionId] = input.orderId.split(":", 2);
  if (!positionId) return false;

  await input.request("POST", "/positions/protection", {
    data: {
      symbol: input.toSymbol(input.symbol),
      positionId,
      stopLoss: prefix === "mt-sl" ? null : undefined,
      takeProfit: prefix === "mt-tp" ? null : undefined,
    },
  });

  return true;
}

export function buildMetaTraderAlgoOrders(rows: MetaTraderPositionRow[]): AlgoOrderInfo[] {
  const orders: AlgoOrderInfo[] = [];

  for (const row of rows) {
    const normalizedSymbol = normalizeMetaTraderSymbol(String(row.symbol || ""));
    const positionId = String(row.positionId || row.ticket || row.id || normalizedSymbol);
    const quantity =
      parseMetaTraderNumber(row.quantity) ||
      parseMetaTraderNumber(row.volume) ||
      parseMetaTraderNumber(row.lots);
    const side = normalizeMetaTraderSide(row.side ?? row.type) === "LONG" ? "SELL" : "BUY";
    const stopLoss = parseMetaTraderNumber(row.stopLoss) || parseMetaTraderNumber(row.sl);
    const takeProfit = parseMetaTraderNumber(row.takeProfit) || parseMetaTraderNumber(row.tp);

    if (stopLoss > 0) {
      orders.push({
        orderId: `mt-sl:${positionId}`,
        symbol: normalizedSymbol,
        side,
        type: "sl",
        triggerPrice: stopLoss,
        quantity,
        status: "active",
        createdAt: parseMetaTraderTimestamp(row.createdAt ?? row.time),
        raw: row,
      });
    }

    if (takeProfit > 0) {
      orders.push({
        orderId: `mt-tp:${positionId}`,
        symbol: normalizedSymbol,
        side,
        type: "tp",
        triggerPrice: takeProfit,
        quantity,
        status: "active",
        createdAt: parseMetaTraderTimestamp(row.createdAt ?? row.time),
        raw: row,
      });
    }
  }

  return orders;
}
