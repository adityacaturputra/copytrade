import type { AxiosInstance } from "axios";
import type {
  AccountInfo,
  AlgoOrderInfo,
  ExchangeClient,
  HistoricalOrder,
  InstrumentSpecs,
  KlineData,
  OpenOrderInfo,
  OrderParams,
  OrderResult,
  PositionInfo,
} from "../../types";
import {
  cancelOkxAlgoOrders,
  cancelOkxOrder,
  getOkxAccountInfo,
  getOkxAlgoOrders,
  getOkxInstrumentSpecs,
  getOkxKlines,
  getOkxOpenOrders,
  getOkxOpenPositions,
  getOkxOrderHistory,
  getOkxTickerPrice,
  placeOkxProtectionOrder,
  setOkxLeverage,
} from "../helpers";
import {
  ensureOkxAccountConfigured,
  setOkxAccountMode,
  setOkxPositionMode,
} from "./account";
import { createOkxHttpClient } from "./client";
import { closeAllOkxPositions, closeOkxPosition } from "./close";
import {
  type OkxValidatedInstrument,
  validateOkxInstrument,
} from "./instruments";
import { placeOkxOrder, retryOkxOrderAfterAccountFix } from "./orders";
import { getOkxPositionMode } from "./position-mode";
import {
  buildOkxAuthHeaders,
  buildOkxPayloadError,
  fromOkxSwapSymbol,
  isRetryableOkxAccountConfigError,
  roundOkxQuantityToLotSize,
  toOkxSwapSymbol,
} from "./utils";

export class OkxExchange implements ExchangeClient {
  readonly name = "okx";
  private static SPECS_CACHE_TTL = 30 * 60 * 1000;
  private static ACCOUNT_CONFIG_TTL = 60 * 1000;
  private specsCache = new Map<string, { specs: InstrumentSpecs; ts: number }>();
  private accountConfigCache?: { posMode: "long_short_mode" | "net_mode"; ts: number };
  private client: AxiosInstance;

  constructor(
    private apiKey: string,
    private secretKey: string,
    private passphrase: string,
    private simulated: boolean = false,
  ) {
    this.client = createOkxHttpClient();
  }

  private authHeaders(method: string, path: string, body?: string): Record<string, string> {
    return buildOkxAuthHeaders({
      apiKey: this.apiKey,
      secretKey: this.secretKey,
      passphrase: this.passphrase,
      simulated: this.simulated,
      method,
      path,
      body,
    });
  }

  private buildPayloadError(message: string, payload?: string | Record<string, string>): Error {
    return buildOkxPayloadError(message, payload);
  }

  private isAccountConfigRetryable(code?: string, message?: string): boolean {
    return isRetryableOkxAccountConfigError(code, message);
  }

  private async getPositionMode(forceRefresh: boolean = false): Promise<"long_short_mode" | "net_mode"> {
    return getOkxPositionMode({
      client: this.client,
      authHeaders: this.authHeaders.bind(this),
      forceRefresh,
      cache: this.accountConfigCache,
      cacheTtl: OkxExchange.ACCOUNT_CONFIG_TTL,
      setCache: (cache) => {
        this.accountConfigCache = cache;
      },
    });
  }

  private toOkxSymbol(symbol: string): string { return toOkxSwapSymbol(symbol); }
  private fromOkxSymbol(instId: string): string { return fromOkxSwapSymbol(instId); }
  private roundToLotSize(quantity: number, lotSz: string, minSz: string): number { return roundOkxQuantityToLotSize(quantity, lotSz, minSz); }

  private getHelperContext() {
    return {
      client: this.client,
      authHeaders: this.authHeaders.bind(this),
      toOkxSymbol: this.toOkxSymbol.bind(this),
      fromOkxSymbol: this.fromOkxSymbol.bind(this),
      getPositionMode: this.getPositionMode.bind(this),
      specsCache: this.specsCache,
      specsCacheTtl: OkxExchange.SPECS_CACHE_TTL,
    };
  }

  async validateInstrument(symbol: string): Promise<OkxValidatedInstrument> {
    return validateOkxInstrument(this.client, symbol, this.toOkxSymbol.bind(this));
  }

  async setAccountMode(accountMode: "1" | "2" | "3" | "4" = "2"): Promise<void> {
    return setOkxAccountMode({ client: this.client, authHeaders: this.authHeaders.bind(this), accountMode });
  }

  async setPositionMode(_symbol: string, positionMode: "long_short_mode" | "net_mode" = "long_short_mode"): Promise<void> {
    return setOkxPositionMode({
      client: this.client,
      authHeaders: this.authHeaders.bind(this),
      positionMode,
      setCachedMode: (mode) => {
        this.accountConfigCache = { posMode: mode, ts: Date.now() };
      },
    });
  }

