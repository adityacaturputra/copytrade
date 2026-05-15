import { InstrumentSpecs } from "../../types";

export interface BybitCtx {
  apiKey: string;
  secretKey: string;
  client: any;
  specsCache: Map<string, { specs: InstrumentSpecs; ts: number }>;
  specsCacheTtl: number;
  toSymbol(s: string): string;
  parseNumber(v: any, f?: number): number;
  countDecimals(v: number): number;
  formatNum(v: number, d: number): string;
  clampToStep(v: number, s: number, d: number): number;
  signedRequest<T>(m: string, p: string, params?: any): Promise<T>;
  publicRequest<T>(p: string, params?: any): Promise<T>;
  fetchPositions(s?: string): Promise<any[]>;
  getTickerPrice(s: string): Promise<number>;
  getInstrumentSpecs(s: string): Promise<InstrumentSpecs>;
  getOpenPositions(): Promise<any[]>;
  setLeverage(s: string, l: number, t?: "isolated" | "cross"): Promise<number>;
  cancelOrder(id: string, s: string): Promise<boolean>;
  fetchRealtimeOrders(f: "Order" | "StopOrder", s?: string): Promise<any[]>;
  clearTradingStopsForPosition(s: string, idx: number): Promise<void>;
  getAccountMarginMode(): Promise<"isolated" | "cross">;
  resolvePositionMarginType(row: any): Promise<"isolated" | "cross">;
  ensureMarginMode(s: string, l: number, t: "isolated" | "cross"): Promise<void>;
  buildSignedHeaders(t: string, p: string): any;
  buildQueryString(p: any): string;
}
