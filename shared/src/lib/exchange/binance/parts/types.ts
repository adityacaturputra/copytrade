import { InstrumentSpecs } from "../../types";
import { AxiosInstance } from "axios";

export interface BinanceInstrumentSpecs extends InstrumentSpecs {
  marketLotSz: number;
  marketMinSz: number;
  marketQtyDecimals: number;
}

export interface BinanceCtx {
  apiKey: string;
  secretKey: string;
  client: AxiosInstance;
  specsCache: Map<string, { specs: BinanceInstrumentSpecs; ts: number }>;
  specsCacheTtl: number;
  toSymbol(s: string): string;
  parseNumber(v: any, f?: number): number;
  countDecimals(v: number): number;
  formatNum(v: number, d: number): string;
  clampToStep(v: number, s: number, d: number): number;
  signedRequest<T>(m: string, p: string, params?: any): Promise<T>;
  publicRequest<T>(p: string, params?: any): Promise<T>;
  getInstrumentSpecs(s: string): Promise<BinanceInstrumentSpecs>;
  getOpenPositions(): Promise<any[]>;
  getQuantityRule(specs: BinanceInstrumentSpecs, type: string): { step: number; min: number; decimals: number };
  buildSignedQuery(p: any): string;
}