  async ensureAccountConfigured(symbol: string): Promise<void> {
    return ensureOkxAccountConfigured({
      symbol,
      setAccountMode: this.setAccountMode.bind(this),
      setPositionMode: this.setPositionMode.bind(this),
    });
  }

  async getAccountInfo(): Promise<AccountInfo> { return getOkxAccountInfo(this.getHelperContext()); }
  async getTickerPrice(symbol: string): Promise<number> { return getOkxTickerPrice(this.getHelperContext(), symbol); }
  async getKlines(symbol: string, interval: string = "1H", limit: number = 24): Promise<KlineData[]> { return getOkxKlines(this.getHelperContext(), symbol, interval, limit); }
  async getOpenPositions(): Promise<PositionInfo[]> { return getOkxOpenPositions(this.getHelperContext()); }
  async setLeverage(symbol: string, leverage: number, marginType: "isolated" | "cross" = "isolated", side?: "BUY" | "SELL"): Promise<number> { return setOkxLeverage(this.getHelperContext(), symbol, leverage, marginType, side); }

  async placeOrder(orderParams: OrderParams): Promise<OrderResult> {
    return placeOkxOrder({
      client: this.client,
      orderParams,
      authHeaders: this.authHeaders.bind(this),
      isAccountConfigRetryable: this.isAccountConfigRetryable.bind(this),
      buildPayloadError: this.buildPayloadError.bind(this),
      toOkxSymbol: this.toOkxSymbol.bind(this),
      getPositionMode: this.getPositionMode.bind(this),
      validateInstrument: this.validateInstrument.bind(this),
      roundToLotSize: this.roundToLotSize.bind(this),
      setLeverage: this.setLeverage.bind(this),
      getTickerPrice: this.getTickerPrice.bind(this),
      handleAccountConfigRetry: this.handle51010AndRetry.bind(this),
    });
  }

  private async handle51010AndRetry(orderBody: Record<string, string>, orderParams: OrderParams, path: string): Promise<OrderResult> {
    return retryOkxOrderAfterAccountFix({
      client: this.client,
      orderBody,
      orderParams,
      path,
      authHeaders: this.authHeaders.bind(this),
      buildPayloadError: this.buildPayloadError.bind(this),
      ensureAccountConfigured: this.ensureAccountConfigured.bind(this),
      setLeverage: this.setLeverage.bind(this),
      getTickerPrice: this.getTickerPrice.bind(this),
    });
  }

  async closePosition(symbol: string, positionId?: string, quantity?: number): Promise<void> {
    return closeOkxPosition({
      client: this.client,
      symbol,
      positionId,
      quantity,
      authHeaders: this.authHeaders.bind(this),
      toOkxSymbol: this.toOkxSymbol.bind(this),
      getPositionMode: this.getPositionMode.bind(this),
      getOpenPositions: this.getOpenPositions.bind(this),
    });
  }

  async closeAllPositions(): Promise<{ closed: string[]; errors: string[] }> {
    return closeAllOkxPositions({ getOpenPositions: this.getOpenPositions.bind(this), closePosition: this.closePosition.bind(this) });
  }

  async placeStopLoss(symbol: string, triggerPrice: number, executePrice: number, side: "BUY" | "SELL", quantity: number): Promise<string> { return placeOkxProtectionOrder(this.getHelperContext(), "sl", symbol, triggerPrice, executePrice, side, quantity); }
  async placeTakeProfit(symbol: string, triggerPrice: number, executePrice: number, side: "BUY" | "SELL", quantity: number): Promise<string> { return placeOkxProtectionOrder(this.getHelperContext(), "tp", symbol, triggerPrice, executePrice, side, quantity); }
  async getOpenOrders(symbol?: string): Promise<OpenOrderInfo[]> { return getOkxOpenOrders(this.getHelperContext(), symbol); }
  async cancelOrder(orderId: string, symbol: string): Promise<boolean> { return cancelOkxOrder(this.getHelperContext(), orderId, symbol); }
  async getAlgoOrders(symbol?: string): Promise<AlgoOrderInfo[]> { return getOkxAlgoOrders(this.getHelperContext(), symbol); }
  async cancelAlgoOrders(symbol: string): Promise<{ cancelled: string[]; errors: string[] }> { return cancelOkxAlgoOrders(this.getHelperContext(), symbol); }
  async getOrderHistory(symbol?: string, limit: number = 20): Promise<HistoricalOrder[]> { return getOkxOrderHistory(this.getHelperContext(), symbol, limit); }
  async getInstrumentSpecs(symbol: string): Promise<InstrumentSpecs> { return getOkxInstrumentSpecs(this.getHelperContext(), symbol); }
}
