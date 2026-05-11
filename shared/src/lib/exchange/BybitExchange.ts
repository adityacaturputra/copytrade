import axios, { AxiosInstance } from "axios";
import CryptoJS from "crypto-js";
import {
  ExchangeClient,
  OrderParams,
  PositionInfo,
  AccountInfo,
  KlineData,
  OrderResult,
  OpenOrderInfo,
  AlgoOrderInfo,
  HistoricalOrder,
  InstrumentSpecs,
} from "./types";
import { getProxyAgent } from "../proxy/ProxyFactory";
import { buildHttpErrorMessage } from "../http-error";

type HttpMethod = "GET" | "POST";

type BybitResponse<T> = {
  retCode: number;
  retMsg: string;
  result: T;
  time?: number;
};

type BybitWalletBalanceResult = {
  list?: Array<{
    accountType?: string;
    totalEquity?: string;
    totalAvailableBalance?: string;
    totalPerpUPL?: string;
    totalWalletBalance?: string;
    coin?: Array<{
      coin?: string;
      equity?: string;
      walletBalance?: string;
      availableToWithdraw?: string;
      availableToBorrow?: string;
      unrealisedPnl?: string;
    }>;
  }>;
};

type BybitPositionRow = {
  symbol?: string;
  side?: "Buy" | "Sell" | "";
  size?: string;
  avgPrice?: string;
  leverage?: string;
  tradeMode?: number;
  positionIM?: string;
  positionBalance?: string;
  unrealisedPnl?: string;
  liqPrice?: string;
  markPrice?: string;
  positionIdx?: number;
  takeProfit?: string;
  stopLoss?: string;
  updatedTime?: string;
  [key: string]: unknown;
};

type BybitPositionListResult = {
  list?: BybitPositionRow[];
  nextPageCursor?: string;
};

type BybitOrderRow = {
  orderId?: string;
  orderLinkId?: string;
  symbol?: string;
  side?: "Buy" | "Sell";
  orderType?: string;
  price?: string;
  qty?: string;
  cumExecQty?: string;
  orderStatus?: string;
  createdTime?: string;
  updatedTime?: string;
  triggerPrice?: string;
  stopOrderType?: string;
  orderFilter?: string;
  avgPrice?: string;
  cumExecFee?: string;
  closedPnl?: string;
  [key: string]: unknown;
};

type BybitOrderListResult = {
  list?: BybitOrderRow[];
  nextPageCursor?: string;
};

type BybitTickerResult = {
  list?: Array<{
    symbol?: string;
    lastPrice?: string;
  }>;
};

type BybitKlineResult = {
  list?: string[][];
};

type BybitInstrumentInfoResult = {
  list?: Array<{
    symbol?: string;
    baseCoin?: string;
    quoteCoin?: string;
    priceFilter?: {
      tickSize?: string;
    };
    lotSizeFilter?: {
      qtyStep?: string;
      minOrderQty?: string;
      minNotionalValue?: string;
    };
  }>;
};

type BybitCreateOrderResult = {
  orderId?: string;
  orderLinkId?: string;
};

type BybitAccountInfoResult = {
  unifiedMarginStatus?: number | string;
};

const BYBIT_LINEAR_CATEGORY = "linear";
const BYBIT_SETTLE_COIN = "USDT";
const BYBIT_ACCOUNT_TYPE = "UNIFIED";
const BYBIT_RECV_WINDOW = "10000";
const SPECS_CACHE_TTL = 30 * 60 * 1000;
const ACCOUNT_INFO_CACHE_TTL = 5 * 60 * 1000;
const BYBIT_MARGIN_MODE = {
  isolated: {
    account: "ISOLATED_MARGIN",
    tradeMode: 1,
  },
  cross: {
    account: "REGULAR_MARGIN",
    tradeMode: 0,
  },
} as const;

function getBybitBaseUrl(simulated: boolean): string {
  return (
    process.env.BYBIT_PROXY_URL ||
    (simulated
      ? process.env.BYBIT_DEMO_BASE_URL ||
        process.env.BYBIT_TESTNET_BASE_URL ||
        "https://api-demo.bybit.com"
      : process.env.BYBIT_BASE_URL || "https://api.bybit.com")
  );
}

