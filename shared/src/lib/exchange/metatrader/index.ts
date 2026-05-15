import type { AxiosInstance } from "axios";
import type {   AccountInfo,
  AlgoOrderInfo,
  ExchangeClient,
  HistoricalOrder,
  InstrumentSpecs,
  KlineData,
  OpenOrderInfo,
  OrderParams,
  OrderResult,
  PositionInfo } from "../types";
import { buildMetaTraderHeaders, createMetaTraderClient, metaTraderRequest } from "./client";
import { mapMetaTraderHistoricalOrder, mapMetaTraderOpenOrder, mapMetaTraderPosition } from "./mappers";
import { buildMetaTraderAlgoOrders, clearMetaTraderSyntheticProtectionOrder, updateMetaTraderPositionProtection } from "./protection";
import type { HttpMethod, MetaTraderAccountRow, MetaTraderConfig, MetaTraderInstrumentRow, MetaTraderOrderRow, MetaTraderPositionRow } from "./types";
import { countMetaTraderDecimals, extractMetaTraderArray, extractMetaTraderObject, normalizeMetaTraderStatus, normalizeMetaTraderSymbol, parseMetaTraderNumber } from "./utils";

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
    this.client = createMetaTraderClient(config.baseUrl);
  }
  private buildHeaders(): Record<string, string> {
    return buildMetaTraderHeaders({
      login: this.login,
      password: this.password,
      server: this.server,
      platform: this.platform,
      bridgeToken: this.bridgeToken,
    });
  }
  private toSymbol(symbol: string): string { return normalizeMetaTraderSymbol(symbol); }
  private extractArray<T>(payload: unknown, keys: string[]): T[] { return extractMetaTraderArray<T>(payload, keys); }
  private extractObject<T>(payload: unknown, keys: string[]): T { return extractMetaTraderObject<T>(payload, keys); }
  private async request<T>(
    method: HttpMethod,
    path: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      data?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    return metaTraderRequest<T>({
      client: this.client,
      headers: this.buildHeaders(),
      method,
      path,
      options,
    });
  }
  private async getPositionsRaw(symbol?: string): Promise<MetaTraderPositionRow[]> {
    const response = await this.request<unknown>("GET", "/positions", {
      params: { symbol: symbol ? this.toSymbol(symbol) : undefined },
    });
    return this.extractArray<MetaTraderPositionRow>(response, ["positions", "result", "data"]);
  }
  async getAccountInfo(): Promise<AccountInfo> {
    const response = await this.request<unknown>("GET", "/account");
    const account = this.extractObject<MetaTraderAccountRow>(response, ["account", "result", "data"]);
    const balance = parseMetaTraderNumber(account.balance);
    const equity = parseMetaTraderNumber(account.equity, balance);
    const freeMargin =
      parseMetaTraderNumber(account.freeMargin) ||
      parseMetaTraderNumber(account.availableBalance) ||
      parseMetaTraderNumber(account.marginFree);

    return {
      totalBalance: equity || balance,
      availableBalance: freeMargin || balance,
      unrealizedPnl: parseMetaTraderNumber(account.pnl) || parseMetaTraderNumber(account.profit),
      currency: account.currency || "USD",
    };
  }

  async getTickerPrice(symbol: string): Promise<number> {
    const response = await this.request<unknown>("GET", "/ticker", {
      params: { symbol: this.toSymbol(symbol) },
    });
    const ticker = this.extractObject<Record<string, unknown>>(response, ["ticker", "result", "data"]);
    return (
      parseMetaTraderNumber(ticker.price) ||
      parseMetaTraderNumber(ticker.bid) ||
      parseMetaTraderNumber(ticker.ask)
    );
  }

  async getKlines(symbol: string, interval: string = "1H", limit: number = 24): Promise<KlineData[]> {
    const response = await this.request<unknown>("GET", "/klines", {
      params: { symbol: this.toSymbol(symbol), interval, limit },
    });
    const rows = this.extractArray<Record<string, unknown>>(response, ["klines", "candles", "result", "data"]);
    return rows.map((row) => ({
      time: parseMetaTraderNumber(row.openTime || row.time || row.timestamp),
      open: parseMetaTraderNumber(row.open),
      high: parseMetaTraderNumber(row.high),
      low: parseMetaTraderNumber(row.low),
      close: parseMetaTraderNumber(row.close),
      volume: parseMetaTraderNumber(row.volume),
    }));
  }

  async getOpenPositions(): Promise<PositionInfo[]> {
    return (await this.getPositionsRaw()).map(mapMetaTraderPosition);
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
    const order = this.extractObject<Record<string, unknown>>(response, ["order", "result", "data"]);
    return {
      orderId: String(order.orderId || order.ticket || order.id || ""),
      price: parseMetaTraderNumber(order.price) || params.price || 0,
      quantity: parseMetaTraderNumber(order.quantity) || parseMetaTraderNumber(order.volume) || params.quantity,
      status: normalizeMetaTraderStatus(order.status, "submitted"),
      raw: order,
    };
  }

  async closePosition(symbol: string, positionId?: string, quantity?: number): Promise<void> {
    await this.request("POST", "/positions/close", {
      data: { symbol: this.toSymbol(symbol), positionId, quantity },
    });
  }

  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> {
    try {
      const positions = await this.getOpenPositions();
      await this.request("POST", "/positions/close-all");
      return { closed: positions.map((position) => `${position.symbol} (${position.side})`), errors: [] };
    } catch (error) {
      return { closed: [], errors: [error instanceof Error ? error.message : String(error)] };
    }
  }

  async setLeverage(symbol: string, leverage: number): Promise<number> {
    try {
      await this.request("POST", "/account/leverage", {
        data: { symbol: this.toSymbol(symbol), leverage },
      });
    } catch {
      // best-effort only
    }
    return leverage;
  }

  async placeStopLoss(symbol: string, triggerPrice: number): Promise<string> {
    return updateMetaTraderPositionProtection({
      symbol,
      toSymbol: this.toSymbol.bind(this),
      getPositionsRaw: this.getPositionsRaw.bind(this),
      request: this.request.bind(this),
      values: { stopLoss: triggerPrice },
    });
  }

  async placeTakeProfit(symbol: string, triggerPrice: number): Promise<string> {
    return updateMetaTraderPositionProtection({
      symbol,
      toSymbol: this.toSymbol.bind(this),
      getPositionsRaw: this.getPositionsRaw.bind(this),
      request: this.request.bind(this),
      values: { takeProfit: triggerPrice },
    });
  }

  async getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> {
    const response = await this.request<unknown>("GET", "/orders/open", {
      params: { symbol: symbol ? this.toSymbol(symbol) : undefined },
    });
    return this.extractArray<MetaTraderOrderRow>(response, ["orders", "result", "data"]).map(mapMetaTraderOpenOrder);
  }

  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    try {
      const handledSynthetic = await clearMetaTraderSyntheticProtectionOrder({
        orderId,
        symbol,
        toSymbol: this.toSymbol.bind(this),
        request: this.request.bind(this),
      });
      if (handledSynthetic) return true;

      await this.request("DELETE", `/orders/${encodeURIComponent(orderId)}`, {
        params: { symbol: this.toSymbol(symbol) },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("not found")) return false;
      throw error;
    }
  }

  async getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> {
    return buildMetaTraderAlgoOrders(await this.getPositionsRaw(symbol));
  }

  async cancelAlgoOrders(symbol: string): Promise<{ cancelled: string[]; errors: string[] }> {
    try {
      const positions = await this.getPositionsRaw(symbol);
      const cancelled: string[] = [];
      for (const row of positions) {
        const positionId = String(row.positionId || row.ticket || row.id || "");
        if (
          parseMetaTraderNumber(row.stopLoss) > 0 ||
          parseMetaTraderNumber(row.sl) > 0 ||
          parseMetaTraderNumber(row.takeProfit) > 0 ||
          parseMetaTraderNumber(row.tp) > 0
        ) {
          await this.request("POST", "/positions/protection", {
            data: { symbol: this.toSymbol(symbol), positionId, stopLoss: null, takeProfit: null },
          });
          cancelled.push(positionId || this.toSymbol(symbol));
        }
      }
      return { cancelled, errors: [] };
    } catch (error) {
      return { cancelled: [], errors: [error instanceof Error ? error.message : String(error)] };
    }
  }

  async getOrderHistory(symbol?: string, limit: number = 20): Promise<HistoricalOrder[]> {
    const response = await this.request<unknown>("GET", "/orders/history", {
      params: { symbol: symbol ? this.toSymbol(symbol) : undefined, limit },
    });
    return this.extractArray<MetaTraderOrderRow>(response, ["orders", "result", "data"]).map(mapMetaTraderHistoricalOrder);
  }

  async getInstrumentSpecs(symbol: string): Promise<InstrumentSpecs> {
    const response = await this.request<unknown>("GET", `/instruments/${encodeURIComponent(this.toSymbol(symbol))}`);
    const instrument = this.extractObject<MetaTraderInstrumentRow>(response, ["instrument", "result", "data"]);
    const lotSz = parseMetaTraderNumber(instrument.lotStep) || parseMetaTraderNumber(instrument.lotSz) || 0.01;
    const minSz = parseMetaTraderNumber(instrument.minLot) || parseMetaTraderNumber(instrument.minSz) || lotSz;
    const tickSz = parseMetaTraderNumber(instrument.tickSize) || parseMetaTraderNumber(instrument.tickSz) || 0.00001;
    const ctVal = parseMetaTraderNumber(instrument.contractSize) || parseMetaTraderNumber(instrument.ctVal) || 1;

    return {
      ctVal,
      lotSz,
      minSz,
      ctValCcy: instrument.baseCurrency || instrument.profitCurrency || this.toSymbol(symbol).slice(0, 3),
      tickSz,
      qtyDecimals: parseMetaTraderNumber(instrument.qtyDecimals) || countMetaTraderDecimals(lotSz),
      priceDecimals: parseMetaTraderNumber(instrument.priceDecimals) || countMetaTraderDecimals(tickSz),
    };
  }
}
