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
} from "./types";

// ==================== MEXC Exchange Adapter ====================

const BASE_URL = process.env.MEXC_PROXY_URL || "https://contract.mexc.com";

export class MexcExchange implements ExchangeClient {
  readonly name = "mexc";

  private apiKey: string;
  private secretKey: string;
  private client: AxiosInstance;

  constructor(apiKey: string, secretKey: string) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "X-MEXC-APIKEY": this.apiKey,
      },
    });
  }

  // ─── Auth helpers ──────────────────────────────────────────────────

  private sign(params: Record<string, string | number>): string {
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return CryptoJS.HmacSHA256(queryString, this.secretKey).toString(
      CryptoJS.enc.Hex,
    );
  }

  private buildAuthParams(): Record<string, string | number> {
    return {
      api_key: this.apiKey,
      timestamp: Date.now(),
    };
  }

  // ─── Account ────────────────────────────────────────────────────────

  async getAccountInfo(): Promise<AccountInfo> {
    const params = this.buildAuthParams();
    params["sign"] = this.sign(params);

    const response = await this.client.get("/api/v1/private/account/assets", {
      params,
    });

    const data = response.data;
    if (data.success) {
      const usdtAsset = data.data.find(
        (asset: { currency: string }) => asset.currency === "USDT",
      );
      return {
        totalBalance: parseFloat(usdtAsset?.totalBalance || "0"),
        availableBalance: parseFloat(usdtAsset?.availableBalance || "0"),
        unrealizedPnl: parseFloat(usdtAsset?.unrealizedProfit || "0"),
        currency: "USDT",
      };
    }
    throw new Error(`MEXC API error: ${data.message || "Unknown error"}`);
  }

  // ─── Market Data ────────────────────────────────────────────────────

  async getTickerPrice(symbol: string): Promise<number> {
    const response = await this.client.get(
      `/api/v1/contract/ticker?symbol=${symbol}`,
    );
    const data = response.data;
    if (data.success) {
      return parseFloat(data.data.lastPrice);
    }
    throw new Error(`Failed to get price for ${symbol}`);
  }

  async getKlines(
    symbol: string,
    interval: string = "1h",
    limit: number = 24,
  ): Promise<KlineData[]> {
    const response = await this.client.get(
      `/api/v1/contract/kline/${symbol}?interval=${interval}&limit=${limit}`,
    );
    const data = response.data;
    if (data.success) {
      return data.data.map((k: number[]) => ({
        time: k[0],
        open: parseFloat(String(k[1])),
        close: parseFloat(String(k[2])),
        high: parseFloat(String(k[3])),
        low: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      }));
    }
    return [];
  }

  // ─── Positions ──────────────────────────────────────────────────────

  async getOpenPositions(): Promise<PositionInfo[]> {
    const params = this.buildAuthParams();
    params["sign"] = this.sign(params);

    const response = await this.client.get(
      "/api/v1/private/position/open_positions",
      { params },
    );

    const data = response.data;
    if (data.success) {
      return (data.data || []).map(
        (pos: {
          symbol: string;
          positionId: number;
          type: number;
          leverage: number;
          openType: number;
          entryPrice: number;
          holdQty: number;
          margin: number;
          unrealizedPnl: number;
          liquidationPrice: number;
          marketPrice: number;
        }) => ({
          symbol: pos.symbol,
          positionId: String(pos.positionId),
          side: pos.type === 1 ? ("LONG" as const) : ("SHORT" as const),
          leverage: pos.leverage,
          marginType: pos.openType === 1 ? "isolated" : "cross",
          entryPrice: pos.entryPrice,
          quantity: pos.holdQty,
          margin: pos.margin,
          unrealizedPnl: pos.unrealizedPnl,
          liquidationPrice: pos.liquidationPrice,
          markPrice: pos.marketPrice,
          raw: pos,
        }),
      );
    }
    throw new Error(
      `Failed to get positions: ${data.message || "Unknown error"}`,
    );
  }

  // ─── Leverage ───────────────────────────────────────────────────────

  async setLeverage(
    symbol: string,
    leverage: number,
    marginType: "isolated" | "cross" = "isolated",
    _side?: "BUY" | "SELL",
  ): Promise<void> {
    const params = this.buildAuthParams();
    params["symbol"] = symbol;
    params["leverage"] = leverage;
    params["openType"] = marginType === "isolated" ? 1 : 2;
    params["sign"] = this.sign(params);

    const response = await this.client.post(
      "/api/v1/private/position/change_leverage",
      null,
      { params },
    );

    if (!response.data.success) {
      console.warn(
        `Failed to set leverage for ${symbol}: ${response.data.message}`,
      );
    }
  }

  // ─── Orders ─────────────────────────────────────────────────────────

  async placeOrder(orderParams: OrderParams): Promise<OrderResult> {
    // Set leverage first if specified
    if (orderParams.leverage) {
      await this.setLeverage(orderParams.symbol, orderParams.leverage);
    }

    const params = this.buildAuthParams();
    params["symbol"] = orderParams.symbol;
    params["price"] = orderParams.price || orderParams.quantity;
    params["vol"] = orderParams.quantity;
    params["leverage"] = orderParams.leverage || 10;
    params["side"] =
      orderParams.side === "BUY" ? 1 : orderParams.side === "SELL" ? 3 : 1;
    params["type"] = orderParams.type === "LIMIT" ? 1 : 5; // 1=limit, 5=market
    params["openType"] = 1; // isolated margin

    if (orderParams.type === "LIMIT") {
      params["optionType"] = 1; // GTC
    }

    params["sign"] = this.sign(params);

    const response = await this.client.post(
      "/api/v1/private/order/submit",
      null,
      { params },
    );

    const data = response.data;
    if (data.success) {
      const price =
        orderParams.price || (await this.getTickerPrice(orderParams.symbol));
      return {
        orderId: String(data.data),
        price,
        quantity: orderParams.quantity,
        status: "submitted",
      };
    }
    throw new Error(
      `Failed to place order: ${data.message || "Unknown error"}`,
    );
  }

  async closePosition(
    symbol: string,
    positionId?: string,
    quantity?: number,
  ): Promise<void> {
    const params = this.buildAuthParams();
    params["symbol"] = symbol;

    if (positionId) {
      params["positionId"] = positionId;
    }

    params["sign"] = this.sign(params);

    const response = await this.client.post(
      "/api/v1/private/position/close",
      null,
      { params },
    );

    const data = response.data;
    if (!data.success) {
      throw new Error(
        `Failed to close position: ${data.message || "Unknown error"}`,
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
          await this.closePosition(pos.symbol, pos.positionId);
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
    const params = this.buildAuthParams();
    params["symbol"] = symbol;
    params["triggerPrice"] = triggerPrice;
    params["executePrice"] = executePrice;
    params["side"] = side === "BUY" ? 1 : 3;
    params["vol"] = quantity;
    params["type"] = 1; // SL order
    params["sign"] = this.sign(params);

    const response = await this.client.post(
      "/api/v1/private/plan/order/submit",
      null,
      { params },
    );

    const data = response.data;
    if (data.success) {
      return String(data.data);
    }
    throw new Error(
      `Failed to place stop loss: ${data.message || "Unknown error"}`,
    );
  }

  async placeTakeProfit(
    symbol: string,
    triggerPrice: number,
    executePrice: number,
    side: "BUY" | "SELL",
    quantity: number,
  ): Promise<string> {
    const params = this.buildAuthParams();
    params["symbol"] = symbol;
    params["triggerPrice"] = triggerPrice;
    params["executePrice"] = executePrice;
    params["side"] = side === "BUY" ? 1 : 3;
    params["vol"] = quantity;
    params["type"] = 2; // TP order
    params["sign"] = this.sign(params);

    const response = await this.client.post(
      "/api/v1/private/plan/order/submit",
      null,
      { params },
    );

    const data = response.data;
    if (data.success) {
      return String(data.data);
    }
    throw new Error(
      `Failed to place take profit: ${data.message || "Unknown error"}`,
    );
  }

  // ─── Order Management ───────────────────────────────────────────────

  async getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const params = this.buildAuthParams();
    if (symbol) params["symbol"] = symbol;
    params["sign"] = this.sign(params);

    const response = await this.client.get(
      "/api/v1/private/order/list/open_orders",
      { params },
    );

    const data = response.data;
    if (data.success && data.data) {
      return data.data.map(
        (o: {
          id: string;
          symbol: string;
          side: number;
          type: number;
          price: number;
          vol: number;
          dealVol: number;
          state: number;
          cTime?: number;
          [key: string]: unknown;
        }) => ({
          orderId: String(o.id),
          symbol: o.symbol,
          side: o.side === 1 ? ("BUY" as const) : ("SELL" as const),
          type: String(o.type),
          price: o.price,
          quantity: o.vol,
          filledQuantity: o.dealVol,
          status: String(o.state),
          createdAt: o.cTime,
          raw: o,
        }),
      );
    }
    return [];
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const params = this.buildAuthParams();
    params["symbol"] = symbol;
    params["orderId"] = orderId;
    params["sign"] = this.sign(params);

    const response = await this.client.post(
      "/api/v1/private/order/cancel",
      null,
      { params },
    );

    return response.data.success === true;
  }

  async getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> {
    const params = this.buildAuthParams();
    if (symbol) params["symbol"] = symbol;
    params["sign"] = this.sign(params);

    const response = await this.client.get("/api/v1/private/plan/order/list", {
      params,
    });

    const data = response.data;
    if (data.success && data.data) {
      return data.data.map(
        (o: {
          id: string;
          symbol: string;
          side: number;
          type: number;
          triggerPrice: number;
          executePrice: number;
          vol: number;
          state: number;
          cTime?: number;
          [key: string]: unknown;
        }) => ({
          orderId: String(o.id),
          symbol: o.symbol,
          side: o.side === 1 ? ("BUY" as const) : ("SELL" as const),
          type: o.type === 1 ? "sl" : "tp",
          triggerPrice: o.triggerPrice,
          executePrice: o.executePrice,
          quantity: o.vol,
          status: String(o.state),
          createdAt: o.cTime,
          raw: o,
        }),
      );
    }
    return [];
  }

  async cancelAlgoOrders(
    symbol: string,
  ): Promise<{ cancelled: string[]; errors: string[] }> {
    const cancelled: string[] = [];
    const errors: string[] = [];

    const algoOrders = await this.getAlgoOrders(symbol);

    for (const order of algoOrders) {
      const params = this.buildAuthParams();
      params["symbol"] = symbol;
      params["orderId"] = order.orderId;
      params["sign"] = this.sign(params);

      try {
        const response = await this.client.post(
          "/api/v1/private/plan/order/cancel",
          null,
          { params },
        );

        if (response.data.success) {
          cancelled.push(order.orderId);
        } else {
          errors.push(
            `${order.orderId}: ${response.data.message || "Unknown error"}`,
          );
        }
      } catch (error) {
        errors.push(
          `${order.orderId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    return { cancelled, errors };
  }

  async getOrderHistory(
    symbol?: string,
    limit: number = 20,
  ): Promise<HistoricalOrder[]> {
    const params = this.buildAuthParams();
    if (symbol) params["symbol"] = symbol;
    params["limit"] = limit;
    params["sign"] = this.sign(params);

    const response = await this.client.get(
      "/api/v1/private/order/list/history_orders",
      { params },
    );

    const data = response.data;
    if (data.success && data.data) {
      return data.data.map(
        (o: {
          id: string;
          symbol: string;
          side: number;
          type: number;
          price: number;
          vol: number;
          dealVol: number;
          fee: number;
          profit: number;
          state: number;
          cTime: number;
          uTime?: number;
          [key: string]: unknown;
        }) => ({
          orderId: String(o.id),
          symbol: o.symbol,
          side: o.side === 1 ? ("BUY" as const) : ("SELL" as const),
          type: String(o.type),
          price: o.price,
          quantity: o.vol,
          filledQuantity: o.dealVol,
          fee: Math.abs(o.fee || 0),
          realizedPnl: o.profit || undefined,
          status: String(o.state),
          createdAt: o.cTime,
          updatedAt: o.uTime,
          raw: o,
        }),
      );
    }
    return [];
  }
}