export class BybitExchange implements ExchangeClient {
  readonly name = "bybit";

  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly client: AxiosInstance;
  private readonly simulated: boolean;
  private readonly baseUrl: string;
  private readonly specsCache = new Map<
    string,
    { specs: InstrumentSpecs; ts: number }
  >();
  private accountInfoCache?: { unifiedMarginStatus: number; ts: number };

  constructor(apiKey: string, secretKey: string, simulated: boolean = false) {
    this.apiKey = apiKey.trim();
    this.secretKey = secretKey.trim();
    this.simulated = simulated;
    this.baseUrl = getBybitBaseUrl(simulated);
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.client.interceptors.request.use(async (config) => {
      try {
        const agent = await getProxyAgent();
        if (agent) {
          config.httpsAgent = agent;
          config.httpAgent = agent;
        }
      } catch (error) {
        console.warn(
          "[Bybit] Proxy agent not available, using direct connection:",
          error instanceof Error ? error.message : error,
        );
      }
      return config;
    });
  }

  private toSymbol(symbol: string): string {
    const normalized = symbol.replace(/[-_/]/g, "").toUpperCase();
    return normalized.endsWith("SWAP")
      ? normalized.slice(0, -4)
      : normalized;
  }

  private parseNumber(value: unknown, fallback: number = 0): number {
    const parsed =
      typeof value === "number" ? value : parseFloat(String(value || ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private countDecimals(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const text = value.toString();
    if (text.includes("e-")) {
      const [, exp] = text.split("e-");
      return parseInt(exp || "0", 10);
    }
    const [, frac = ""] = text.split(".");
    return frac.replace(/0+$/, "").length;
  }

  private clampToStep(value: number, step: number, decimals: number): number {
    if (!Number.isFinite(step) || step <= 0) {
      return Number(value.toFixed(Math.max(0, decimals)));
    }
    const units = Math.floor(value / step + 1e-12);
    return Number((units * step).toFixed(decimals));
  }

  private formatNum(value: number, decimals: number): string {
    return value.toFixed(decimals);
  }

  private buildQueryString(
    params: Record<string, string | number | boolean | undefined>,
  ): string {
    const entries = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)] as [string, string])
      .sort(([a], [b]) => a.localeCompare(b));

    return new URLSearchParams(entries).toString();
  }

  private sign(timestamp: string, payload: string): string {
    return CryptoJS.HmacSHA256(
      `${timestamp}${this.apiKey}${BYBIT_RECV_WINDOW}${payload}`,
      this.secretKey,
    ).toString(CryptoJS.enc.Hex);
  }

  private buildSignedHeaders(timestamp: string, payload: string) {
    return {
      "X-BAPI-API-KEY": this.apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": BYBIT_RECV_WINDOW,
      "X-BAPI-SIGN": this.sign(timestamp, payload),
      "X-BAPI-SIGN-TYPE": "2",
    };
  }

  private normalizeError(
    error: unknown,
    context: string,
    payload?: Record<string, unknown>,
  ): Error {
    const environmentHint =
      axios.isAxiosError(error) && error.response?.status === 401
        ? this.simulated
          ? " | hint=Bybit demo keys must use api-demo.bybit.com. Testnet keys must use api-testnet.bybit.com."
          : " | hint=Bybit production keys must use api.bybit.com."
        : "";

    return new Error(
      `${buildHttpErrorMessage(`[Bybit] ${context} failed`, error, {
        payload,
      })} | baseUrl=${this.baseUrl}${environmentHint}`,
    );
  }

