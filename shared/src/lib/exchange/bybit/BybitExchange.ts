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
} from "../types";
import { getProxyAgent } from "../../proxy/ProxyFactory";
import {
  getBybitAccountInfo,
  getBybitAccountMarginMode,
} from "./parts/account";
import { setBybitLeverage } from "./parts/leverage";
import { getBybitTickerPrice, getBybitKlines, getBybitInstrumentSpecs } from "./parts/market";
import { placeBybitOrder, cancelBybitOrder, getBybitOpenOrders, getBybitAlgoOrders, cancelBybitAlgoOrders, getBybitOrderHistory } from "./parts/orders";
import { fetchBybitPositions, mapBybitOpenPositions, closeBybitPosition, closeBybitAllPositions, placeBybitConditionalCloseOrder } from "./parts/positions";
import { bybitPublicRequest, bybitRequest } from "./parts/request";
import { BybitCtx } from "./parts/types";

const BYBIT_RECV_WINDOW = "10000";
const SPECS_CACHE_TTL = 30 * 60 * 1000;

export class BybitExchange implements ExchangeClient {
  readonly name = "bybit";
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly client: AxiosInstance;
  private readonly simulated: boolean;
  private readonly baseUrl: string;
  private readonly specsCache = new Map<string, { specs: InstrumentSpecs; ts: number }>();
  private accountMarginModeCache: {
    value: "isolated" | "cross";
    ts: number;
  } | null = null;

  constructor(apiKey: string, secretKey: string, simulated: boolean = false) {
    this.apiKey = apiKey.trim();
    this.secretKey = secretKey.trim();
    this.simulated = simulated;
    this.baseUrl = this.simulated
      ? process.env.BYBIT_DEMO_BASE_URL || "https://api-demo.bybit.com"
      : process.env.BYBIT_BASE_URL || "https://api.bybit.com";
    this.client = axios.create({ baseURL: this.baseUrl, timeout: 30000, headers: { "Content-Type": "application/json" } });
    this.client.interceptors.request.use(async (config) => {
      const agent = await getProxyAgent();
      if (agent) { config.httpsAgent = agent; config.httpAgent = agent; }
      return config;
    });
  }

  private getHelperContext(): BybitCtx {
    return {
      apiKey: this.apiKey, secretKey: this.secretKey, client: this.client, specsCache: this.specsCache, specsCacheTtl: SPECS_CACHE_TTL,
      toSymbol: this.toSymbol.bind(this), parseNumber: this.parseNumber.bind(this), countDecimals: this.countDecimals.bind(this),
      formatNum: this.formatNum.bind(this), clampToStep: this.clampToStep.bind(this), signedRequest: this.signedRequest.bind(this),
      publicRequest: this.publicRequest.bind(this), fetchPositions: this.fetchPositions.bind(this), getTickerPrice: this.getTickerPrice.bind(this),
      getInstrumentSpecs: this.getInstrumentSpecs.bind(this), setLeverage: this.setLeverage.bind(this), cancelOrder: this.cancelOrder.bind(this),
      fetchRealtimeOrders: this.fetchRealtimeOrders.bind(this), clearTradingStopsForPosition: this.clearTradingStopsForPosition.bind(this),
      getAccountMarginMode: this.getAccountMarginMode.bind(this),
      resolvePositionMarginType: this.resolvePositionMarginType.bind(this), ensureMarginMode: this.ensureMarginMode.bind(this),
      buildSignedHeaders: this.buildSignedHeaders.bind(this), buildQueryString: this.buildQueryString.bind(this),
      getOpenPositions: this.getOpenPositions.bind(this)
    };
  }

  private toSymbol(s: string) { return s.replace("/", "").toUpperCase(); }
  private parseNumber(v: any, f = 0) { const n = parseFloat(String(v)); return isNaN(n) ? f : n; }
  private countDecimals(v: number) { if (Math.floor(v) === v) return 0; const s = String(v); if (s.includes("e")) return parseInt(s.split("-")[1]); return s.split(".")[1].length; }
  private formatNum(v: number, d: number) { return v.toFixed(d); }
  private clampToStep(v: number, s: number, d: number) { const r = Math.round(v / s) * s; return parseFloat(r.toFixed(d)); }

