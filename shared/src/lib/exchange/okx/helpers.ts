import type { AxiosInstance } from "axios";
import type {
  AccountInfo,
  AlgoOrderInfo,
  HistoricalOrder,
  InstrumentSpecs,
  KlineData,
  OpenOrderInfo,
  PositionInfo,
} from "../types";

export type OkxPositionMode = "long_short_mode" | "net_mode";

export type OkxContext = {
  client: AxiosInstance;
  authHeaders(method: string, path: string, body?: string): Record<string, string>;
  toOkxSymbol(symbol: string): string;
  fromOkxSymbol(instId: string): string;
  getPositionMode(forceRefresh?: boolean): Promise<OkxPositionMode>;
  specsCache: Map<string, { specs: InstrumentSpecs; ts: number }>;
  specsCacheTtl: number;
};

export async function getOkxAccountInfo(ctx: OkxContext): Promise<AccountInfo> {
  const path = "/api/v5/account/balance";
  const headers = ctx.authHeaders("GET", path);
  const response = await ctx.client.get(path, { headers });
  const data = response.data;
  if (data.code === "0" && data.data?.[0]) {
    const account = data.data[0];
    const usdtDetail = account.details?.find((d: { ccy: string }) => d.ccy === "USDT");
    return {
      totalBalance: parseFloat(account.totalEq || "0"),
      availableBalance: parseFloat(usdtDetail?.availBal || usdtDetail?.cashBal || "0"),
      unrealizedPnl: parseFloat(usdtDetail?.upl || "0"),
      currency: "USD",
    };
  }
  throw new Error(`OKX API error: ${data.msg || "Unknown error"}`);
}

export async function getOkxTickerPrice(ctx: OkxContext, symbol: string): Promise<number> {
  const instId = ctx.toOkxSymbol(symbol);
  const path = `/api/v5/market/ticker?instId=${instId}`;
  const response = await ctx.client.get(path);
  const data = response.data;
  if (data.code === "0" && data.data?.[0]) return parseFloat(data.data[0].last);
  throw new Error(`Failed to get price for ${symbol} (${instId})`);
}