  private async publicRequest<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    try {
      const response = await this.client.get<BybitResponse<T>>(path, { params });
      if (response.data.retCode !== 0) {
        throw new Error(response.data.retMsg || "Unknown Bybit error");
      }
      return response.data.result;
    } catch (error) {
      throw this.normalizeError(error, `GET ${path}`, params);
    }
  }

  private async signedRequest<T>(
    method: HttpMethod,
    path: string,
    payload: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const timestamp = String(Date.now());

    try {
      if (method === "GET") {
        const query = this.buildQueryString(payload);
        const response = await this.client.get<BybitResponse<T>>(
          query ? `${path}?${query}` : path,
          {
            headers: this.buildSignedHeaders(timestamp, query),
          },
        );
        if (response.data.retCode !== 0) {
          throw new Error(response.data.retMsg || "Unknown Bybit error");
        }
        return response.data.result;
      }

      const body = Object.fromEntries(
        Object.entries(payload).filter(
          ([, value]) => value !== undefined && value !== null,
        ),
      );
      const serializedBody = JSON.stringify(body);
      const response = await this.client.post<BybitResponse<T>>(path, body, {
        headers: this.buildSignedHeaders(timestamp, serializedBody),
      });
      if (response.data.retCode !== 0) {
        throw new Error(response.data.retMsg || "Unknown Bybit error");
      }
      return response.data.result;
    } catch (error) {
      throw this.normalizeError(error, `${method} ${path}`, payload);
    }
  }

  private async fetchPositions(
    symbol?: string,
  ): Promise<BybitPositionRow[]> {
    const rows: BybitPositionRow[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.signedRequest<BybitPositionListResult>(
        "GET",
        "/v5/position/list",
        {
          category: BYBIT_LINEAR_CATEGORY,
          settleCoin: BYBIT_SETTLE_COIN,
          symbol: symbol ? this.toSymbol(symbol) : undefined,
          limit: 200,
          cursor,
        },
      );

      rows.push(...(result.list || []));
      cursor = result.nextPageCursor || undefined;
    } while (cursor);

    return rows;
  }

  private async getUnifiedMarginStatus(): Promise<number> {
    const cached = this.accountInfoCache;
    if (cached && Date.now() - cached.ts < ACCOUNT_INFO_CACHE_TTL) {
      return cached.unifiedMarginStatus;
    }

    const result = await this.signedRequest<BybitAccountInfoResult>(
      "GET",
      "/v5/account/info",
    );
    const unifiedMarginStatus = this.parseNumber(
      result.unifiedMarginStatus,
      0,
    );

    this.accountInfoCache = {
      unifiedMarginStatus,
      ts: Date.now(),
    };

    return unifiedMarginStatus;
  }

  private async isUnifiedLinearAccount(): Promise<boolean> {
    return (await this.getUnifiedMarginStatus()) >= 3;
  }

  private async fetchRealtimeOrders(
    orderFilter: "Order" | "StopOrder",
    symbol?: string,
  ): Promise<BybitOrderRow[]> {
    const rows: BybitOrderRow[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.signedRequest<BybitOrderListResult>(
        "GET",
        "/v5/order/realtime",
        {
          category: BYBIT_LINEAR_CATEGORY,
          settleCoin: BYBIT_SETTLE_COIN,
          symbol: symbol ? this.toSymbol(symbol) : undefined,
          orderFilter,
          openOnly: 0,
          limit: 50,
          cursor,
        },
      );

      rows.push(...(result.list || []));
      cursor = result.nextPageCursor || undefined;
    } while (cursor);

    return rows;
  }

  private async fetchTargetPosition(
    symbol: string,
    closingSide: "BUY" | "SELL",
  ): Promise<BybitPositionRow> {
    const normalized = this.toSymbol(symbol);
    const desiredPositionSide = closingSide === "SELL" ? "Buy" : "Sell";
    const positions = (await this.fetchPositions(normalized)).filter(
      (row) =>
        row.symbol === normalized &&
        row.side === desiredPositionSide &&
        this.parseNumber(row.size) > 0,
    );

    if (positions.length === 0) {
      throw new Error(
        `No open Bybit position found for ${normalized} matching close side ${closingSide}`,
      );
    }

    const explicit = positions.find(
      (row) =>
        row.positionIdx === (desiredPositionSide === "Buy" ? 1 : 2),
    );
    return explicit || positions[0];
  }

  private getPositionAlgoSide(positionSide: "Buy" | "Sell"): "BUY" | "SELL" {
    return positionSide === "Buy" ? "SELL" : "BUY";
  }

  private parseAlgoType(stopOrderType?: string): "tp" | "sl" | "conditional" {
    const normalized = String(stopOrderType || "").toLowerCase();
    if (normalized.includes("take")) return "tp";
    if (normalized.includes("stop")) return "sl";
    return "conditional";
  }

  private parseAlgoTypeFromOrder(row: BybitOrderRow): "tp" | "sl" | "conditional" {
    const linkId = String(row.orderLinkId || "").toLowerCase();
    if (linkId.startsWith("ct_tp_")) return "tp";
    if (linkId.startsWith("ct_sl_")) return "sl";
    return this.parseAlgoType(row.stopOrderType);
  }

  private buildAlgoOrderLinkId(type: "tp" | "sl"): string {
    return `ct_${type}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  private getTriggerDirection(
    currentPrice: number,
    triggerPrice: number,
  ): 1 | 2 {
    return triggerPrice >= currentPrice ? 1 : 2;
  }

  private async clearTradingStopsForPosition(
    symbol: string,
    positionIdx: number,
  ): Promise<void> {
    await this.signedRequest(
      "POST",
      "/v5/position/trading-stop",
      {
        category: BYBIT_LINEAR_CATEGORY,
        symbol: this.toSymbol(symbol),
        positionIdx,
        tpslMode: "Full",
        takeProfit: "0",
        stopLoss: "0",
      },
    );
  }

  async clearPositionStopLoss(
    symbol: string,
    positionIdx: number,
  ): Promise<void> {
    await this.signedRequest(
      "POST",
      "/v5/position/trading-stop",
      {
        category: BYBIT_LINEAR_CATEGORY,
        symbol: this.toSymbol(symbol),
        positionIdx,
        tpslMode: "Full",
        stopLoss: "0",
      },
    );
  }

  private isIgnorableMarginModeError(message: string): boolean {
    const normalized = message.toLowerCase();

    return (
      normalized.includes("not modified") ||
      normalized.includes("has not been modified") ||
      normalized.includes("margin mode is not modified") ||
      normalized.includes("position mode is not modified") ||
      normalized.includes("same tp sl mode") ||
      normalized.includes("not applicable") ||
      normalized.includes("not supported") ||
      normalized.includes("uta2.0") ||
      normalized.includes("uta 2.0")
    );
  }

  private async ensureAccountMarginMode(
    marginType: "isolated" | "cross",
  ): Promise<void> {
    try {
      await this.signedRequest(
        "POST",
        "/v5/account/set-margin-mode",
        {
          setMarginMode: BYBIT_MARGIN_MODE[marginType].account,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isIgnorableMarginModeError(message)) {
        return;
      }
      throw error;
    }
  }

  private async ensureSymbolMarginMode(
    symbol: string,
    leverage: number,
    marginType: "isolated" | "cross",
  ): Promise<void> {
    try {
      await this.signedRequest(
        "POST",
        "/v5/position/switch-isolated",
        {
          category: BYBIT_LINEAR_CATEGORY,
          symbol,
          tradeMode: BYBIT_MARGIN_MODE[marginType].tradeMode,
          buyLeverage: String(leverage),
          sellLeverage: String(leverage),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isIgnorableMarginModeError(message)) {
        return;
      }
      throw error;
    }
  }

  private async ensureMarginMode(
    symbol: string,
    leverage: number,
    marginType: "isolated" | "cross",
  ): Promise<void> {
    const isUnifiedLinearAccount = await this.isUnifiedLinearAccount();
    await this.ensureAccountMarginMode(marginType);
    if (isUnifiedLinearAccount) {
      return;
    }
    await this.ensureSymbolMarginMode(symbol, leverage, marginType);
  }

  private async placeConditionalCloseOrder(
    type: "tp" | "sl",
    symbol: string,
    triggerPrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    const normalized = this.toSymbol(symbol);
    const specs = await this.getInstrumentSpecs(normalized);
    const targetPosition = await this.fetchTargetPosition(normalized, side);
    const currentPrice =
      this.parseNumber(targetPosition.markPrice) ||
      (await this.getTickerPrice(normalized));
    const trigger = this.clampToStep(
      triggerPrice,
      specs.tickSz,
      specs.priceDecimals,
    );
    const maxQuantity = this.parseNumber(targetPosition.size);
    const requestedQuantity = Math.min(quantity, maxQuantity);
    const qty = this.clampToStep(
      requestedQuantity,
      specs.lotSz,
      specs.qtyDecimals,
    );

    if (qty < specs.minSz) {
      throw new Error(
        `Conditional ${type.toUpperCase()} quantity too small for ${normalized}: ${qty} < ${specs.minSz}`,
      );
    }

    const orderLinkId = this.buildAlgoOrderLinkId(type);
    const result = await this.signedRequest<BybitCreateOrderResult>(
      "POST",
      "/v5/order/create",
      {
        category: BYBIT_LINEAR_CATEGORY,
        symbol: normalized,
        side: side === "BUY" ? "Buy" : "Sell",
        orderType: "Market",
        qty: this.formatNum(qty, specs.qtyDecimals),
        triggerPrice: this.formatNum(trigger, specs.priceDecimals),
        triggerDirection: this.getTriggerDirection(currentPrice, trigger),
        triggerBy: "MarkPrice",
        reduceOnly: true,
        closeOnTrigger: true,
        positionIdx: targetPosition.positionIdx ?? 0,
        orderLinkId,
      },
    );

    return result.orderId || result.orderLinkId || orderLinkId;
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const result = await this.signedRequest<BybitWalletBalanceResult>(
      "GET",
      "/v5/account/wallet-balance",
      {
        accountType: BYBIT_ACCOUNT_TYPE,
        coin: BYBIT_SETTLE_COIN,
      },
    );

    const wallet = result.list?.[0];
    const usdtCoin =
      wallet?.coin?.find((item) => item.coin === BYBIT_SETTLE_COIN) ||
      wallet?.coin?.[0];

    return {
      totalBalance:
        this.parseNumber(wallet?.totalEquity) ||
        this.parseNumber(wallet?.totalWalletBalance) ||
        this.parseNumber(usdtCoin?.equity) ||
        this.parseNumber(usdtCoin?.walletBalance),
      availableBalance:
        this.parseNumber(wallet?.totalAvailableBalance) ||
        this.parseNumber(usdtCoin?.availableToWithdraw) ||
        this.parseNumber(usdtCoin?.walletBalance),
      unrealizedPnl:
        this.parseNumber(wallet?.totalPerpUPL) ||
        this.parseNumber(usdtCoin?.unrealisedPnl),
      currency: BYBIT_SETTLE_COIN,
    };
  }

  async getTickerPrice(symbol: string): Promise<number> {
    const normalized = this.toSymbol(symbol);
    const result = await this.publicRequest<BybitTickerResult>(
      "/v5/market/tickers",
      {
        category: BYBIT_LINEAR_CATEGORY,
        symbol: normalized,
      },
    );

    const ticker = result.list?.find((item) => item.symbol === normalized);
    if (!ticker?.lastPrice) {
      throw new Error(`Ticker not found on Bybit for ${normalized}`);
    }

    return this.parseNumber(ticker.lastPrice);
  }

  async getKlines(
    symbol: string,
    interval: string = "1h",
    limit: number = 24,
  ): Promise<KlineData[]> {
    const normalized = this.toSymbol(symbol);
    const intervalMap: Record<string, string> = {
      "1m": "1",
      "3m": "3",
      "5m": "5",
      "15m": "15",
      "30m": "30",
      "1h": "60",
      "2h": "120",
      "4h": "240",
      "6h": "360",
      "12h": "720",
      "1d": "D",
      "1w": "W",
      "1M": "M",
    };
    const normalizedInterval = intervalMap[interval] || interval;

    const result = await this.publicRequest<BybitKlineResult>(
      "/v5/market/kline",
      {
        category: BYBIT_LINEAR_CATEGORY,
        symbol: normalized,
        interval: normalizedInterval,
        limit,
      },
    );

    return (result.list || [])
      .map((row) => ({
        time: this.parseNumber(row[0]),
        open: this.parseNumber(row[1]),
        high: this.parseNumber(row[2]),
        low: this.parseNumber(row[3]),
        close: this.parseNumber(row[4]),
        volume: this.parseNumber(row[5]),
      }))
      .sort((a, b) => a.time - b.time);
  }

  async getOpenPositions(): Promise<PositionInfo[]> {
    const rows = await this.fetchPositions();

    return rows
      .filter(
        (row) =>
          Boolean(row.symbol) &&
          (row.side === "Buy" || row.side === "Sell") &&
          this.parseNumber(row.size) > 0,
      )
      .map((row) => ({
        symbol: String(row.symbol),
        positionId: `${row.symbol}:${row.positionIdx ?? 0}`,
        side: row.side === "Buy" ? ("LONG" as const) : ("SHORT" as const),
        leverage: Math.max(1, this.parseNumber(row.leverage, 1)),
        marginType: row.tradeMode === 1 ? "isolated" : "cross",
        entryPrice: this.parseNumber(row.avgPrice),
        quantity: this.parseNumber(row.size),
        margin:
          this.parseNumber(row.positionIM) ||
          this.parseNumber(row.positionBalance),
        unrealizedPnl: this.parseNumber(row.unrealisedPnl),
        liquidationPrice: this.parseNumber(row.liqPrice),
        markPrice: this.parseNumber(row.markPrice),
        raw: row,
      }));
  }

  async placeOrder(orderParams: OrderParams): Promise<OrderResult> {
    const symbol = this.toSymbol(orderParams.symbol);

    if (orderParams.leverage) {
      await this.setLeverage(symbol, orderParams.leverage);
    }

    const specs = await this.getInstrumentSpecs(symbol);
    const qty = this.clampToStep(
      orderParams.quantity,
      specs.lotSz,
      specs.qtyDecimals,
    );

    if (qty < specs.minSz) {
      throw new Error(
        `Order quantity too small for ${symbol}: requested=${orderParams.quantity} -> rounded=${qty} < min=${specs.minSz}`,
      );
    }

    const payload: Record<string, string | number | boolean | undefined> = {
      category: BYBIT_LINEAR_CATEGORY,
      symbol,
      side: orderParams.side === "BUY" ? "Buy" : "Sell",
      orderType: orderParams.type === "LIMIT" ? "Limit" : "Market",
      qty: this.formatNum(qty, specs.qtyDecimals),
    };

    if (orderParams.type === "LIMIT") {
      if (!orderParams.price || orderParams.price <= 0) {
        throw new Error("LIMIT order requires a valid price");
      }
      const price = this.clampToStep(
        orderParams.price,
        specs.tickSz,
        specs.priceDecimals,
      );
      payload.price = this.formatNum(price, specs.priceDecimals);
      payload.timeInForce = "GTC";
    }

    const result = await this.signedRequest<BybitCreateOrderResult>(
      "POST",
      "/v5/order/create",
      payload,
    );

    const orderId = result.orderId || result.orderLinkId;
    if (!orderId) {
      throw new Error("[Bybit] Order accepted but no orderId returned");
    }

    return {
      orderId,
      price:
        orderParams.price ||
        (orderParams.type === "MARKET"
          ? await this.getTickerPrice(symbol)
          : 0),
      quantity: qty,
      status: "submitted",
      raw: result,
    };
  }

  async closePosition(
    symbol: string,
    positionId?: string,
    quantity?: number,
  ): Promise<void> {
    const normalized = this.toSymbol(symbol);
    const specs = await this.getInstrumentSpecs(normalized);
    const positions = (await this.fetchPositions(normalized)).filter(
      (row) =>
        row.symbol === normalized &&
        (row.side === "Buy" || row.side === "Sell") &&
        this.parseNumber(row.size) > 0,
    );

    const filtered = positionId
      ? positions.filter(
          (row) => `${row.symbol}:${row.positionIdx ?? 0}` === positionId,
        )
      : positions;

    if (filtered.length === 0) {
      throw new Error(`No open Bybit position found for ${normalized}`);
    }

    let remaining = quantity && quantity > 0 ? quantity : null;

    for (const row of filtered) {
      const currentQty = this.parseNumber(row.size);
      const requestedQty =
        remaining === null ? currentQty : Math.min(currentQty, remaining);
      const closeQty = this.clampToStep(
        requestedQty,
        specs.lotSz,
        specs.qtyDecimals,
      );

      if (closeQty <= 0) continue;

      await this.signedRequest(
        "POST",
        "/v5/order/create",
        {
          category: BYBIT_LINEAR_CATEGORY,
          symbol: normalized,
          side: row.side === "Buy" ? "Sell" : "Buy",
          orderType: "Market",
          qty: this.formatNum(closeQty, specs.qtyDecimals),
          reduceOnly: true,
          closeOnTrigger: true,
          positionIdx: row.positionIdx ?? 0,
        },
      );

      if (remaining !== null) {
        remaining = Math.max(0, remaining - closeQty);
        if (remaining <= 0) break;
      }
    }
  }

  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> {
    const closed: string[] = [];
    const errors: string[] = [];

    try {
      const positions = await this.getOpenPositions();
      for (const position of positions) {
        try {
          await this.closePosition(
            position.symbol,
            position.positionId,
            position.quantity,
          );
          closed.push(`${position.symbol} (${position.side})`);
        } catch (error) {
          errors.push(
            `${position.symbol}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
        }
      }
    } catch (error) {
      errors.push(
        `Failed to fetch positions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }

    return { closed, errors };
  }

  async setLeverage(
    symbol: string,
    leverage: number,
    marginType: "isolated" | "cross" = "isolated",
    _side?: "BUY" | "SELL",
  ): Promise<number> {
    const normalized = this.toSymbol(symbol);
    const requestedLeverage = Math.max(1, Math.floor(leverage));

    try {
      await this.ensureMarginMode(
        normalized,
        requestedLeverage,
        marginType,
      );
      await this.signedRequest(
        "POST",
        "/v5/position/set-leverage",
        {
          category: BYBIT_LINEAR_CATEGORY,
          symbol: normalized,
          buyLeverage: String(requestedLeverage),
          sellLeverage: String(requestedLeverage),
        },
      );
      return requestedLeverage;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not modified")) {
        return requestedLeverage;
      }
      throw error;
    }
  }

  async placeStopLoss(
    symbol: string,
    triggerPrice: number,
    _executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    return this.placeConditionalCloseOrder(
      "sl",
      symbol,
      triggerPrice,
      side,
      quantity,
    );
  }

  async placeTakeProfit(
    symbol: string,
    triggerPrice: number,
    _executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    return this.placeConditionalCloseOrder(
      "tp",
      symbol,
      triggerPrice,
      side,
      quantity,
    );
  }

  async getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const rows = await this.fetchRealtimeOrders("Order", symbol);

    return rows.map((row) => ({
      orderId: String(row.orderId || ""),
      symbol: String(row.symbol || ""),
      side: row.side === "Buy" ? ("BUY" as const) : ("SELL" as const),
      type: String(row.orderType || "unknown"),
      price: this.parseNumber(row.price) || undefined,
      quantity: this.parseNumber(row.qty),
      filledQuantity: this.parseNumber(row.cumExecQty),
      status: String(row.orderStatus || "unknown"),
      createdAt: this.parseNumber(row.createdTime) || undefined,
      raw: row,
    }));
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      await this.signedRequest(
        "POST",
        "/v5/order/cancel",
        {
          category: BYBIT_LINEAR_CATEGORY,
          symbol: this.toSymbol(symbol),
          orderId,
        },
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("order not exists") ||
        message.includes("retCode=110001")
      ) {
        return false;
      }
      throw error;
    }
  }

  async getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> {
    const normalized = symbol ? this.toSymbol(symbol) : undefined;
    const stopOrders = await this.fetchRealtimeOrders("StopOrder", normalized);
    const positionRows = await this.fetchPositions(normalized);
    const algoOrders: AlgoOrderInfo[] = stopOrders.map((row) => ({
      orderId: String(row.orderId || ""),
      symbol: String(row.symbol || ""),
      side: row.side === "Buy" ? ("BUY" as const) : ("SELL" as const),
      type: this.parseAlgoTypeFromOrder(row),
      triggerPrice: this.parseNumber(row.triggerPrice),
      executePrice: this.parseNumber(row.price) || undefined,
      quantity: this.parseNumber(row.qty),
      status: String(row.orderStatus || "unknown"),
      createdAt: this.parseNumber(row.createdTime) || undefined,
      raw: row,
    }));

    for (const position of positionRows) {
      if (!position.symbol || (position.side !== "Buy" && position.side !== "Sell")) {
        continue;
      }
      const qty = this.parseNumber(position.size);
      if (qty <= 0) continue;

      const side = this.getPositionAlgoSide(position.side);
      const positionIdx = position.positionIdx ?? 0;
      const takeProfit = this.parseNumber(position.takeProfit);
      const stopLoss = this.parseNumber(position.stopLoss);

      if (takeProfit > 0) {
        algoOrders.push({
          orderId: `position-tp:${position.symbol}:${positionIdx}`,
          symbol: position.symbol,
          side,
          type: "tp",
          triggerPrice: takeProfit,
          quantity: qty,
          status: "active",
          createdAt: this.parseNumber(position.updatedTime) || undefined,
          raw: position,
        });
      }

      if (stopLoss > 0) {
        algoOrders.push({
          orderId: `position-sl:${position.symbol}:${positionIdx}`,
          symbol: position.symbol,
          side,
          type: "sl",
          triggerPrice: stopLoss,
          quantity: qty,
          status: "active",
          createdAt: this.parseNumber(position.updatedTime) || undefined,
          raw: position,
        });
      }
    }

    return algoOrders;
  }

  async cancelAlgoOrders(
    symbol: string,
  ): Promise<{ cancelled: string[]; errors: string[] }> {
    const normalized = this.toSymbol(symbol);
    const cancelled: string[] = [];
    const errors: string[] = [];

    const stopOrders = await this.fetchRealtimeOrders("StopOrder", normalized);
    for (const order of stopOrders) {
      if (!order.orderId || !order.symbol) continue;
      try {
        const ok = await this.cancelOrder(order.orderId, order.symbol);
        if (ok) {
          cancelled.push(order.orderId);
        } else {
          errors.push(`${order.orderId}: Unknown order`);
        }
      } catch (error) {
        errors.push(
          `${order.orderId}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    const positions = (await this.fetchPositions(normalized)).filter(
      (row) =>
        row.symbol === normalized &&
        (row.side === "Buy" || row.side === "Sell") &&
        this.parseNumber(row.size) > 0,
    );

    for (const position of positions) {
      if (
        this.parseNumber(position.takeProfit) <= 0 &&
        this.parseNumber(position.stopLoss) <= 0
      ) {
        continue;
      }

      try {
        await this.clearTradingStopsForPosition(
          normalized,
          position.positionIdx ?? 0,
        );

        if (this.parseNumber(position.takeProfit) > 0) {
          cancelled.push(
            `position-tp:${normalized}:${position.positionIdx ?? 0}`,
          );
        }
        if (this.parseNumber(position.stopLoss) > 0) {
          cancelled.push(
            `position-sl:${normalized}:${position.positionIdx ?? 0}`,
          );
        }
      } catch (error) {
        errors.push(
          `position:${position.positionIdx ?? 0}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    return { cancelled, errors };
  }

  async getOrderHistory(
    symbol?: string,
    limit: number = 20,
  ): Promise<HistoricalOrder[]> {
    const normalized = symbol ? this.toSymbol(symbol) : undefined;
    const result = await this.signedRequest<BybitOrderListResult>(
      "GET",
      "/v5/order/history",
      {
        category: BYBIT_LINEAR_CATEGORY,
        settleCoin: BYBIT_SETTLE_COIN,
        symbol: normalized,
        limit: Math.max(1, Math.min(limit, 50)),
      },
    );

    return (result.list || []).map((row) => ({
      orderId: String(row.orderId || ""),
      symbol: String(row.symbol || ""),
      side: row.side === "Buy" ? ("BUY" as const) : ("SELL" as const),
      type: String(row.orderType || "unknown"),
      price: this.parseNumber(row.avgPrice) || this.parseNumber(row.price),
      quantity: this.parseNumber(row.qty),
      filledQuantity: this.parseNumber(row.cumExecQty),
      fee: this.parseNumber(row.cumExecFee),
      realizedPnl: this.parseNumber(row.closedPnl) || undefined,
      status: String(row.orderStatus || "unknown"),
      createdAt: this.parseNumber(row.createdTime),
      updatedAt: this.parseNumber(row.updatedTime) || undefined,
      raw: row,
    }));
  }

  async getInstrumentSpecs(symbol: string): Promise<InstrumentSpecs> {
    const normalized = this.toSymbol(symbol);
    const cached = this.specsCache.get(normalized);
    if (cached && Date.now() - cached.ts < SPECS_CACHE_TTL) {
      return cached.specs;
    }

    const result = await this.publicRequest<BybitInstrumentInfoResult>(
      "/v5/market/instruments-info",
      {
        category: BYBIT_LINEAR_CATEGORY,
        symbol: normalized,
      },
    );

    const instrument = result.list?.find((item) => item.symbol === normalized);
    if (!instrument) {
      throw new Error(`Instrument not found on Bybit: ${normalized}`);
    }

    const lotSz = this.parseNumber(instrument.lotSizeFilter?.qtyStep, 1);
    const minSz = this.parseNumber(instrument.lotSizeFilter?.minOrderQty, lotSz);
    const minNotional = this.parseNumber(
      instrument.lotSizeFilter?.minNotionalValue,
      0,
    );
    const tickSz = this.parseNumber(instrument.priceFilter?.tickSize, 0.01);
    const specs: InstrumentSpecs = {
      ctVal: 1,
      lotSz,
      minSz,
      ...(minNotional > 0 ? { minNotional } : {}),
      ctValCcy:
        instrument.baseCoin ||
        normalized.replace(/USDT|USDC|USD$/, ""),
      tickSz,
      qtyDecimals: this.countDecimals(lotSz),
      priceDecimals: this.countDecimals(tickSz),
    };

    this.specsCache.set(normalized, { specs, ts: Date.now() });
    return specs;
  }
}
