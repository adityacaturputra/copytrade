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
} from "../types";
import { getProxyAgent } from "../../proxy/ProxyFactory";
import { getBinanceAccountInfo } from "./parts/account";
import { setBinanceLeverage } from "./parts/leverage";
import { getBinanceTickerPrice, getBinanceKlines, getBinanceInstrumentSpecs } from "./parts/market";
import { placeBinanceOrder, getBinanceOpenOrders, cancelBinanceOrder, getBinanceAlgoOrders, cancelBinanceAlgoOrders, getBinanceOrderHistory } from "./parts/orders";
import { fetchBinancePositions, closeBinancePosition, placeBinanceConditionalAlgoOrder } from "./parts/positions";
import { BinanceCtx, BinanceInstrumentSpecs } from "./parts/types";

export class BinanceExchange implements ExchangeClient {
  readonly name = "binance";
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly client: AxiosInstance;
  private readonly specsCache = new Map<string, { specs: BinanceInstrumentSpecs; ts: number }>();

  constructor(apiKey: string, secretKey: string, simulated = false) {
    this.apiKey = apiKey.trim(); this.secretKey = secretKey.trim();
    this.client = axios.create({
      baseURL: simulated ? (process.env.BINANCE_TESTNET_BASE_URL || "https://testnet.binancefuture.com") : (process.env.BINANCE_BASE_URL || "https://fapi.binance.com"),
      timeout: 30000, headers: { "Content-Type": "application/json", "X-MBX-APIKEY": this.apiKey }
    });
    this.client.interceptors.request.use(async (config) => {
      const agent = await getProxyAgent();
      if (agent) { config.httpsAgent = agent; config.httpAgent = agent; }
      return config;
    });
  }

  private getHelperContext(): BinanceCtx {
    return {
      apiKey: this.apiKey, secretKey: this.secretKey, client: this.client, specsCache: this.specsCache, specsCacheTtl: 30 * 60 * 1000,
      toSymbol: this.toSymbol.bind(this), parseNumber: this.parseNumber.bind(this), countDecimals: this.countDecimals.bind(this),
      formatNum: this.formatNum.bind(this), clampToStep: this.clampToStep.bind(this), signedRequest: this.signedRequest.bind(this),
      publicRequest: this.publicRequest.bind(this), getInstrumentSpecs: this.getInstrumentSpecs.bind(this),
      getOpenPositions: this.getOpenPositions.bind(this), getQuantityRule: this.getQuantityRule.bind(this),
      buildSignedQuery: this.buildSignedQuery.bind(this)
    };
  }

  private toSymbol(s: string) { return s.replace(/[-_/]/g, "").toUpperCase(); }
  private parseNumber(v: any, f = 0) { const n = parseFloat(String(v)); return isNaN(n) ? f : n; }
  private countDecimals(v: number) { if (Math.floor(v) === v) return 0; const s = String(v); if (s.includes("e")) return parseInt(s.split("-")[1]); return s.split(".")[1].length; }
  private formatNum(v: number, d: number) { return v.toFixed(d); }
  private clampToStep(v: number, s: number, d: number) { const r = Math.round(v / s) * s; return parseFloat(r.toFixed(d)); }

  private buildSignedQuery(p: any) {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) { if (v !== undefined) s.append(k, String(v)); }
    s.append("timestamp", String(Date.now())); s.append("recvWindow", "10000");
    const q = s.toString();
    s.append("signature", CryptoJS.HmacSHA256(q, this.secretKey).toString(CryptoJS.enc.Hex));
    return s.toString();
  }

  async publicRequest<T>(p: string, params?: any): Promise<T> {
    const r = await this.client.get(p, { params }); return r.data;
  }
  async signedRequest<T>(m: string, p: string, params: any = {}): Promise<T> {
    const q = this.buildSignedQuery(params);
    const url = `${p}?${q}`;
    let r;
    if (m === "GET") r = await this.client.get(url);
    else if (m === "POST") r = await this.client.post(url);
    else if (m === "DELETE") r = await this.client.delete(url);
    else throw new Error("Method not supported");
    return r.data;
  }

  getQuantityRule(specs: BinanceInstrumentSpecs, type: string) {
    const isMarket = type.includes("MARKET");
    return { step: isMarket ? specs.marketLotSz : specs.lotSz, min: isMarket ? specs.marketMinSz : specs.minSz, decimals: isMarket ? specs.marketQtyDecimals : specs.qtyDecimals };
  }

  async getAccountInfo(): Promise<AccountInfo> { return getBinanceAccountInfo(this.getHelperContext()); }
  async getTickerPrice(s: string): Promise<number> { return getBinanceTickerPrice(this.getHelperContext(), s); }
  async getKlines(s: string, i = "1h", l = 24): Promise<KlineData[]> { return getBinanceKlines(this.getHelperContext(), s, i, l); }
  async getInstrumentSpecs(s: string) { return getBinanceInstrumentSpecs(this.getHelperContext(), s); }
  async getOpenPositions(): Promise<PositionInfo[]> { return fetchBinancePositions(this.getHelperContext()); }
  async placeOrder(p: OrderParams): Promise<OrderResult> { return placeBinanceOrder(this.getHelperContext(), p); }
  async closePosition(s: string, id?: string, q?: number): Promise<void> { return closeBinancePosition(this.getHelperContext(), s, id, q); }
  async closeAllPositions() {
    const closed: string[] = [], errors: string[] = [];
    try {
      const ps = await this.getOpenPositions();
      for (const p of ps) {
        try { await this.closePosition(p.symbol, p.positionId); closed.push(`${p.symbol} (${p.side})`); }
        catch (e: any) { errors.push(`${p.symbol}: ${e.message}`); }
      }
    } catch (e: any) { errors.push(`Failed: ${e.message}`); }
    return { closed, errors };
  }
  async setLeverage(s: string, l: number, t: "isolated" | "cross" = "isolated"): Promise<number> { return setBinanceLeverage(this.getHelperContext(), s, l, t); }
  async placeStopLoss(s: string, tp: number, ep: number, side: "BUY" | "SELL", q: number): Promise<string> { return placeBinanceConditionalAlgoOrder(this.getHelperContext(), s, side, "STOP_MARKET", tp, q); }
  async placeTakeProfit(s: string, tp: number, ep: number, side: "BUY" | "SELL", q: number): Promise<string> { return placeBinanceConditionalAlgoOrder(this.getHelperContext(), s, side, "TAKE_PROFIT_MARKET", tp, q); }
  async getOpenOrders(s?: string): Promise<OpenOrderInfo[]> { return getBinanceOpenOrders(this.getHelperContext(), s); }
  async cancelOrder(id: string, s: string): Promise<boolean> { return cancelBinanceOrder(this.getHelperContext(), id, s); }
  async getAlgoOrders(s?: string): Promise<AlgoOrderInfo[]> { return getBinanceAlgoOrders(this.getHelperContext(), s); }
  async cancelAlgoOrders(s: string): Promise<{ cancelled: string[]; errors: string[] }> { return cancelBinanceAlgoOrders(this.getHelperContext(), s); }
  async getOrderHistory(s?: string, l = 20): Promise<HistoricalOrder[]> { return getBinanceOrderHistory(this.getHelperContext(), s, l); }
}