export async function getOkxKlines(
  ctx: OkxContext,
  symbol: string,
  interval: string = "1H",
  limit: number = 24,
): Promise<KlineData[]> {
  const instId = ctx.toOkxSymbol(symbol);
  const path = `/api/v5/market/candles?instId=${instId}&bar=${interval}&limit=${limit}`;
  const response = await ctx.client.get(path);
  const data = response.data;
  if (data.code === "0" && data.data) {
    return data.data.reverse().map((k: string[]) => ({
      time: Math.floor(parseFloat(k[0]) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }
  return [];
}

export async function getOkxOpenPositions(ctx: OkxContext): Promise<PositionInfo[]> {
  const path = "/api/v5/account/positions";
  const headers = ctx.authHeaders("GET", path);
  const response = await ctx.client.get(path, { headers });
  const data = response.data;
  if (data.code === "0") {
    return (data.data || []).map((pos: {
      instId: string; pos: string; posSide: string; lever: string; margin: string;
      avgPx: string; upl: string; liqPx: string; markPx: string; mgnMode: string; posId: string;
    }) => ({
      symbol: ctx.fromOkxSymbol(pos.instId),
      positionId: pos.posId || pos.instId,
      side: pos.posSide === "long" ? "LONG" as const : pos.posSide === "short" ? "SHORT" as const : parseFloat(pos.pos) >= 0 ? "LONG" as const : "SHORT" as const,
      leverage: parseFloat(pos.lever),
      marginType: pos.mgnMode === "isolated" ? "isolated" : "cross" as const,
      entryPrice: parseFloat(pos.avgPx),
      quantity: Math.abs(parseFloat(pos.pos)),
      margin: parseFloat(pos.margin),
      unrealizedPnl: parseFloat(pos.upl),
      liquidationPrice: parseFloat(pos.liqPx) || 0,
      markPrice: parseFloat(pos.markPx),
      raw: pos,
    }));
  }
  if (data.code === "51001") return [];
  throw new Error(`Failed to get OKX positions: ${data.msg || "Unknown error"}`);
}

export async function placeOkxProtectionOrder(
  ctx: OkxContext,
  kind: "sl" | "tp",
  symbol: string,
  triggerPrice: number,
  executePrice: number,
  side: "BUY" | "SELL",
  quantity: number,
): Promise<string> {
  const instId = ctx.toOkxSymbol(symbol);
  const positionMode = await ctx.getPositionMode();
  const posSide = positionMode === "long_short_mode" ? (side === "SELL" ? "long" : "short") : undefined;
  const okxSide = side === "BUY" ? "buy" : "sell";
  const payload: Record<string, string> = {
    instId,
    tdMode: "isolated",
    side: okxSide,
    ordType: "conditional",
    sz: String(quantity),
    ...(kind === "sl"
      ? { slTriggerPx: String(triggerPrice), slOrdPx: String(executePrice || triggerPrice) }
      : { tpTriggerPx: String(triggerPrice), tpOrdPx: String(executePrice || triggerPrice) }),
  };
  if (posSide) payload.posSide = posSide;
  const body = JSON.stringify(payload);
  const path = "/api/v5/trade/order-algo";
  const headers = ctx.authHeaders("POST", path, body);
  const response = await ctx.client.post(path, body, { headers });
  const data = response.data;
  if (data.code === "0" && data.data?.[0]?.algoId) return data.data[0].algoId;
  throw new Error(`Failed to place OKX ${kind === "sl" ? "stop loss" : "take profit"}: ${data.msg || data.data?.[0]?.sMsg || "Unknown error"}`);
}

export async function setOkxLeverage(
  ctx: OkxContext,
  symbol: string,
  leverage: number,
  marginType: "isolated" | "cross",
  side?: "BUY" | "SELL",
): Promise<number> {
  const instId = ctx.toOkxSymbol(symbol);
  const path = "/api/v5/account/set-leverage";
  const positionMode = await ctx.getPositionMode();
  const sides: Array<{ posSide?: string; label: string }> =
    positionMode === "long_short_mode"
      ? side === "BUY"
        ? [{ posSide: "long", label: "long" }]
        : side === "SELL"
          ? [{ posSide: "short", label: "short" }]
          : [
              { posSide: "long", label: "long" },
              { posSide: "short", label: "short" },
            ]
      : [{ label: "net" }];

  for (const { posSide, label } of sides) {
    const requestBody: Record<string, string> = {
      instId,
      lever: String(leverage),
      mgnMode: marginType,
    };
    if (posSide) requestBody.posSide = posSide;

    const body = JSON.stringify(requestBody);
    const headers = ctx.authHeaders("POST", path, body);

    console.log(
      `[OKX] 🔧 Setting leverage for ${instId} ${label}: ${leverage}x (${marginType})...`,
    );

    try {
      const response = await ctx.client.post(path, body, { headers });
      const data = response.data;
      if (data.code !== "0") {
        console.warn(
          `[OKX] ⚠️ Failed to set leverage for ${instId} ${label}: code=${data.code}, msg=${data.msg}`,
        );
      } else {
        console.log(`[OKX] ✅ Leverage set for ${instId} ${label}: ${leverage}x`);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[OKX] ⚠️ Error setting leverage for ${instId} ${label}: ${errMsg}`,
      );
    }
  }

  return leverage;
}

export async function getOkxOpenOrders(
  ctx: OkxContext,
  symbol?: string,
): Promise<OpenOrderInfo[]> {
  const instId = symbol ? ctx.toOkxSymbol(symbol) : undefined;
  const path = instId
    ? `/api/v5/trade/orders-pending?instType=SWAP&instId=${instId}`
    : "/api/v5/trade/orders-pending?instType=SWAP";
  const headers = ctx.authHeaders("GET", path);
  const response = await ctx.client.get(path, { headers });
  const data = response.data;

  if (data.code === "0" && data.data) {
    return data.data.map(
      (o: {
        ordId: string;
        instId: string;
        side: string;
        ordType: string;
        px?: string;
        sz: string;
        accFillSz: string;
        state: string;
        cTime?: string;
        [key: string]: unknown;
      }) => ({
        orderId: o.ordId,
        symbol: ctx.fromOkxSymbol(o.instId),
        side: o.side === "buy" ? ("BUY" as const) : ("SELL" as const),
        type: o.ordType,
        price: o.px ? parseFloat(o.px) : undefined,
        quantity: parseFloat(o.sz),
        filledQuantity: parseFloat(o.accFillSz || "0"),
        status: o.state,
        createdAt: o.cTime ? parseInt(o.cTime) : undefined,
        raw: o,
      }),
    );
  }

  return [];
}

export async function cancelOkxOrder(
  ctx: OkxContext,
  orderId: string,
  symbol: string,
): Promise<boolean> {
  const instId = ctx.toOkxSymbol(symbol);
  const body = JSON.stringify([{ instId, ordId: orderId }]);
  const path = "/api/v5/trade/cancel-batch-orders";
  const headers = ctx.authHeaders("POST", path, body);

  console.log(`[OKX] 🗑️ Cancelling order ${orderId} for ${instId}...`);

  const response = await ctx.client.post(path, body, { headers });
  const data = response.data;

  if (data.code === "0" && data.data?.[0]?.sCode === "0") {
    console.log(`[OKX] ✅ Order cancelled: ${orderId}`);
    return true;
  }

  console.warn(
    `[OKX] ⚠️ Failed to cancel order: ${data.msg || data.data?.[0]?.sMsg}`,
  );
  return false;
}

export async function getOkxAlgoOrders(
  ctx: OkxContext,
  symbol?: string,
): Promise<AlgoOrderInfo[]> {
  const instId = symbol ? ctx.toOkxSymbol(symbol) : undefined;
  const path = instId
    ? `/api/v5/trade/orders-algo-pending?ordType=conditional&instType=SWAP&instId=${instId}`
    : "/api/v5/trade/orders-algo-pending?ordType=conditional&instType=SWAP";
  const headers = ctx.authHeaders("GET", path);
  const response = await ctx.client.get(path, { headers });
  const data = response.data;

  if (data.code === "0" && data.data) {
    return data.data.map(
      (o: {
        algoId: string;
        instId: string;
        side: string;
        ordType: string;
        slTriggerPx?: string;
        slOrdPx?: string;
        tpTriggerPx?: string;
        tpOrdPx?: string;
        sz: string;
        state: string;
        cTime?: string;
        [key: string]: unknown;
      }) => ({
        orderId: o.algoId,
        symbol: ctx.fromOkxSymbol(o.instId),
        side: o.side === "buy" ? ("BUY" as const) : ("SELL" as const),
        type: o.tpTriggerPx ? "tp" : "sl",
        triggerPrice: parseFloat(o.tpTriggerPx || o.slTriggerPx || "0"),
        executePrice: parseFloat(o.tpOrdPx || o.slOrdPx || "0") || undefined,
        quantity: parseFloat(o.sz),
        status: o.state,
        createdAt: o.cTime ? parseInt(o.cTime) : undefined,
        raw: o,
      }),
    );
  }

  return [];
}

export async function cancelOkxAlgoOrders(
  ctx: OkxContext,
  symbol: string,
): Promise<{ cancelled: string[]; errors: string[] }> {
  const instId = ctx.toOkxSymbol(symbol);
  const cancelled: string[] = [];
  const errors: string[] = [];
  const algoOrders = await getOkxAlgoOrders(ctx, symbol);

  if (algoOrders.length === 0) {
    return { cancelled, errors };
  }

  const orderIds = algoOrders.map((o) => ({ instId, algoId: o.orderId }));
  const body = JSON.stringify(orderIds);
  const path = "/api/v5/trade/cancel-algos";
  const headers = ctx.authHeaders("POST", path, body);

  console.log(
    `[OKX] 🗑️ Cancelling ${algoOrders.length} algo orders for ${instId}...`,
  );

  try {
    const response = await ctx.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0" && data.data) {
      for (const result of data.data) {
        if (result.sCode === "0") {
          cancelled.push(result.algoId);
        } else {
          errors.push(`${result.algoId}: ${result.sMsg}`);
        }
      }
    } else {
      errors.push(`Batch cancel failed: ${data.msg || "Unknown error"}`);
    }
  } catch (error) {
    errors.push(
      `Failed to cancel algo orders: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  return { cancelled, errors };
}

export async function getOkxOrderHistory(
  ctx: OkxContext,
  symbol?: string,
  limit: number = 20,
): Promise<HistoricalOrder[]> {
  const instId = symbol ? ctx.toOkxSymbol(symbol) : undefined;
  const path = instId
    ? `/api/v5/trade/orders-history-archive?instType=SWAP&instId=${instId}&limit=${limit}`
    : `/api/v5/trade/orders-history-archive?instType=SWAP&limit=${limit}`;
  const headers = ctx.authHeaders("GET", path);
  const response = await ctx.client.get(path, { headers });
  const data = response.data;

  if (data.code === "0" && data.data) {
    return data.data.map(
      (o: {
        ordId: string;
        instId: string;
        side: string;
        ordType: string;
        px: string;
        sz: string;
        accFillSz: string;
        fee?: string;
        pnl?: string;
        state: string;
        cTime: string;
        uTime?: string;
        [key: string]: unknown;
      }) => ({
        orderId: o.ordId,
        symbol: ctx.fromOkxSymbol(o.instId),
        side: o.side === "buy" ? ("BUY" as const) : ("SELL" as const),
        type: o.ordType,
        price: parseFloat(o.px || "0"),
        quantity: parseFloat(o.sz),
        filledQuantity: parseFloat(o.accFillSz || "0"),
        fee: Math.abs(parseFloat(o.fee || "0")),
        realizedPnl: o.pnl ? parseFloat(o.pnl) : undefined,
        status: o.state,
        createdAt: parseInt(o.cTime),
        updatedAt: o.uTime ? parseInt(o.uTime) : undefined,
        raw: o,
      }),
    );
  }

  return [];
}

export async function getOkxInstrumentSpecs(
  ctx: OkxContext,
  symbol: string,
): Promise<InstrumentSpecs> {
  const instId = ctx.toOkxSymbol(symbol);
  const cached = ctx.specsCache.get(instId);
  if (cached && Date.now() - cached.ts < ctx.specsCacheTtl) {
    return cached.specs;
  }

  const path = `/api/v5/public/instruments?instType=SWAP&instId=${instId}`;
  const response = await ctx.client.get(path);
  const data = response.data;

  if (data.code !== "0" || !data.data?.[0]) {
    throw new Error(
      `Failed to get instrument specs for ${instId}: ${data.msg || "not found"}`,
    );
  }

  const inst = data.data[0];
  const lotSz = parseFloat(inst.lotSz || "1");
  const tickSz = parseFloat(inst.tickSz || "0.1");
  const ctVal = parseFloat(inst.ctVal || "1");
  const qtyDecimals = inst.lotSz?.includes(".")
    ? inst.lotSz.split(".")[1].replace(/0+$/, "").length
    : 0;
  const priceDecimals = inst.tickSz?.includes(".")
    ? inst.tickSz.split(".")[1].replace(/0+$/, "").length
    : 0;

  const specs: InstrumentSpecs = {
    ctVal,
    lotSz,
    minSz: parseFloat(inst.minSz || "1"),
    ctValCcy: inst.ctValCcy || "",
    tickSz,
    qtyDecimals,
    priceDecimals,
  };

  ctx.specsCache.set(instId, { specs, ts: Date.now() });

  console.log(
    `[OKX] 📋 Instrument specs: ${instId} ctVal=${ctVal} lotSz=${lotSz} minSz=${inst.minSz} tickSz=${tickSz} qtyDecimals=${qtyDecimals}`,
  );

  return specs;
}