  private buildQueryString(p: Record<string, any>) { return Object.entries(p).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&"); }
  private buildSignedHeaders(t: string, p: string) {
    const sign = CryptoJS.HmacSHA256(t + this.apiKey + BYBIT_RECV_WINDOW + p, this.secretKey).toString();
    return { "X-BAPI-API-KEY": this.apiKey, "X-BAPI-SIGN": sign, "X-BAPI-SIGN-TYPE": "2", "X-BAPI-TIMESTAMP": t, "X-BAPI-RECV-WINDOW": BYBIT_RECV_WINDOW };
  }

  async publicRequest<T>(p: string, params?: any): Promise<T> {
    return bybitPublicRequest(this.getHelperContext(), p, params);
  }
  async signedRequest<T>(m: "GET" | "POST", p: string, params?: any): Promise<T> { return bybitRequest(this.getHelperContext(), m, p, params); }

  async getAccountInfo(): Promise<AccountInfo> { return getBybitAccountInfo(this.getHelperContext()); }
  async getTickerPrice(s: string): Promise<number> { return getBybitTickerPrice(this.getHelperContext(), s); }
  async getKlines(s: string, i = "1h", l = 24): Promise<KlineData[]> {
    const m: any = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720", "1d": "D", "1w": "W", "1M": "M" };
    return getBybitKlines(this.getHelperContext(), s, m[i] || i, l);
  }
  async getInstrumentSpecs(s: string): Promise<InstrumentSpecs> { return getBybitInstrumentSpecs(this.getHelperContext(), s); }
  async getOpenPositions(): Promise<PositionInfo[]> { return mapBybitOpenPositions(this.getHelperContext(), await this.fetchPositions()); }
  async fetchPositions(s?: string) { return fetchBybitPositions(this.getHelperContext(), s); }
  async getAccountMarginMode(): Promise<"isolated" | "cross"> {
    const cached = this.accountMarginModeCache;
    if (cached && Date.now() - cached.ts < 60_000) return cached.value;
    const value = await getBybitAccountMarginMode(this.getHelperContext());
    this.accountMarginModeCache = { value, ts: Date.now() };
    return value;
  }
  async placeOrder(p: OrderParams): Promise<OrderResult> { return placeBybitOrder(this.getHelperContext(), p); }
  async closePosition(s: string, id?: string, q?: number): Promise<void> { return closeBybitPosition(this.getHelperContext(), s, id, q); }
  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> { return closeBybitAllPositions(this.getHelperContext()); }
  async setLeverage(s: string, l: number, t: "isolated" | "cross" = "isolated"): Promise<number> { return setBybitLeverage(this.getHelperContext(), s, l, t); }
  async placeStopLoss(s: string, tp: number, ep: number, side: "BUY" | "SELL", q: number): Promise<string> { return placeBybitConditionalCloseOrder(this.getHelperContext(), "sl", s, tp, side, q); }
  async placeTakeProfit(s: string, tp: number, ep: number, side: "BUY" | "SELL", q: number): Promise<string> { return placeBybitConditionalCloseOrder(this.getHelperContext(), "tp", s, tp, side, q); }
  async getOpenOrders(s?: string): Promise<OpenOrderInfo[]> { return getBybitOpenOrders(this.getHelperContext(), s); }
  async cancelOrder(id: string, s: string): Promise<boolean> { return cancelBybitOrder(this.getHelperContext(), id, s); }
  async getAlgoOrders(s?: string): Promise<AlgoOrderInfo[]> { return getBybitAlgoOrders(this.getHelperContext(), s); }
  async cancelAlgoOrders(s: string): Promise<{ cancelled: string[]; errors: string[] }> { return cancelBybitAlgoOrders(this.getHelperContext(), s); }
  async getOrderHistory(s?: string, l = 20): Promise<HistoricalOrder[]> { return getBybitOrderHistory(this.getHelperContext(), s, l); }

  async fetchRealtimeOrders(f: "Order" | "StopOrder", s?: string): Promise<any[]> {
    const res = await this.signedRequest<any>("GET", "/v5/order/realtime", { category: "linear", symbol: s ? this.toSymbol(s) : undefined, settleCoin: s ? undefined : "USDT", filter: f });
    return res.list || [];
  }
  async clearTradingStopsForPosition(s: string, idx: number): Promise<void> {
    await this.signedRequest("POST", "/v5/position/trading-stop", { category: "linear", symbol: this.toSymbol(s), takeProfit: "0", stopLoss: "0", positionIdx: idx });
  }
  async resolvePositionMarginType(row: any): Promise<"isolated" | "cross"> {
    if (row.tradeMode === 1) return "isolated";
    if (row.tradeMode === 0) return this.getAccountMarginMode();
    return "cross";
  }
  async ensureMarginMode(s: string, l: number, t: "isolated" | "cross"): Promise<void> {
    try { await this.signedRequest("POST", "/v5/position/switch-isolated", { category: "linear", symbol: s, tradeMode: t === "isolated" ? 1 : 0, buyLeverage: String(l), sellLeverage: String(l) }); } catch {}
  }
}
