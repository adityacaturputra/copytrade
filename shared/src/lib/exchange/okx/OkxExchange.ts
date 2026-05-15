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
import { getOkxAccountInfo } from "./parts/account";
import { setOkxLeverage } from "./parts/leverage";
import { getOkxTickerPrice, getOkxKlines, getOkxInstrumentSpecs } from "./parts/market";
import { placeOkxOrder, getOkxOpenOrders, cancelOkxOrder, getOkxAlgoOrders, cancelOkxAlgoOrders, getOkxOrderHistory } from "./parts/orders";
import { fetchOkxPositions, closeOkxPosition, placeOkxProtection } from "./parts/positions";
import { OkxCtx } from "./parts/types";

export class OkxExchange implements ExchangeClient {
  readonly name = "okx";
  private apiKey: string;
  private secretKey: string;
  private passphrase: string;
  private simulated: boolean;
  private client: AxiosInstance;
  private specsCache = new Map<string, { specs: InstrumentSpecs; ts: number }>();
  private accountConfigCache?: { posMode: "long_short_mode" | "net_mode"; ts: number };

  constructor(apiKey: string, secretKey: string, passphrase: string, simulated = false) {
    this.apiKey = apiKey; this.secretKey = secretKey; this.passphrase = passphrase; this.simulated = simulated;
    this.client = axios.create({
      baseURL: process.env.OKX_PROXY_URL || process.env.OKX_BASE_URL || "https://www.okx.com",
      timeout: 30000, headers: { "Content-Type": "application/json" }
    });
    this.client.interceptors.request.use(async (config) => {
      const agent = await getProxyAgent();
      if (agent) { config.httpsAgent = agent; config.httpAgent = agent; }
      return config;
    });
  }

  private getHelperContext(): OkxCtx {
    return {
      apiKey: this.apiKey, secretKey: this.secretKey, passphrase: this.passphrase, simulated: this.simulated,
      client: this.client, specsCache: this.specsCache, specsCacheTtl: 30 * 60 * 1000,
      authHeaders: this.authHeaders.bind(this), toOkxSymbol: this.toOkxSymbol.bind(this),
      fromOkxSymbol: this.fromOkxSymbol.bind(this), getPositionMode: this.getPositionMode.bind(this),
      getInstrumentSpecs: this.getInstrumentSpecs.bind(this), getOpenPositions: this.getOpenPositions.bind(this)
    };
  }

  private sign(t: string, m: string, p: string, b?: string) {
    return CryptoJS.HmacSHA256(t + m + p + (b || ""), this.secretKey).toString(CryptoJS.enc.Base64);
  }
  private authHeaders(m: string, p: string, b?: string) {
    const t = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
    return { "OK-ACCESS-KEY": this.apiKey, "OK-ACCESS-SIGN": this.sign(t, m, p, b), "OK-ACCESS-TIMESTAMP": t, "OK-ACCESS-PASSPHRASE": this.passphrase, "x-simulated-trading": this.simulated ? "1" : "0" };
  }

  private toOkxSymbol(s: string) { return s.replace("/", "-").toUpperCase() + "-SWAP"; }
  private fromOkxSymbol(s: string) { return s.replace("-SWAP", "").replace("-", "/"); }

  async getPositionMode(): Promise<"long_short_mode" | "net_mode"> {
    if (this.accountConfigCache && Date.now() - this.accountConfigCache.ts < 60000) return this.accountConfigCache.posMode;
    const path = "/api/v5/account/config";
    const resp = await this.client.get(path, { headers: this.authHeaders("GET", path) });
    const posMode = resp.data.data?.[0]?.posMode || "net_mode";
    this.accountConfigCache = { posMode, ts: Date.now() };
    return posMode;
  }

  async getAccountInfo(): Promise<AccountInfo> { return getOkxAccountInfo(this.getHelperContext()); }
  async getTickerPrice(s: string): Promise<number> { return getOkxTickerPrice(this.getHelperContext(), s); }
  async getKlines(s: string, i = "1h", l = 24): Promise<KlineData[]> { return getOkxKlines(this.getHelperContext(), s, i, l); }
  async getInstrumentSpecs(s: string): Promise<InstrumentSpecs> { return getOkxInstrumentSpecs(this.getHelperContext(), s); }
  async getOpenPositions(): Promise<PositionInfo[]> { return fetchOkxPositions(this.getHelperContext()); }
  async placeOrder(p: OrderParams): Promise<OrderResult> { return placeOkxOrder(this.getHelperContext(), p); }
  async closePosition(s: string, id?: string, q?: number): Promise<void> { return closeOkxPosition(this.getHelperContext(), s, id, q); }
  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> {
    const closed: string[] = [], errors: string[] = [];
    try {
      const ps = await this.getOpenPositions();
      for (const p of ps) {
        try { await this.closePosition(p.symbol, p.positionId, p.quantity); closed.push(p.symbol); }
        catch (e: any) { errors.push(`${p.symbol}: ${e.message}`); }
      }
    } catch (e: any) { errors.push(`Failed: ${e.message}`); }
    return { closed, errors };
  }
  async setLeverage(s: string, l: number, t: "isolated" | "cross" = "isolated"): Promise<number> { return setOkxLeverage(this.getHelperContext(), s, l, t); }
  async placeStopLoss(s: string, tp: number, ep: number, side: "BUY" | "SELL", q: number): Promise<string> { return placeOkxProtection(this.getHelperContext(), "sl", s, tp, ep, side, q); }
  async placeTakeProfit(s: string, tp: number, ep: number, side: "BUY" | "SELL", q: number): Promise<string> { return placeOkxProtection(this.getHelperContext(), "tp", s, tp, ep, side, q); }
  async getOpenOrders(s?: string): Promise<OpenOrderInfo[]> { return getOkxOpenOrders(this.getHelperContext(), s); }
  async cancelOrder(id: string, s: string): Promise<boolean> { return cancelOkxOrder(this.getHelperContext(), id, s); }
  async getAlgoOrders(s?: string): Promise<AlgoOrderInfo[]> { return getOkxAlgoOrders(this.getHelperContext(), s); }
  async cancelAlgoOrders(s: string): Promise<{ cancelled: string[]; errors: string[] }> { return cancelOkxAlgoOrders(this.getHelperContext(), s); }
  async getOrderHistory(s?: string, l = 20): Promise<HistoricalOrder[]> { return getOkxOrderHistory(this.getHelperContext(), s, l); }
}
