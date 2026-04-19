import axios, { AxiosInstance } from "axios";
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

type MetaTraderConfig = {
  baseUrl: string;
  login: string;
  password: string;
  server: string;
  platform?: string;
  bridgeToken?: string;
  simulated?: boolean;
};

type HttpMethod = "GET" | "POST" | "DELETE";

type MetaTraderPositionRow = {
  id?: string | number;
  ticket?: string | number;
  positionId?: string | number;
  symbol?: string;
  side?: string;
  type?: string | number;
  volume?: string | number;
  lots?: string | number;
  quantity?: string | number;
  openPrice?: string | number;
  priceOpen?: string | number;
  currentPrice?: string | number;
  priceCurrent?: string | number;
  profit?: string | number;
  pnl?: string | number;
  swap?: string | number;
  commission?: string | number;
  margin?: string | number;
  leverage?: string | number;
  stopLoss?: string | number;
  sl?: string | number;
  takeProfit?: string | number;
  tp?: string | number;
  createdAt?: string | number;
  time?: string | number;
  [key: string]: unknown;
};

type MetaTraderOrderRow = {
  id?: string | number;
  ticket?: string | number;
  orderId?: string | number;
  symbol?: string;
  side?: string;
  type?: string | number;
  orderType?: string;
  price?: string | number;
  openPrice?: string | number;
  triggerPrice?: string | number;
  stopPrice?: string | number;
  volume?: string | number;
  lots?: string | number;
  quantity?: string | number;
  filledQuantity?: string | number;
  executedQty?: string | number;
  status?: string;
  state?: string;
  createdAt?: string | number;
  time?: string | number;
  fee?: string | number;
  commission?: string | number;
  profit?: string | number;
  pnl?: string | number;
  [key: string]: unknown;
};

type MetaTraderInstrumentRow = {
  symbol?: string;
  contractSize?: string | number;
  ctVal?: string | number;
  lotStep?: string | number;
  lotSz?: string | number;
  minLot?: string | number;
  minSz?: string | number;
  tickSize?: string | number;
  tickSz?: string | number;
  priceDecimals?: string | number;
  qtyDecimals?: string | number;
  baseCurrency?: string;
  profitCurrency?: string;
  [key: string]: unknown;
};

type MetaTraderAccountRow = {
  balance?: string | number;
  equity?: string | number;
  freeMargin?: string | number;
  availableBalance?: string | number;
  marginFree?: string | number;
  profit?: string | number;
  pnl?: string | number;
  currency?: string;
  leverage?: string | number;
  [key: string]: unknown;
};

/**
 * MetaTrader bridge adapter.
 *
 * This adapter is intentionally broker-agnostic. It expects a REST bridge
 * sitting in front of MT4/MT5 and works across any broker/server as long as
 * that bridge exposes the endpoints below.
 *
 * Expected bridge contract:
 * - GET    /account
 * - GET    /ticker?symbol=...
 * - GET    /klines?symbol=...&interval=...&limit=...
 * - GET    /positions?symbol=...
 * - POST   /orders
 * - POST   /positions/close
 * - POST   /positions/close-all
 * - POST   /positions/protection
 * - GET    /orders/open?symbol=...
 * - DELETE /orders/:orderId?symbol=...
 * - GET    /orders/history?symbol=...&limit=...
 * - GET    /instruments/:symbol
 */
export class MetaTraderExchange implements ExchangeClient {
  readonly name = "metatrader";

  private readonly client: AxiosInstance;
  private readonly login: string;
  private readonly password: string;
  private readonly server: string;
  private readonly platform: string;
  private readonly bridgeToken?: string;

