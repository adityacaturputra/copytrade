import axios, { AxiosInstance } from "axios";
import CryptoJS from "crypto-js";
import {
  ExchangeClient,
  OrderParams,
  PositionInfo,
  AccountInfo,
  KlineData,
  OrderResult,
} from "./types";

// ==================== OKX Exchange Adapter ====================

const BASE_URL = "https://www.okx.com";

/**
 * OKX V5 API — ExchangeClient implementation.
 *
 * Auth docs: https://www.okx.com/docs-v5/en/#rest-api-authentication
 *
 * Env vars used:
 *   OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE
 *   OKX_SIMULATED (optional, set to "true" for demo/testnet)
 */
export class OkxExchange implements ExchangeClient {
  readonly name = "okx";

  private apiKey: string;
  private secretKey: string;
  private passphrase: string;
  private simulated: boolean;
  private client: AxiosInstance;

  constructor(
    apiKey: string,
    secretKey: string,
    passphrase: string,
    simulated: boolean = false,
  ) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.passphrase = passphrase;
    this.simulated = simulated;
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // ─── Auth helpers ──────────────────────────────────────────────────

  private sign(
    timestamp: string,
    method: string,
    path: string,
    body?: string,
  ): string {
    const message = timestamp + method + path + (body || "");
    return CryptoJS.HmacSHA256(message, this.secretKey).toString(
      CryptoJS.enc.Base64,
    );
  }

  private getTimestamp(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
  }

  private authHeaders(
    method: string,
    path: string,
    body?: string,
  ): Record<string, string> {
    const timestamp = this.getTimestamp();
    const sign = this.sign(timestamp, method, path, body);
    const headers: Record<string, string> = {
      "OK-ACCESS-KEY": this.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": this.passphrase,
    };
    if (this.simulated) {
      headers["x-simulated-trading"] = "1";
    }
    return headers;
  }

  // ─── Instrument helpers ────────────────────────────────────────────

  /**
   * Convert standard symbol (e.g. "BTCUSDT") to OKX instrument ID ("BTC-USDT-SWAP").
   * OKX uses: BASE-QUOTE-SWAP for perpetuals.
   */
  private toOkxSymbol(symbol: string): string {
    // If already in OKX format, return as-is
    if (symbol.includes("-")) return symbol;
    // Try to split at USDT, USD, BTC, ETH boundaries
    const quote = symbol.endsWith("USDT")
      ? "USDT"
      : symbol.endsWith("USD")
        ? "USD"
        : null;
    if (quote) {
      const base = symbol.slice(0, -quote.length);
      return `${base}-${quote}-SWAP`;
    }
    // Fallback: assume USDT perpetual
    return `${symbol}-USDT-SWAP`;
  }

  /** Convert OKX instId back to standard symbol like "BTCUSDT" */
  private fromOkxSymbol(instId: string): string {
    return instId.replace(/-/g, "").replace("SWAP", "");
  }

  // ─── Account ────────────────────────────────────────────────────────

  async getAccountInfo(): Promise<AccountInfo> {
    const path = "/api/v5/account/balance";
    const headers = this.authHeaders("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]) {
      const account = data.data[0];
      const usdtDetail = account.details?.find(
        (d: { ccy: string }) => d.ccy === "USDT",
      );
      return {
        totalBalance: parseFloat(usdtDetail?.eq || account.totalEq || "0"),
        availableBalance: parseFloat(
          usdtDetail?.availBal || usdtDetail?.cashBal || "0",
        ),
        unrealizedPnl: parseFloat(usdtDetail?.upl || "0"),
        currency: "USDT",
      };
    }
    throw new Error(`OKX API error: ${data.msg || "Unknown error"}`);
  }

  // ─── Market Data ────────────────────────────────────────────────────

  async getTickerPrice(symbol: string): Promise<number> {
    const instId = this.toOkxSymbol(symbol);
    const path = `/api/v5/market/ticker?instId=${instId}`;
    const response = await this.client.get(path);
    const data = response.data;

    if (data.code === "0" && data.data?.[0]) {
      return parseFloat(data.data[0].last);
    }
    throw new Error(`Failed to get price for ${symbol} (${instId})`);
  }

