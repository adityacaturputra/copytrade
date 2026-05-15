import { InstrumentSpecs } from "../../types";
import { AxiosInstance } from "axios";

export interface OkxCtx {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  simulated: boolean;
  client: AxiosInstance;
  specsCache: Map<string, { specs: InstrumentSpecs; ts: number }>;
  specsCacheTtl: number;
  authHeaders(method: string, path: string, body?: string): Record<string, string>;
  toOkxSymbol(s: string): string;
  fromOkxSymbol(s: string): string;
  getPositionMode(): Promise<"long_short_mode" | "net_mode">;
  getInstrumentSpecs(s: string): Promise<InstrumentSpecs>;
  getOpenPositions(): Promise<any[]>;
}
