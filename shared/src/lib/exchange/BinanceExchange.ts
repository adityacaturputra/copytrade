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

function getBinanceBaseUrl(simulated: boolean): string {
  return (
    process.env.BINANCE_PROXY_URL ||
    (simulated
      ? process.env.BINANCE_TESTNET_BASE_URL ||
        "https://testnet.binancefuture.com"
      : process.env.BINANCE_BASE_URL || "https://fapi.binance.com")
  );
}

const SPECS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

type HttpMethod = "GET" | "POST" | "DELETE";

interface BinancePositionRisk {
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
}

interface BinanceOrder {
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  stopPrice?: string;
  avgPrice?: string;
  time?: number;
  updateTime?: number;
  [key: string]: unknown;
}

interface BinanceAlgoOrder {
  algoId?: number | string;
  clientAlgoId?: string;
  symbol?: string;
  side?: "BUY" | "SELL";
  type?: string;
  orderType?: string;
  stopPrice?: string;
  triggerPrice?: string;
  price?: string;
  executePrice?: string;
  quantity?: string;
  origQty?: string;
  executedQty?: string;
  algoStatus?: string;
  status?: string;
  time?: number;
  updateTime?: number;
  [key: string]: unknown;
}

interface BinanceInstrumentSpecs extends InstrumentSpecs {
  marketLotSz: number;
  marketMinSz: number;
  marketQtyDecimals: number;
}