  async getKlines(
    symbol: string,
    interval: string = "1H",
    limit: number = 24,
  ): Promise<KlineData[]> {
    const instId = this.toOkxSymbol(symbol);
    const path = `/api/v5/market/candles?instId=${instId}&bar=${interval}&limit=${limit}`;
    const response = await this.client.get(path);
    const data = response.data;

    if (data.code === "0" && data.data) {
      // OKX returns newest first, reverse to match standard chronologic order
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

  // ─── Positions ──────────────────────────────────────────────────────

  async getOpenPositions(): Promise<PositionInfo[]> {
    const path = "/api/v5/account/positions";
    const headers = this.authHeaders("GET", path);

    const response = await this.client.get(path, { headers });
    const data = response.data;

    if (data.code === "0") {
      return (data.data || []).map(
        (pos: {
          instId: string;
          pos: string;
          posSide: string;
          lever: string;
          margin: string;
          avgPx: string;
          upl: string;
          liqPx: string;
          markPx: string;
          mgnMode: string;
          posId: string;
        }) => ({
          symbol: this.fromOkxSymbol(pos.instId),
          positionId: pos.posId || pos.instId,
          side: pos.posSide === "long" ? ("LONG" as const) : ("SHORT" as const),
          leverage: parseFloat(pos.lever),
          marginType:
            pos.mgnMode === "isolated" ? "isolated" : ("cross" as const),
          entryPrice: parseFloat(pos.avgPx),
          quantity: Math.abs(parseFloat(pos.pos)),
          margin: parseFloat(pos.margin),
          unrealizedPnl: parseFloat(pos.upl),
          liquidationPrice: parseFloat(pos.liqPx) || 0,
          markPrice: parseFloat(pos.markPx),
          raw: pos,
        }),
      );
    }
    if (data.code === "51001") {
      // No positions
      return [];
    }
    throw new Error(
      `Failed to get OKX positions: ${data.msg || "Unknown error"}`,
    );
  }

  // ─── Leverage ───────────────────────────────────────────────────────

  async setLeverage(
    symbol: string,
    leverage: number,
    marginType: "isolated" | "cross" = "isolated",
  ): Promise<void> {
    const instId = this.toOkxSymbol(symbol);
    const path = "/api/v5/account/set-leverage";
    const body = JSON.stringify({
      instId,
      lever: String(leverage),
      mgnMode: marginType,
    });

    const headers = this.authHeaders("POST", path, body);

    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code !== "0") {
      console.warn(`Failed to set leverage for ${symbol}: ${data.msg}`);
    }
  }

  // ─── Orders ─────────────────────────────────────────────────────────

  async placeOrder(orderParams: OrderParams): Promise<OrderResult> {
    const instId = this.toOkxSymbol(orderParams.symbol);
    const isBuy = orderParams.side === "BUY";

    // Set leverage first
    if (orderParams.leverage) {
      await this.setLeverage(orderParams.symbol, orderParams.leverage);
    }

    const orderBody: Record<string, string> = {
      instId,
      tdMode: "isolated", // isolated margin
      side: isBuy ? "buy" : "sell",
      ordType: orderParams.type === "LIMIT" ? "limit" : "market",
      sz: String(orderParams.quantity),
      posSide: isBuy ? "long" : "short",
    };

    if (orderParams.type === "LIMIT" && orderParams.price) {
      orderBody.px = String(orderParams.price);
    }

    const body = JSON.stringify(orderBody);
    const path = "/api/v5/trade/order";
    const headers = this.authHeaders("POST", path, body);

    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]) {
      const result = data.data[0];
      if (result.sCode === "0") {
        const price =
          orderParams.price || (await this.getTickerPrice(orderParams.symbol));
        return {
          orderId: result.orderId,
          price,
          quantity: orderParams.quantity,
          status: "submitted",
        };
      }
      throw new Error(`OKX order rejected: ${result.sMsg}`);
    }
    throw new Error(
      `Failed to place OKX order: ${data.msg || "Unknown error"}`,
    );
  }

  async closePosition(
    symbol: string,
    positionId?: string,
    quantity?: number,
  ): Promise<void> {
    const instId = this.toOkxSymbol(symbol);

    // First get the position to know the side
    const positions = await this.getOpenPositions();
    const pos = positions.find(
      (p) => p.symbol === symbol || p.positionId === positionId,
    );

    if (!pos) {
      throw new Error(`No open position found for ${symbol}`);
    }

    const body = JSON.stringify({
      instId,
      mgnMode: "isolated",
      posSide: pos.side === "LONG" ? "long" : "short",
      type: "market",
      sz: String(quantity || pos.quantity),
      side: pos.side === "LONG" ? "sell" : "buy",
      tdMode: "isolated",
    });

    const path = "/api/v5/trade/close-position";
    const headers = this.authHeaders("POST", path, body);

    // Try close-position endpoint first
    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]?.sCode === "0") {
      return;
    }

    // Fallback: place opposite order
    console.warn(
      `OKX close-position failed (${data.msg}), trying opposite order...`,
    );

    const fallbackBody = JSON.stringify({
      instId,
      tdMode: "isolated",
      side: pos.side === "LONG" ? "sell" : "buy",
      posSide: pos.side === "LONG" ? "long" : "short",
      ordType: "market",
      sz: String(quantity || pos.quantity),
      reduceOnly: "true",
    });

    const fallbackHeaders = this.authHeaders("POST", path, fallbackBody);
    const fallbackResp = await this.client.post(
      "/api/v5/trade/order",
      fallbackBody,
      { headers: fallbackHeaders },
    );

    const fallbackData = fallbackResp.data;
    if (fallbackData.code !== "0" || fallbackData.data?.[0]?.sCode !== "0") {
      throw new Error(
        `Failed to close OKX position: ${fallbackData.msg || fallbackData.data?.[0]?.sMsg || "Unknown error"}`,
      );
    }
  }

  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> {
    const closed: string[] = [];
    const errors: string[] = [];

    try {
      const positions = await this.getOpenPositions();

      for (const pos of positions) {
        try {
          await this.closePosition(pos.symbol, pos.positionId, pos.quantity);
          closed.push(pos.symbol);
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

  // ─── Stop Loss / Take Profit ────────────────────────────────────────

  async placeStopLoss(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    const instId = this.toOkxSymbol(symbol);
    const posSide = side === "BUY" ? "long" : "short";

    const body = JSON.stringify({
      instId,
      tdMode: "isolated",
      side: side === "BUY" ? "sell" : "buy", // SL is opposite side
      posSide,
      ordType: "conditional",
      sz: String(quantity),
      slTriggerPx: String(triggerPrice),
      slOrdPx: String(executePrice || triggerPrice),
    });

    const path = "/api/v5/trade/order-algo";
    const headers = this.authHeaders("POST", path, body);

    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]?.algoId) {
      return data.data[0].algoId;
    }
    throw new Error(
      `Failed to place OKX stop loss: ${data.msg || data.data?.[0]?.sMsg || "Unknown error"}`,
    );
  }

  async placeTakeProfit(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    const instId = this.toOkxSymbol(symbol);
    const posSide = side === "BUY" ? "long" : "short";

    const body = JSON.stringify({
      instId,
      tdMode: "isolated",
      side: side === "BUY" ? "sell" : "buy", // TP is opposite side
      posSide,
      ordType: "conditional",
      sz: String(quantity),
      tpTriggerPx: String(triggerPrice),
      tpOrdPx: String(executePrice || triggerPrice),
    });

    const path = "/api/v5/trade/order-algo";
    const headers = this.authHeaders("POST", path, body);

    const response = await this.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0" && data.data?.[0]?.algoId) {
      return data.data[0].algoId;
    }
    throw new Error(
      `Failed to place OKX take profit: ${data.msg || data.data?.[0]?.sMsg || "Unknown error"}`,
    );
  }
}
