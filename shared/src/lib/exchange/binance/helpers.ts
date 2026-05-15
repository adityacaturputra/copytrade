import type {
  AccountInfo,
  AlgoOrderInfo,
  HistoricalOrder,
  InstrumentSpecs,
  KlineData,
  OpenOrderInfo,
  PositionInfo,
} from "../types";

type BinancePositionRiskRow = {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  isolated: boolean;
  isolatedWallet?: string;
  initialMargin?: string;
  positionSide?: "BOTH" | "LONG" | "SHORT";
  [key: string]: unknown;
};

type BinanceInstrumentSpecs = InstrumentSpecs & {
  marketLotSz: number;
  marketMinSz: number;
  marketQtyDecimals: number;
};

type BinanceDeps = {
  applyLeverage(symbol: string, leverage: number): Promise<number>;
  getLegacyAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]>;
  getMaxAllowedLeverage(symbol: string): Promise<number | null>;
  getOpenPositions(): Promise<PositionInfo[]>;
  parseAlgoOrderId(row: Record<string, unknown>): string | null;
  parseAlgoType(type: string): "tp" | "sl" | "conditional";
  pickPrecision(
    explicitPrecision: number | undefined,
    stepText: string | undefined,
    step: number,
  ): number;
  publicRequest<T>(path: string, params?: Record<string, unknown>): Promise<T>;
  specsCache: Map<string, { specs: InstrumentSpecs; ts: number }>;
  specsCacheTtl: number;
  toSymbol(symbol: string): string;
  toMarginType(marginType: "isolated" | "cross"): "ISOLATED" | "CROSSED";
  signedRequest<T>(method: string, path: string, params?: Record<string, unknown>): Promise<T>;
};

export async function getBinanceAccountInfo(
  deps: BinanceDeps,
): Promise<AccountInfo> {
  const account = await deps.signedRequest<{
    totalWalletBalance?: string;
    availableBalance?: string;
    totalUnrealizedProfit?: string;
  }>("GET", "/fapi/v2/account");

  return {
    totalBalance: Number(account.totalWalletBalance || 0),
    availableBalance: Number(account.availableBalance || 0),
    unrealizedPnl: Number(account.totalUnrealizedProfit || 0),
    currency: "USDT",
  };
}

export async function getBinanceTickerPrice(
  deps: BinanceDeps,
  symbol: string,
): Promise<number> {
  const result = await deps.signedRequest<{ price?: string }>(
    "GET",
    "/fapi/v1/ticker/price",
    { symbol: deps.toSymbol(symbol) },
  );
  return Number(result.price || 0);
}