interface BinanceLeverageBracket {
  symbol?: string;
  brackets?: Array<{
    initialLeverage?: number | string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * Binance USD-M Futures exchange adapter.
 *
 * Uses Binance Futures REST API (`/fapi/*`).
 * Symbol format is normalized to `BTCUSDT`, `RENDERUSDT`, etc.
 */
export class BinanceExchange implements ExchangeClient {
  readonly name = "binance";

  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly client: AxiosInstance;
  private readonly specsCache = new Map<
    string,
    { specs: BinanceInstrumentSpecs; ts: number }
  >();

  constructor(apiKey: string, secretKey: string, simulated: boolean = false) {
    this.apiKey = apiKey.trim();
    this.secretKey = secretKey.trim();
    this.client = axios.create({
      baseURL: getBinanceBaseUrl(simulated),
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // ─── Proxy: attach httpsProxyAgent for Webshare static IP ────────
    this.client.interceptors.request.use(async (config) => {
      try {
        const agent = await getProxyAgent();
        if (agent) {
          config.httpsAgent = agent;
          config.httpAgent = agent;
        }
      } catch (err) {
        console.warn(
          "[Binance] ⚠️ Proxy agent not available, using direct connection:",
          err instanceof Error ? err.message : err,
        );
      }
      return config;
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private toSymbol(symbol: string): string {
    return symbol.replace(/[-_/]/g, "").toUpperCase();
  }

  private toMarginType(marginType: "isolated" | "cross"): "ISOLATED" | "CROSSED" {
    return marginType === "isolated" ? "ISOLATED" : "CROSSED";
  }

  private sign(query: string): string {
    return CryptoJS.HmacSHA256(query, this.secretKey).toString(
      CryptoJS.enc.Hex,
    );
  }

  private buildSignedQuery(
    params: Record<string, string | number | boolean | undefined>,
  ): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      search.append(key, String(value));
    }
    search.append("timestamp", String(Date.now()));
    search.append("recvWindow", "10000");

    const query = search.toString();
    const signature = this.sign(query);
    search.append("signature", signature);
    return search.toString();
  }

  private sanitizeParamsForLog(
    params: Record<string, string | number | boolean | undefined>,
  ): Record<string, string | number | boolean> {
    const sanitized: Record<string, string | number | boolean> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      sanitized[key] =
        key.toLowerCase() === "signature" ? "[redacted]" : value;
    }

    return sanitized;
  }

  private logSignedRequestError(
    error: unknown,
    method: HttpMethod,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): void {
    const payload = JSON.stringify(this.sanitizeParamsForLog(params));

    if (this.isIgnorableMarginTypeError(error, path)) {
      console.info(
        `[Binance] ℹ️ ${method} ${path} skipped\n` +
          `       ➡️ Payload: ${payload}\n` +
          `       ⬅️ Response: margin type already set`,
      );
      return;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const responseBody =
        error.response?.data !== undefined
          ? JSON.stringify(error.response.data)
          : error.message;
      console.error(
        `[Binance] ❌ ${method} ${path}${status ? ` — HTTP ${status}` : ""}\n` +
          `       ➡️ Payload: ${payload}\n` +
          `       ⬅️ Response: ${responseBody}`,
      );
      return;
    }

    console.error(
      `[Binance] ❌ ${method} ${path}\n` +
        `       ➡️ Payload: ${payload}\n` +
        `       ⬅️ Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private isIgnorableMarginTypeError(error: unknown, path: string): boolean {
    if (path !== "/fapi/v1/marginType") return false;

    const responseData =
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: unknown }).response === "object" &&
      (error as { response?: unknown }).response !== null &&
      "data" in ((error as { response?: { data?: unknown } }).response || {})
        ? ((error as { response?: { data?: unknown } }).response?.data as
            | { code?: number; msg?: string }
            | undefined)
        : undefined;

    if (
      responseData?.code === -4046 ||
      responseData?.msg === "No need to change margin type."
    ) {
      return true;
    }

    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { code?: number; msg?: string };
      return (
        data?.code === -4046 ||
        data?.msg === "No need to change margin type."
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("code=-4046") ||
      message.includes("No need to change margin type")
    );
  }

  private async signedRequest<T>(
    method: HttpMethod,
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const query = this.buildSignedQuery(params);
    const url = `${path}?${query}`;
    try {
      const response = await this.client.request<T>({
        method,
        url,
        headers: { "X-MBX-APIKEY": this.apiKey },
      });
      return response.data;
    } catch (error) {
      this.logSignedRequestError(error, method, path, params);
      throw this.normalizeError(error, `${method} ${path}`, params);
    }
  }

  private async publicRequest<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    try {
      const response = await this.client.get<T>(path, { params });
      return response.data;
    } catch (error) {
      throw this.normalizeError(error, `GET ${path}`);
    }
  }

  private normalizeError(
    error: unknown,
    context: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Error {
    return new Error(
      buildHttpErrorMessage(`[Binance] ${context} failed`, error, {
        payload: params ? this.sanitizeParamsForLog(params) : undefined,
      }),
    );
  }

  private countDecimals(value: number): number {
    if (!isFinite(value)) return 0;
    const text = value.toString();
    if (text.includes("e-")) {
      const [_, exp] = text.split("e-");
      return parseInt(exp || "0", 10);
    }
    const [_, frac = ""] = text.split(".");
    return frac.replace(/0+$/, "").length;
  }

  private precisionFromStepString(value?: string): number | undefined {
    if (!value) return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (!normalized.includes(".")) return 0;
    const [_, frac = ""] = normalized.split(".");
    return frac.replace(/0+$/, "").length;
  }

  private clampToStep(value: number, step: number, decimals: number): number {
    const units = Math.floor(value / step + 1e-12);
    return Number((units * step).toFixed(decimals));
  }

  private formatNum(value: number, decimals: number): string {
    return value.toFixed(decimals);
  }

  private async getMaxAllowedLeverage(symbol: string): Promise<number | null> {
    try {
      const response = await this.signedRequest<
        BinanceLeverageBracket | BinanceLeverageBracket[]
      >("GET", "/fapi/v1/leverageBracket", {
        symbol,
      });

      const rows = Array.isArray(response) ? response : [response];
      const row =
        rows.find((item) => this.toSymbol(item.symbol || "") === symbol) || rows[0];
      const maxLeverage =
        row?.brackets?.reduce((max, bracket) => {
          const value = Number(bracket.initialLeverage || 0);
          return Number.isFinite(value) ? Math.max(max, value) : max;
        }, 0) || 0;

      return maxLeverage > 0 ? Math.floor(maxLeverage) : null;
    } catch (error) {
      console.warn(
        `[Binance] Failed to fetch leverage bracket for ${symbol}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async applyLeverage(symbol: string, leverage: number): Promise<number> {
    await this.signedRequest("POST", "/fapi/v1/leverage", {
      symbol,
      leverage,
    });
    return leverage;
  }

  private isAlgoOrderType(type: string): boolean {
    return [
      "STOP",
      "STOP_MARKET",
      "TAKE_PROFIT",
      "TAKE_PROFIT_MARKET",
      "TRAILING_STOP_MARKET",
    ].includes(type);
  }

  private parseAlgoType(type: string): "tp" | "sl" | "conditional" {
    if (type.includes("TAKE_PROFIT")) return "tp";
    if (type.includes("STOP")) return "sl";
    return "conditional";
  }

  private parseAlgoOrderId(order: BinanceAlgoOrder): string | null {
    const value = order.algoId ?? order.clientAlgoId;
    if (value === undefined || value === null || value === "") {
      return null;
    }
    return String(value);
  }

  private getQuantityRule(
    specs: BinanceInstrumentSpecs,
    orderType: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET",
  ): { step: number; min: number; decimals: number } {
    if (orderType === "MARKET" || orderType.endsWith("_MARKET")) {
      return {
        step: specs.marketLotSz,
        min: specs.marketMinSz,
        decimals: specs.marketQtyDecimals,
      };
    }
    return {
      step: specs.lotSz,
      min: specs.minSz,
      decimals: specs.qtyDecimals,
    };
  }

  private pickPrecision(
    explicitPrecision: number | undefined,
    rawStep: string | undefined,
    numericStep: number,
  ): number {
    const fromString = this.precisionFromStepString(rawStep);
    if (fromString !== undefined) {
      return fromString;
    }
    if (explicitPrecision !== undefined) {
      return explicitPrecision;
    }
    return this.countDecimals(numericStep);
  }

  private async placeConditionalAlgoOrder(
    symbol: string,
    side: "BUY" | "SELL",
    type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
    stopPrice: number,
    quantity: number,
  ): Promise<string> {
    const specs = await this.getInstrumentSpecs(symbol);
    const qtyRule = this.getQuantityRule(specs, type);
    const qty = this.clampToStep(quantity, qtyRule.step, qtyRule.decimals);
    const trigger = this.clampToStep(
      stopPrice,
      specs.tickSz,
      specs.priceDecimals,
    );

    const response = await this.signedRequest<BinanceAlgoOrder>(
      "POST",
      "/fapi/v1/algoOrder",
      {
        algoType: "CONDITIONAL",
        symbol,
        side,
        type,
        triggerPrice: this.formatNum(trigger, specs.priceDecimals),
        quantity: this.formatNum(qty, qtyRule.decimals),
        reduceOnly: true,
        workingType: "MARK_PRICE",
        priceProtect: true,
      },
    );

    const algoId = this.parseAlgoOrderId(response);
    if (!algoId) {
      throw new Error("[Binance] Conditional order accepted but no algoId returned");
    }
    return algoId;
  }

  private async getLegacyAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> {
    const openOrders = await this.getOpenOrders(symbol);

    return openOrders
      .filter((o) => this.isAlgoOrderType(o.type))
      .map((o) => {
        const raw = (o.raw || {}) as BinanceOrder;
        const triggerPrice = parseFloat(raw.stopPrice || "0");
        return {
          orderId: o.orderId,
          symbol: o.symbol,
          side: o.side,
          type: this.parseAlgoType(o.type),
          triggerPrice,
          executePrice: o.price,
          quantity: o.quantity,
          status: o.status,
          createdAt: raw.updateTime || o.createdAt,
          raw: o.raw,
        };
      });
  }

  // ─── Account ──────────────────────────────────────────────────────

  async getAccountInfo(): Promise<AccountInfo> {
    const account = await this.signedRequest<{
      totalWalletBalance?: string;
      availableBalance?: string;
      totalUnrealizedProfit?: string;
    }>("GET", "/fapi/v2/account");

    return {
      totalBalance: parseFloat(account.totalWalletBalance || "0"),
      availableBalance: parseFloat(account.availableBalance || "0"),
      unrealizedPnl: parseFloat(account.totalUnrealizedProfit || "0"),
      currency: "USDT",
    };
  }

  // ─── Market Data ───────────────────────────────────────────────────

  async getTickerPrice(symbol: string): Promise<number> {
    const normalized = this.toSymbol(symbol);
    const ticker = await this.publicRequest<{ symbol: string; price: string }>(
      "/fapi/v1/ticker/price",
      { symbol: normalized },
    );
    return parseFloat(ticker.price);
  }

  async getKlines(
    symbol: string,
    interval: string = "1h",
    limit: number = 24,
  ): Promise<KlineData[]> {
    const normalized = this.toSymbol(symbol);
    const rows = await this.publicRequest<Array<[number, string, string, string, string, string]>>(
      "/fapi/v1/klines",
      { symbol: normalized, interval, limit },
    );

    return rows.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  // ─── Positions ─────────────────────────────────────────────────────

  async getOpenPositions(): Promise<PositionInfo[]> {
    const rows = await this.signedRequest<BinancePositionRisk[]>(
      "GET",
      "/fapi/v2/positionRisk",
    );

    return rows
      .filter((row) => Math.abs(parseFloat(row.positionAmt || "0")) > 0)
      .map((row) => {
        const amt = parseFloat(row.positionAmt || "0");
        const side = amt > 0 ? ("LONG" as const) : ("SHORT" as const);
        const qtyAbs = Math.abs(amt);
        const leverage = Math.max(1, parseInt(row.leverage || "1", 10));
        const margin = row.isolated
          ? parseFloat(row.isolatedWallet || "0")
          : parseFloat(row.initialMargin || "0");
        const positionSide = row.positionSide || "BOTH";

        return {
          symbol: row.symbol,
          positionId: `${row.symbol}:${positionSide}`,
          side,
          leverage,
          marginType: row.isolated ? "isolated" : "cross",
          entryPrice: parseFloat(row.entryPrice || "0"),
          quantity: qtyAbs,
          margin,
          unrealizedPnl: parseFloat(row.unRealizedProfit || "0"),
          liquidationPrice: parseFloat(row.liquidationPrice || "0"),
          markPrice: parseFloat(row.markPrice || "0"),
          raw: row,
        };
      });
  }

  // ─── Leverage ──────────────────────────────────────────────────────

  async setLeverage(
    symbol: string,
    leverage: number,
    marginType: "isolated" | "cross" = "isolated",
    _side?: "BUY" | "SELL",
  ): Promise<number> {
    const normalized = this.toSymbol(symbol);
    const requestedLeverage = Math.max(1, Math.min(125, Math.floor(leverage)));

    // Margin type is optional. Ignore "no need to change" errors.
    try {
      await this.signedRequest("POST", "/fapi/v1/marginType", {
        symbol: normalized,
        marginType: this.toMarginType(marginType),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("No need to change margin type") ||
        msg.includes("code=-4046")
      ) {
        // expected if already set
      } else {
        console.warn(
          `[Binance] Failed to set margin type for ${normalized}: ${msg}`,
        );
      }
    }

    try {
      return await this.applyLeverage(normalized, requestedLeverage);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      let fallbackLeverage: number | null = null;

      if (msg.includes("code=-4300") && requestedLeverage > 20) {
        fallbackLeverage = 20;
      } else if (msg.includes("code=-4028")) {
        const maxAllowed = await this.getMaxAllowedLeverage(normalized);
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
        return await this.applyLeverage(normalized, fallbackLeverage);
      }

      throw error;
    }
  }

  // ─── Orders ────────────────────────────────────────────────────────

  async placeOrder(orderParams: OrderParams): Promise<OrderResult> {
    const symbol = this.toSymbol(orderParams.symbol);

    if (orderParams.leverage) {
      await this.setLeverage(symbol, orderParams.leverage);
    }

    const specs = await this.getInstrumentSpecs(symbol);
    const type = orderParams.type === "LIMIT" ? "LIMIT" : "MARKET";
    const qtyRule = this.getQuantityRule(specs, type);
    const qty = this.clampToStep(
      orderParams.quantity,
      qtyRule.step,
      qtyRule.decimals,
    );
    if (qty < qtyRule.min) {
      throw new Error(
        `Order quantity too small for ${symbol}: ${qty} < ${qtyRule.min}`,
      );
    }

    const params: Record<string, string | number | boolean | undefined> = {
      symbol,
      side: orderParams.side,
      type,
      quantity: this.formatNum(qty, qtyRule.decimals),
      newOrderRespType: "RESULT",
    };

    if (type === "LIMIT") {
      if (!orderParams.price || orderParams.price <= 0) {
        throw new Error("LIMIT order requires a valid price");
      }
      const price = this.clampToStep(
        orderParams.price,
        specs.tickSz,
        specs.priceDecimals,
      );
      params.price = this.formatNum(price, specs.priceDecimals);
      params.timeInForce = "GTC";
    }

    const order = await this.signedRequest<{
      orderId: number;
      status: string;
      avgPrice?: string;
      price?: string;
      origQty?: string;
      executedQty?: string;
    }>("POST", "/fapi/v1/order", params);

    const orderPrice =
      parseFloat(order.avgPrice || "0") ||
      parseFloat(order.price || "0") ||
      orderParams.price ||
      (await this.getTickerPrice(symbol));
    const filledQty =
      parseFloat(order.executedQty || "0") ||
      parseFloat(order.origQty || "0") ||
      qty;

    return {
      orderId: String(order.orderId),
      price: orderPrice,
      quantity: filledQty,
      status: order.status || "NEW",
      raw: order,
    };
  }

  async closePosition(
    symbol: string,
    positionId?: string,
    quantity?: number,
  ): Promise<void> {
    const normalized = this.toSymbol(symbol);
    const specs = await this.getInstrumentSpecs(normalized);
    const risks = await this.signedRequest<BinancePositionRisk[]>(
      "GET",
      "/fapi/v2/positionRisk",
      { symbol: normalized },
    );

    let rows = risks.filter(
      (r) => Math.abs(parseFloat(r.positionAmt || "0")) > 0 && r.symbol === normalized,
    );
    if (positionId?.includes(":")) {
      const desiredPositionSide = positionId.split(":")[1];
      rows = rows.filter((r) => (r.positionSide || "BOTH") === desiredPositionSide);
    }

    if (rows.length === 0) {
      throw new Error(`No open Binance position found for ${normalized}`);
    }

    let remaining = quantity && quantity > 0 ? quantity : null;

    for (const row of rows) {
      const amt = Math.abs(parseFloat(row.positionAmt || "0"));
      if (amt <= 0) continue;

      const closeQtyRaw = remaining === null ? amt : Math.min(remaining, amt);
      const qtyRule = this.getQuantityRule(specs, "MARKET");
      const closeQty = this.clampToStep(
        closeQtyRaw,
        qtyRule.step,
        qtyRule.decimals,
      );
      if (closeQty <= 0) continue;

      const side = parseFloat(row.positionAmt) > 0 ? "SELL" : "BUY";
      const positionSide = row.positionSide || "BOTH";

      const params: Record<string, string | number | boolean | undefined> = {
        symbol: normalized,
        side,
        type: "MARKET",
        quantity: this.formatNum(closeQty, qtyRule.decimals),
        reduceOnly: true,
        newOrderRespType: "RESULT",
      };
      if (positionSide !== "BOTH") {
        params.positionSide = positionSide;
      }

      await this.signedRequest("POST", "/fapi/v1/order", params);

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
      for (const pos of positions) {
        try {
          await this.closePosition(pos.symbol, pos.positionId);
          closed.push(`${pos.symbol} (${pos.side})`);
        } catch (error) {
          errors.push(
            `${pos.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
    } catch (error) {
      errors.push(
        `Failed to fetch positions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return { closed, errors };
  }

  // ─── Stop Loss / Take Profit ───────────────────────────────────────

  async placeStopLoss(
    symbol: string,
    triggerPrice: number,
    _executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    const normalized = this.toSymbol(symbol);
    return this.placeConditionalAlgoOrder(
      normalized,
      side,
      "STOP_MARKET",
      triggerPrice,
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
    const normalized = this.toSymbol(symbol);
    return this.placeConditionalAlgoOrder(
      normalized,
      side,
      "TAKE_PROFIT_MARKET",
      triggerPrice,
      quantity,
    );
  }

  // ─── Order Management ──────────────────────────────────────────────

  async getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const normalized = symbol ? this.toSymbol(symbol) : undefined;
    const rows = await this.signedRequest<BinanceOrder[]>(
      "GET",
      "/fapi/v1/openOrders",
      normalized ? { symbol: normalized } : {},
    );

    return rows.map((o) => ({
      orderId: String(o.orderId),
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      price: parseFloat(o.price || "0") || undefined,
      quantity: parseFloat(o.origQty || "0"),
      filledQuantity: parseFloat(o.executedQty || "0"),
      status: o.status,
      createdAt: o.time,
      raw: o,
    }));
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const normalized = this.toSymbol(symbol);
    try {
      await this.signedRequest("DELETE", "/fapi/v1/order", {
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

  async getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> {
    const normalized = symbol ? this.toSymbol(symbol) : undefined;

    try {
      const rows = await this.signedRequest<BinanceAlgoOrder[]>(
        "GET",
        "/fapi/v1/openAlgoOrders",
        normalized
          ? { symbol: normalized, algoType: "CONDITIONAL" }
          : { algoType: "CONDITIONAL" },
      );

      const mapped: Array<AlgoOrderInfo | null> = rows.map((row) => {
        const orderId = this.parseAlgoOrderId(row);
        if (!orderId || !row.symbol || !row.side) {
          return null;
        }

        const rawType = String(row.type || row.orderType || "");
        const triggerPrice = parseFloat(
          row.triggerPrice || row.stopPrice || "0",
        );
        const executePrice = parseFloat(
          row.executePrice || row.price || "0",
        );
        const quantity = parseFloat(row.quantity || row.origQty || "0");

        return {
          orderId,
          symbol: row.symbol,
          side: row.side,
          type: this.parseAlgoType(rawType),
          triggerPrice,
          executePrice: executePrice || undefined,
          quantity,
          status: String(row.algoStatus || row.status || "NEW"),
          createdAt: row.updateTime || row.time,
          raw: row,
        } satisfies AlgoOrderInfo;
      });

      return mapped.filter((row): row is AlgoOrderInfo => row !== null);
    } catch (error) {
      console.warn(
        `[Binance] Falling back to legacy algo-order discovery for ${normalized || "all symbols"}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.getLegacyAlgoOrders(normalized);
    }
  }

  async cancelAlgoOrders(
    symbol: string,
  ): Promise<{ cancelled: string[]; errors: string[] }> {
    const cancelled: string[] = [];
    const errors: string[] = [];
    const normalized = this.toSymbol(symbol);
    const algoOrders = await this.getAlgoOrders(normalized);

    if (algoOrders.length === 0) {
      return { cancelled, errors };
    }

    for (const order of algoOrders) {
      cancelled.push(order.orderId);
    }

    try {
      await this.signedRequest("DELETE", "/fapi/v1/algoOpenOrders", {
        symbol: normalized,
      });
      return { cancelled, errors };
    } catch (bulkError) {
      cancelled.length = 0;

      for (const order of algoOrders) {
        try {
          await this.signedRequest("DELETE", "/fapi/v1/algoOrder", {
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
        errors.push(
          bulkError instanceof Error ? bulkError.message : "Unknown error",
        );
      }
    }

    return { cancelled, errors };
  }

  async getOrderHistory(
    symbol?: string,
    limit: number = 20,
  ): Promise<HistoricalOrder[]> {
    const symbolsToQuery = symbol
      ? [this.toSymbol(symbol)]
      : Array.from(
          new Set((await this.getOpenPositions()).map((p) => this.toSymbol(p.symbol))),
        );

    if (symbolsToQuery.length === 0) {
      return [];
    }

    const results: HistoricalOrder[] = [];

    for (const sym of symbolsToQuery) {
      const orders = await this.signedRequest<BinanceOrder[]>(
        "GET",
        "/fapi/v1/allOrders",
        { symbol: sym, limit },
      );

      for (const o of orders) {
        results.push({
          orderId: String(o.orderId),
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          price: parseFloat(o.avgPrice || "0") || parseFloat(o.price || "0"),
          quantity: parseFloat(o.origQty || "0"),
          filledQuantity: parseFloat(o.executedQty || "0"),
          fee: 0, // Binance fee data is not included in allOrders response
          status: o.status,
          createdAt: o.time || 0,
          updatedAt: o.updateTime,
          raw: o,
        });
      }
    }

    results.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    return results.slice(0, limit);
  }

  // ─── Instrument Specs ──────────────────────────────────────────────

  async getInstrumentSpecs(symbol: string): Promise<BinanceInstrumentSpecs> {
    const normalized = this.toSymbol(symbol);
    const cached = this.specsCache.get(normalized);
    if (cached && Date.now() - cached.ts < SPECS_CACHE_TTL) {
      return cached.specs;
    }

    const data = await this.publicRequest<{
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
    const marketLotFilter = row.filters.find(
      (f) => f.filterType === "MARKET_LOT_SIZE",
    );
    const priceFilter = row.filters.find((f) => f.filterType === "PRICE_FILTER");

    const lotSz = parseFloat(lotFilter?.stepSize || "1");
    const minSz = parseFloat(lotFilter?.minQty || "1");
    const marketLotSz = parseFloat(marketLotFilter?.stepSize || lotFilter?.stepSize || "1");
    const marketMinSz = parseFloat(marketLotFilter?.minQty || lotFilter?.minQty || "1");
    const tickSz = parseFloat(priceFilter?.tickSize || "0.01");
    const qtyDecimals = this.pickPrecision(
      row.quantityPrecision,
      lotFilter?.stepSize,
      lotSz,
    );
    const marketQtyDecimals = this.pickPrecision(
      row.quantityPrecision,
      marketLotFilter?.stepSize || lotFilter?.stepSize,
      marketLotSz,
    );
    const priceDecimals = this.pickPrecision(
      row.pricePrecision,
      priceFilter?.tickSize,
      tickSz,
    );

    const specs: BinanceInstrumentSpecs = {
      ctVal: 1,
      lotSz,
      minSz,
      ctValCcy: row.baseAsset || normalized.replace(/USDT|BUSD|USDC$/, ""),
      tickSz,
      qtyDecimals,
      priceDecimals,
      marketLotSz,
      marketMinSz,
      marketQtyDecimals,
    };

    this.specsCache.set(normalized, { specs, ts: Date.now() });
    return specs;
  }
}