  constructor(config: MetaTraderConfig) {
    this.login = config.login.trim();
    this.password = config.password.trim();
    this.server = config.server.trim();
    this.platform = (config.platform || "mt5").trim().toLowerCase();
    this.bridgeToken = config.bridgeToken?.trim() || undefined;
    this.client = axios.create({
      baseURL: config.baseUrl.replace(/\/+$/, ""),
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.client.interceptors.request.use(async (requestConfig) => {
      try {
        const agent = await getProxyAgent();
        if (agent) {
          requestConfig.httpsAgent = agent;
          requestConfig.httpAgent = agent;
        }
      } catch (error) {
        console.warn(
          "[MetaTrader] Proxy agent not available, using direct connection:",
          error instanceof Error ? error.message : error,
        );
      }
      return requestConfig;
    });
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "X-MT-LOGIN": this.login,
      "X-MT-PASSWORD": this.password,
      "X-MT-SERVER": this.server,
      "X-MT-PLATFORM": this.platform,
    };

    if (this.bridgeToken) {
      headers.Authorization = `Bearer ${this.bridgeToken}`;
    }

    return headers;
  }

  private parseNumber(value: unknown, fallback: number = 0): number {
    const parsed =
      typeof value === "number" ? value : parseFloat(String(value || ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseTimestamp(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber)) return asNumber;
      const asDate = Date.parse(value);
      if (!Number.isNaN(asDate)) return asDate;
    }
    return undefined;
  }

  private countDecimals(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const text = value.toString();
    if (!text.includes(".")) return 0;
    const [, frac = ""] = text.split(".");
    return frac.replace(/0+$/, "").length;
  }

  private toSymbol(symbol: string): string {
    return symbol.trim().toUpperCase();
  }

  private normalizeSide(value: unknown): "LONG" | "SHORT" {
    const normalized = String(value || "").trim().toLowerCase();
    if (
      normalized === "sell" ||
      normalized === "short" ||
      normalized === "1" ||
      normalized === "sell_limit" ||
      normalized === "sell_stop"
    ) {
      return "SHORT";
    }
    return "LONG";
  }

  private normalizeOrderSide(value: unknown): "BUY" | "SELL" {
    return this.normalizeSide(value) === "SHORT" ? "SELL" : "BUY";
  }

  private normalizeStatus(value: unknown, fallback: string): string {
    const normalized = String(value || "").trim();
    return normalized || fallback;
  }

  private extractArray<T>(payload: unknown, keys: string[]): T[] {
    if (Array.isArray(payload)) return payload as T[];
    if (!payload || typeof payload !== "object") return [];

    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }

    if ("data" in payload) {
      const data = (payload as Record<string, unknown>).data;
      if (Array.isArray(data)) return data as T[];
    }

    return [];
  }

  private extractObject<T>(payload: unknown, keys: string[]): T {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      for (const key of keys) {
        const value = (payload as Record<string, unknown>)[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return value as T;
        }
      }
      return payload as T;
    }