export async function getBinanceKlines(
  deps: BinanceDeps,
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[]> {
  const rows = await deps.signedRequest<Array<[number, string, string, string, string, string]>>(
    "GET",
    "/fapi/v1/klines",
    { symbol: deps.toSymbol(symbol), interval, limit },
  );

  return rows.map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

export function mapBinanceOpenPositions(
  deps: BinanceDeps,
  rows: BinancePositionRiskRow[],
): PositionInfo[] {
  return rows
    .filter((row) => Math.abs(Number(row.positionAmt || 0)) > 0)
    .map((row) => {
      const quantity = Math.abs(Number(row.positionAmt || 0));
      const side =
        row.positionSide === "SHORT" || Number(row.positionAmt || 0) < 0
          ? "SHORT"
          : "LONG";

      return {
        symbol: deps.toSymbol(row.symbol),
        positionId: `${row.symbol}:${row.positionSide || side}`,
        side,
        leverage: Number(row.leverage || 0),
        marginType: row.isolated ? "isolated" : "cross",
        entryPrice: Number(row.entryPrice || 0),
        quantity,
        margin: Number(row.isolatedWallet || row.initialMargin || 0),
        unrealizedPnl: Number(row.unRealizedProfit || 0),
        liquidationPrice: Number(row.liquidationPrice || 0),
        markPrice: Number(row.markPrice || 0),
        raw: row,
      };
    });
}

export async function setBinanceLeverage(
  deps: BinanceDeps,
  symbol: string,
  leverage: number,
  marginType: "isolated" | "cross",
): Promise<number> {
  const normalized = deps.toSymbol(symbol);
  const requestedLeverage = Math.max(1, Math.min(125, Math.floor(leverage)));

  try {
    await deps.signedRequest("POST", "/fapi/v1/marginType", {
      symbol: normalized,
      marginType: deps.toMarginType(marginType),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      !msg.includes("No need to change margin type") &&
      !msg.includes("code=-4046")
    ) {
      console.warn(`[Binance] Failed to set margin type for ${normalized}: ${msg}`);
    }
  }

  try {
    return await deps.applyLeverage(normalized, requestedLeverage);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    let fallbackLeverage: number | null = null;

    if (msg.includes("code=-4300") && requestedLeverage > 20) {
      fallbackLeverage = 20;
    } else if (msg.includes("code=-4028")) {
      const maxAllowed = await deps.getMaxAllowedLeverage(normalized);
      if (maxAllowed && maxAllowed < requestedLeverage) {
        fallbackLeverage = maxAllowed;
      } else if (requestedLeverage > 20) {
        fallbackLeverage = 20;
      } else if (requestedLeverage > 10) {
        fallbackLeverage = 10;
      }
    }

    if (
      fallbackLeverage &&
      fallbackLeverage >= 1 &&
      fallbackLeverage !== requestedLeverage
    ) {
      console.warn(
        `[Binance] Leverage ${requestedLeverage}x rejected for ${normalized}. Retrying with ${fallbackLeverage}x.`,
      );
      return deps.applyLeverage(normalized, fallbackLeverage);
    }

    throw error;
  }
}

export async function getBinanceOpenOrders(
  deps: BinanceDeps,
  symbol?: string,
): Promise<OpenOrderInfo[]> {
  const normalized = symbol ? deps.toSymbol(symbol) : undefined;
  const rows = await deps.signedRequest<Array<Record<string, unknown>>>(
    "GET",
    "/fapi/v1/openOrders",
    normalized ? { symbol: normalized } : {},
  );

  return rows.map((o) => ({
    orderId: String(o.orderId),
    symbol: String(o.symbol || ""),
    side: String(o.side || "") as "BUY" | "SELL",
    type: String(o.type || ""),
    price: parseFloat(String(o.price || "0")) || undefined,
    quantity: parseFloat(String(o.origQty || "0")),
    filledQuantity: parseFloat(String(o.executedQty || "0")),
    status: String(o.status || ""),
    createdAt: typeof o.time === "number" ? o.time : undefined,
    raw: o,
  }));
}

export async function cancelBinanceOrder(
  deps: BinanceDeps,
  orderId: string,
  symbol: string,
): Promise<boolean> {
  const normalized = deps.toSymbol(symbol);
  try {
    await deps.signedRequest("DELETE", "/fapi/v1/order", {
      symbol: normalized,
      orderId,
    });
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("Unknown order") || msg.includes("code=-2011")) {
      return false;
    }
    throw error;
  }
}

export async function getBinanceAlgoOrders(
  deps: BinanceDeps,
  symbol?: string,
): Promise<AlgoOrderInfo[]> {
  const normalized = symbol ? deps.toSymbol(symbol) : undefined;

  try {
    const rows = await deps.signedRequest<Array<Record<string, unknown>>>(
      "GET",
      "/fapi/v1/openAlgoOrders",
      normalized
        ? { symbol: normalized, algoType: "CONDITIONAL" }
        : { algoType: "CONDITIONAL" },
    );

    const mapped: Array<AlgoOrderInfo | null> = rows.map((row) => {
      const orderId = deps.parseAlgoOrderId(row);
      if (!orderId || !row.symbol || !row.side) {
        return null;
      }

      const rawType = String(row.type || row.orderType || "");
      const triggerPrice = parseFloat(String(row.triggerPrice || row.stopPrice || "0"));
      const executePrice = parseFloat(String(row.executePrice || row.price || "0"));
      const quantity = parseFloat(String(row.quantity || row.origQty || "0"));

      return {
        orderId,
        symbol: String(row.symbol),
        side: String(row.side) as "BUY" | "SELL",
        type: deps.parseAlgoType(rawType),
        triggerPrice,
        executePrice: executePrice || undefined,
        quantity,
        status: String(row.algoStatus || row.status || "NEW"),
        createdAt:
          typeof row.updateTime === "number"
            ? row.updateTime
            : typeof row.time === "number"
              ? row.time
              : undefined,
        raw: row,
      };
    });

    return mapped.filter((row): row is AlgoOrderInfo => row !== null);
  } catch (error) {
    console.warn(
      `[Binance] Falling back to legacy algo-order discovery for ${normalized || "all symbols"}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return deps.getLegacyAlgoOrders(normalized);
  }
}

export async function cancelBinanceAlgoOrders(
  deps: BinanceDeps,
  symbol: string,
): Promise<{ cancelled: string[]; errors: string[] }> {
  const cancelled: string[] = [];
  const errors: string[] = [];
  const normalized = deps.toSymbol(symbol);
  const algoOrders = await getBinanceAlgoOrders(deps, normalized);

  if (algoOrders.length === 0) {
    return { cancelled, errors };
  }

  for (const order of algoOrders) cancelled.push(order.orderId);

  try {
    await deps.signedRequest("DELETE", "/fapi/v1/algoOpenOrders", {
      symbol: normalized,
    });
    return { cancelled, errors };
  } catch (bulkError) {
    cancelled.length = 0;

    for (const order of algoOrders) {
      try {
        await deps.signedRequest("DELETE", "/fapi/v1/algoOrder", {
          symbol: normalized,
          algoId: order.orderId,
        });
        cancelled.push(order.orderId);
      } catch (error) {
        errors.push(
          `${order.orderId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    if (cancelled.length === 0 && errors.length === 0) {
      errors.push(bulkError instanceof Error ? bulkError.message : "Unknown error");
    }
  }

  return { cancelled, errors };
}

export async function getBinanceOrderHistory(
  deps: BinanceDeps,
  symbol?: string,
  limit: number = 20,
): Promise<HistoricalOrder[]> {
  const symbolsToQuery = symbol
    ? [deps.toSymbol(symbol)]
    : Array.from(new Set((await deps.getOpenPositions()).map((p) => deps.toSymbol(p.symbol))));

  if (symbolsToQuery.length === 0) {
    return [];
  }

  const results: HistoricalOrder[] = [];
  for (const sym of symbolsToQuery) {
    const orders = await deps.signedRequest<Array<Record<string, unknown>>>(
      "GET",
      "/fapi/v1/allOrders",
      { symbol: sym, limit },
    );

    for (const o of orders) {
      results.push({
        orderId: String(o.orderId),
        symbol: String(o.symbol || ""),
        side: String(o.side || "") as "BUY" | "SELL",
        type: String(o.type || ""),
        price: parseFloat(String(o.avgPrice || "0")) || parseFloat(String(o.price || "0")),
        quantity: parseFloat(String(o.origQty || "0")),
        filledQuantity: parseFloat(String(o.executedQty || "0")),
        fee: 0,
        status: String(o.status || ""),
        createdAt: typeof o.time === "number" ? o.time : 0,
        updatedAt: typeof o.updateTime === "number" ? o.updateTime : undefined,
        raw: o,
      });
    }
  }

  results.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  return results.slice(0, limit);
}

export async function getBinanceInstrumentSpecs(
  deps: BinanceDeps,
  symbol: string,
): Promise<BinanceInstrumentSpecs> {
  const normalized = deps.toSymbol(symbol);
  const cached = deps.specsCache.get(normalized);
  if (cached && Date.now() - cached.ts < deps.specsCacheTtl) {
    return cached.specs as BinanceInstrumentSpecs;
  }

  const data = await deps.publicRequest<{
    symbols?: Array<{
      symbol: string;
      baseAsset: string;
      quantityPrecision?: number;
      pricePrecision?: number;
      filters: Array<{
        filterType: string;
        stepSize?: string;
        minQty?: string;
        tickSize?: string;
      }>;
    }>;
  }>("/fapi/v1/exchangeInfo", { symbol: normalized });

  const row = data.symbols?.[0];
  if (!row) {
    throw new Error(`Instrument not found on Binance: ${normalized}`);
  }

  const lotFilter = row.filters.find((f) => f.filterType === "LOT_SIZE");
  const marketLotFilter = row.filters.find((f) => f.filterType === "MARKET_LOT_SIZE");
  const priceFilter = row.filters.find((f) => f.filterType === "PRICE_FILTER");
  const lotSz = parseFloat(lotFilter?.stepSize || "1");
  const minSz = parseFloat(lotFilter?.minQty || "1");
  const marketLotSz = parseFloat(marketLotFilter?.stepSize || lotFilter?.stepSize || "1");
  const marketMinSz = parseFloat(marketLotFilter?.minQty || lotFilter?.minQty || "1");
  const tickSz = parseFloat(priceFilter?.tickSize || "0.01");

  const specs: BinanceInstrumentSpecs = {
    ctVal: 1,
    lotSz,
    minSz,
    ctValCcy: row.baseAsset || normalized.replace(/USDT|BUSD|USDC$/, ""),
    tickSz,
    qtyDecimals: deps.pickPrecision(row.quantityPrecision, lotFilter?.stepSize, lotSz),
    priceDecimals: deps.pickPrecision(row.pricePrecision, priceFilter?.tickSize, tickSz),
    marketLotSz,
    marketMinSz,
    marketQtyDecimals: deps.pickPrecision(
      row.quantityPrecision,
      marketLotFilter?.stepSize || lotFilter?.stepSize,
      marketLotSz,
    ),
  };

  deps.specsCache.set(normalized, { specs, ts: Date.now() });
  return specs;
}
