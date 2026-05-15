import axios, { type AxiosInstance } from "axios";
import { getProxyAgent } from "../../../proxy/ProxyFactory";
import { getOkxBaseUrl } from "./utils";

export function createOkxHttpClient(): AxiosInstance {
  const client = axios.create({
    baseURL: getOkxBaseUrl(),
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
    },
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
