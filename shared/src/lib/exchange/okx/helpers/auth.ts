import type { OkxHttpClient } from "../client";

export function createOkxSigner(secretKey: string, timestamp: string, method: string, path: string, body?: string): string {
  const CryptoJS = require("crypto-js");
  const message = timestamp + method + path + (body || "");
  return CryptoJS.HmacSHA256(message, secretKey).toString(CryptoJS.enc.Base64);
}

export function buildOkxHeaders(args: {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  simulated: boolean;
  method: string;
  path: string;
  body?: string;
}): Record<string, string> {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const sign = createOkxSigner(args.secretKey, timestamp, args.method, args.path, args.body);
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": args.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": args.passphrase,
  };
  if (args.simulated) headers["x-simulated-trading"] = "1";
  return headers;
}

export function attachOkxProxy(client: OkxHttpClient) {
  return client.interceptors.request.use(async (config) => {
    const { getProxyAgent } = await import("../../../proxy/ProxyFactory.js");
    try {
      const agent = await getProxyAgent();
      if (agent) {
        config.httpsAgent = agent;
        config.httpAgent = agent;
      }
    } catch (err) {
      console.warn("[OKX] ⚠️ Proxy agent not available, using direct connection:", err instanceof Error ? err.message : err);
    }
    return config;
  });
}