    return {} as T;
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      data?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    try {
      const response = await this.client.request<T>({
        method,
        url: path,
        params: options.params,
        data: options.data,
        headers: this.buildHeaders(),
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message =
          typeof error.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error.response?.data || {});
        throw new Error(
          `[MetaTrader] ${method} ${path} failed${status ? ` (HTTP ${status})` : ""}: ${
            message || error.message
          }`,
        );
      }
      throw new Error(
        `[MetaTrader] ${method} ${path} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async getPositionsRaw(symbol?: string): Promise<MetaTraderPositionRow[]> {
    const response = await this.request<unknown>("GET", "/positions", {
      params: {
        symbol: symbol ? this.toSymbol(symbol) : undefined,
      },
    });
    return this.extractArray<MetaTraderPositionRow>(response, [
      "positions",
      "result",
      "data",
    ]);
  }

  private mapPosition(row: MetaTraderPositionRow): PositionInfo {
    const symbol = this.toSymbol(String(row.symbol || ""));
    const side = this.normalizeSide(row.side ?? row.type);
    const quantity =
      this.parseNumber(row.quantity) ||
      this.parseNumber(row.volume) ||
      this.parseNumber(row.lots);
    const entryPrice =
      this.parseNumber(row.openPrice) || this.parseNumber(row.priceOpen);
    const currentPrice =
      this.parseNumber(row.currentPrice) || this.parseNumber(row.priceCurrent);
    const pnl = this.parseNumber(row.pnl) || this.parseNumber(row.profit);
    const margin = this.parseNumber(row.margin);
    const leverage = Math.max(1, this.parseNumber(row.leverage, 1));

    return {
      symbol,
      positionId: String(row.positionId || row.ticket || row.id || symbol),
      side,
      leverage,
      marginType: "cross",
      entryPrice,
      quantity,
      margin,
      unrealizedPnl: pnl,
      liquidationPrice: 0,
      markPrice: currentPrice || entryPrice,
      raw: row,
    };
  }

  private mapOpenOrder(row: MetaTraderOrderRow): OpenOrderInfo {
    return {
      orderId: String(row.orderId || row.ticket || row.id || ""),
      symbol: this.toSymbol(String(row.symbol || "")),
      side: this.normalizeOrderSide(row.side ?? row.type),
      type: this.normalizeStatus(row.orderType ?? row.type, "pending"),
      price: this.parseNumber(row.price) || this.parseNumber(row.openPrice) || undefined,
      quantity:
        this.parseNumber(row.quantity) ||
        this.parseNumber(row.volume) ||
        this.parseNumber(row.lots),
      filledQuantity:
        this.parseNumber(row.filledQuantity) ||
        this.parseNumber(row.executedQty),
      status: this.normalizeStatus(row.status ?? row.state, "open"),
      createdAt: this.parseTimestamp(row.createdAt ?? row.time),
      raw: row,
    };
  }

  private mapHistoricalOrder(row: MetaTraderOrderRow): HistoricalOrder {
    const quantity =
      this.parseNumber(row.quantity) ||
      this.parseNumber(row.volume) ||
      this.parseNumber(row.lots);
    return {
      orderId: String(row.orderId || row.ticket || row.id || ""),
      symbol: this.toSymbol(String(row.symbol || "")),
      side: this.normalizeOrderSide(row.side ?? row.type),
      type: this.normalizeStatus(row.orderType ?? row.type, "unknown"),
      price: this.parseNumber(row.price) || this.parseNumber(row.openPrice),
      quantity,
      filledQuantity:
        this.parseNumber(row.filledQuantity) ||
        this.parseNumber(row.executedQty) ||
        quantity,
      fee: this.parseNumber(row.fee) || this.parseNumber(row.commission),
      realizedPnl: this.parseNumber(row.pnl) || this.parseNumber(row.profit),
      status: this.normalizeStatus(row.status ?? row.state, "closed"),
      createdAt: this.parseTimestamp(row.createdAt ?? row.time) || Date.now(),
      updatedAt: this.parseTimestamp(row.createdAt ?? row.time),
      raw: row,
    };
  }

  private async updatePositionProtection(
    symbol: string,
    values: { stopLoss?: number | null; takeProfit?: number | null },
  ): Promise<string> {
    const positions = (await this.getPositionsRaw(symbol)).filter(
      (row) =>
        this.toSymbol(String(row.symbol || "")) === this.toSymbol(symbol) &&
        (this.parseNumber(row.quantity) ||
          this.parseNumber(row.volume) ||
          this.parseNumber(row.lots)) > 0,
    );

    if (positions.length === 0) {
      throw new Error(`No open MetaTrader position found for ${symbol}`);
    }

    const results: string[] = [];

    for (const row of positions) {
      const positionId = String(row.positionId || row.ticket || row.id || "");
      await this.request("POST", "/positions/protection", {
        data: {
          symbol: this.toSymbol(symbol),
          positionId,
          stopLoss:
            typeof values.stopLoss === "number" ? values.stopLoss : values.stopLoss === null ? null : undefined,
          takeProfit:
            typeof values.takeProfit === "number"
              ? values.takeProfit
              : values.takeProfit === null
                ? null
                : undefined,
        },
      });
      results.push(positionId || this.toSymbol(symbol));
    }

    return results.join(",");
  }

  private async clearSyntheticProtectionOrder(
    orderId: string,
    symbol: string,
  ): Promise<boolean> {
    if (!orderId.startsWith("mt-sl:") && !orderId.startsWith("mt-tp:")) {
      return false;
    }

    const [prefix, positionId] = orderId.split(":", 2);
    if (!positionId) return false;

    await this.request("POST", "/positions/protection", {
      data: {
        symbol: this.toSymbol(symbol),
        positionId,
        stopLoss: prefix === "mt-sl" ? null : undefined,
        takeProfit: prefix === "mt-tp" ? null : undefined,
      },
    });

    return true;
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const response = await this.request<unknown>("GET", "/account");
    const account = this.extractObject<MetaTraderAccountRow>(response, [
      "account",
      "result",
      "data",
    ]);

    const totalBalance =
      this.parseNumber(account.equity) || this.parseNumber(account.balance);
    const availableBalance =
      this.parseNumber(account.availableBalance) ||
      this.parseNumber(account.freeMargin) ||
      this.parseNumber(account.marginFree) ||
      this.parseNumber(account.balance);

    return {
      totalBalance,
      availableBalance,
      unrealizedPnl:
        this.parseNumber(account.pnl) || this.parseNumber(account.profit),
      currency: String(account.currency || "USD"),
    };
  }

  async getTickerPrice(symbol: string): Promise<number> {
    const response = await this.request<unknown>("GET", "/ticker", {
      params: { symbol: this.toSymbol(symbol) },
    });
    const ticker = this.extractObject<Record<string, unknown>>(response, [
      "ticker",
      "result",
      "data",
    ]);
    const price =
      this.parseNumber(ticker.price) ||
      this.parseNumber(ticker.bid) ||
      this.parseNumber(ticker.ask) ||
      this.parseNumber(ticker.last);

    if (!price) {
      throw new Error(`Ticker not found on MetaTrader bridge for ${symbol}`);
    }

    return price;
  }

  async getKlines(
    symbol: string,
    interval: string = "1h",
    limit: number = 24,
  ): Promise<KlineData[]> {
    const response = await this.request<unknown>("GET", "/klines", {
      params: {
        symbol: this.toSymbol(symbol),
        interval,
        limit,
      },
    });
    const rows = this.extractArray<Record<string, unknown>>(response, [
      "klines",
      "candles",
      "result",
      "data",
    ]);

    return rows.map((row) => ({
      time:
        this.parseTimestamp(row.time) ||
        this.parseTimestamp(row.timestamp) ||
        Date.now(),
      open: this.parseNumber(row.open),
      high: this.parseNumber(row.high),
      low: this.parseNumber(row.low),
      close: this.parseNumber(row.close),
      volume: this.parseNumber(row.volume),
    }));
  }

  async getOpenPositions(): Promise<PositionInfo[]> {
    const rows = await this.getPositionsRaw();
    return rows.map((row) => this.mapPosition(row));
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const response = await this.request<unknown>("POST", "/orders", {
      data: {
        symbol: this.toSymbol(params.symbol),
        side: params.side,
        type: params.type,
        quantity: params.quantity,
        price: params.price,
        leverage: params.leverage,
        stopLossPrice: params.stopLossPrice,
        takeProfitPrice: params.takeProfitPrice,
      },
    });
    const order = this.extractObject<Record<string, unknown>>(response, [
      "order",
      "result",
      "data",
    ]);

    return {
      orderId: String(order.orderId || order.ticket || order.id || ""),
      price: this.parseNumber(order.price) || params.price || 0,
      quantity:
        this.parseNumber(order.quantity) ||
        this.parseNumber(order.volume) ||
        params.quantity,
      status: this.normalizeStatus(order.status, "submitted"),
      raw: order,
    };
  }

  async closePosition(
    symbol: string,
    positionId?: string,
    quantity?: number,
  ): Promise<void> {
    await this.request("POST", "/positions/close", {
      data: {
        symbol: this.toSymbol(symbol),
        positionId,
        quantity,
      },
    });
  }

  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> {
    try {
      const positions = await this.getOpenPositions();
      await this.request("POST", "/positions/close-all");
      return {
        closed: positions.map((position) => `${position.symbol} (${position.side})`),
        errors: [],
      };
    } catch (error) {
      return {
        closed: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async setLeverage(
    symbol: string,
    leverage: number,
  ): Promise<number> {
    try {
      await this.request("POST", "/account/leverage", {
        data: {
          symbol: this.toSymbol(symbol),
          leverage,
        },
      });
    } catch {
      // MetaTrader leverage is typically account-level and often not mutable
      // per-symbol from the client side. Treat this as best-effort.
    }
    return leverage;
  }

  async placeStopLoss(
    symbol: string,
    triggerPrice: number,
    _executePrice: number,
    _side: "BUY" | "SELL",
    _quantity: number,
  ): Promise<string> {
    return this.updatePositionProtection(symbol, { stopLoss: triggerPrice });
  }

  async placeTakeProfit(
    symbol: string,
    triggerPrice: number,
    _executePrice: number,
    _side: "BUY" | "SELL",
    _quantity: number,
  ): Promise<string> {
    return this.updatePositionProtection(symbol, { takeProfit: triggerPrice });
  }

  async getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const response = await this.request<unknown>("GET", "/orders/open", {
      params: {
        symbol: symbol ? this.toSymbol(symbol) : undefined,
      },
    });
    const rows = this.extractArray<MetaTraderOrderRow>(response, [
      "orders",
      "result",
      "data",
    ]);
    return rows.map((row) => this.mapOpenOrder(row));
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      const handledSynthetic = await this.clearSyntheticProtectionOrder(
        orderId,
        symbol,
      );
      if (handledSynthetic) return true;

      await this.request("DELETE", `/orders/${encodeURIComponent(orderId)}`, {
        params: {
          symbol: this.toSymbol(symbol),
        },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) {
        return false;
      }
      throw error;
    }
  }

  async getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> {
    const positions = await this.getPositionsRaw(symbol);
    const orders: AlgoOrderInfo[] = [];

    for (const row of positions) {
      const normalizedSymbol = this.toSymbol(String(row.symbol || ""));
      const positionId = String(row.positionId || row.ticket || row.id || normalizedSymbol);
      const quantity =
        this.parseNumber(row.quantity) ||
        this.parseNumber(row.volume) ||
        this.parseNumber(row.lots);
      const side = this.normalizeSide(row.side ?? row.type) === "LONG"
        ? ("SELL" as const)
        : ("BUY" as const);
      const stopLoss = this.parseNumber(row.stopLoss) || this.parseNumber(row.sl);
      const takeProfit =
        this.parseNumber(row.takeProfit) || this.parseNumber(row.tp);

      if (stopLoss > 0) {
        orders.push({
          orderId: `mt-sl:${positionId}`,
          symbol: normalizedSymbol,
          side,
          type: "sl",
          triggerPrice: stopLoss,
          quantity,
          status: "active",
          createdAt: this.parseTimestamp(row.createdAt ?? row.time),
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
          createdAt: this.parseTimestamp(row.createdAt ?? row.time),
          raw: row,
        });
      }
    }

    return orders;
  }

  async cancelAlgoOrders(
    symbol: string,
  ): Promise<{ cancelled: string[]; errors: string[] }> {
    try {
      const positions = await this.getPositionsRaw(symbol);
      const cancelled: string[] = [];

      for (const row of positions) {
        const positionId = String(row.positionId || row.ticket || row.id || "");
        if (
          this.parseNumber(row.stopLoss) > 0 ||
          this.parseNumber(row.sl) > 0 ||
          this.parseNumber(row.takeProfit) > 0 ||
          this.parseNumber(row.tp) > 0
        ) {
          await this.request("POST", "/positions/protection", {
            data: {
              symbol: this.toSymbol(symbol),
              positionId,
              stopLoss: null,
              takeProfit: null,
            },
          });
          cancelled.push(positionId || this.toSymbol(symbol));
        }
      }

      return { cancelled, errors: [] };
    } catch (error) {
      return {
        cancelled: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async getOrderHistory(
    symbol?: string,
    limit: number = 20,
  ): Promise<HistoricalOrder[]> {
    const response = await this.request<unknown>("GET", "/orders/history", {
      params: {
        symbol: symbol ? this.toSymbol(symbol) : undefined,
        limit,
      },
    });
    const rows = this.extractArray<MetaTraderOrderRow>(response, [
      "orders",
      "result",
      "data",
    ]);
    return rows.map((row) => this.mapHistoricalOrder(row));
  }

  async getInstrumentSpecs(symbol: string): Promise<InstrumentSpecs> {
    const response = await this.request<unknown>(
      "GET",
      `/instruments/${encodeURIComponent(this.toSymbol(symbol))}`,
    );
    const instrument = this.extractObject<MetaTraderInstrumentRow>(response, [
      "instrument",
      "result",
      "data",
    ]);

    const lotSz =
      this.parseNumber(instrument.lotStep) || this.parseNumber(instrument.lotSz) || 0.01;
    const minSz =
      this.parseNumber(instrument.minLot) || this.parseNumber(instrument.minSz) || lotSz;
    const tickSz =
      this.parseNumber(instrument.tickSize) || this.parseNumber(instrument.tickSz) || 0.00001;
    const ctVal =
      this.parseNumber(instrument.contractSize) || this.parseNumber(instrument.ctVal) || 1;

    return {
      ctVal,
      lotSz,
      minSz,
      ctValCcy:
        instrument.baseCurrency ||
        instrument.profitCurrency ||
        this.toSymbol(symbol).slice(0, 3),
      tickSz,
      qtyDecimals:
        this.parseNumber(instrument.qtyDecimals) || this.countDecimals(lotSz),
      priceDecimals:
        this.parseNumber(instrument.priceDecimals) || this.countDecimals(tickSz),
    };
  }
}
