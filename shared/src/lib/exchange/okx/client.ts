import axios, { AxiosInstance } from "axios";
import CryptoJS from "crypto-js";
import { getProxyAgent } from "../../proxy/ProxyFactory";

export function getOkxBaseUrl(): string {
  return process.env.OKX_PROXY_URL || process.env.OKX_BASE_URL || "https://www.okx.com";
}

export function createOkxHttpClient() {
  const client = axios.create({
    baseURL: getOkxBaseUrl(),
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.request.use(async (config) => {
    try {
      const agent = await getProxyAgent();
      if (agent) {
        config.httpsAgent = agent;
        config.httpAgent = agent;
      }
    } catch (err) {
      console.warn(
        "[OKX] ⚠️ Proxy agent not available, using direct connection:",
        err instanceof Error ? err.message : err,
      );
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => {
      const data = response.data;
      if (data && data.code !== undefined && data.code !== "0") {
        const method = (response.config.method || "GET").toUpperCase();
        console.error(
          `[OKX] ❌ ${method} ${response.config.url}\n` +
            `       ➡️  Request body: ${response.config.data || "(no body)"}\n` +
            `       ⬅️  Response (${response.status}): ${JSON.stringify(data)}`,
        );
      }
      return response;
    },
    (error) => {
      if (axios.isAxiosError(error) && error.response) {
        const method = (error.config?.method || "GET").toUpperCase();
        console.error(
          `[OKX] ❌ ${method} ${error.config?.url} — HTTP ${error.response.status}\n` +
            `       ➡️  Request body: ${error.config?.data || "(no body)"}\n` +
            `       ⬅️  Response body: ${JSON.stringify(error.response.data)}`,
        );
      }
      return Promise.reject(error);
    },
  );

  return client;
}

export function signOkxRequest(
  secretKey: string,
  timestamp: string,
  method: string,
  path: string,
  body?: string,
): string {
  const message = timestamp + method + path + (body || "");
  return CryptoJS.HmacSHA256(message, secretKey).toString(CryptoJS.enc.Base64);
}

export function getOkxTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export function buildOkxAuthHeaders({
  apiKey,
  secretKey,
  passphrase,
  simulated,
  method,
  path,
  body,
}: {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  simulated: boolean;
  method: string;
  path: string;
  body?: string;
}): Record<string, string> {
  const timestamp = getOkxTimestamp();
  const sign = signOkxRequest(secretKey, timestamp, method, path, body);
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": passphrase,
  };
  if (simulated) headers["x-simulated-trading"] = "1";
  return headers;
}

export type OkxHttpClient = AxiosInstance;
