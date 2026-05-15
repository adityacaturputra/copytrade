import axios, { type AxiosInstance } from "axios";
import { getProxyAgent } from "../../proxy/ProxyFactory";
import { buildHttpErrorMessage } from "../../http/error";
import type { HttpMethod } from "./types";

export function createMetaTraderClient(baseUrl: string): AxiosInstance {
  const client = axios.create({
    baseURL: baseUrl.replace(/\/+$/, ""),
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.request.use(async (requestConfig) => {
    try {
      const agent = await getProxyAgent();
      if (agent) {
        requestConfig.httpsAgent = agent;
        requestConfig.httpAgent = agent;
      }
    } catch (error) {
      console.warn(
        "[MetaTrader] Proxy agent not available, using direct connection:",
        error instanceof Error ? error.message : error,
      );
    }
    return requestConfig;
  });

  return client;
}

export function buildMetaTraderHeaders(input: {
  login: string;
  password: string;
  server: string;
  platform: string;
  bridgeToken?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-MT-LOGIN": input.login,
    "X-MT-PASSWORD": input.password,
    "X-MT-SERVER": input.server,
    "X-MT-PLATFORM": input.platform,
  };

  if (input.bridgeToken) headers.Authorization = `Bearer ${input.bridgeToken}`;
  return headers;
}

export async function metaTraderRequest<T>(input: {
  client: AxiosInstance;
  headers: Record<string, string>;
  method: HttpMethod;
  path: string;
  options?: {
    params?: Record<string, string | number | boolean | undefined>;
    data?: Record<string, unknown>;
  };
}): Promise<T> {
  try {
    const response = await input.client.request<T>({
      method: input.method,
      url: input.path,
      params: input.options?.params,
      data: input.options?.data,
      headers: input.headers,
    });
    return response.data;
  } catch (error) {
    throw new Error(
      buildHttpErrorMessage(`[MetaTrader] ${input.method} ${input.path} failed`, error, {
        payload: {
          params: input.options?.params,
          data: input.options?.data,
        },
      }),
    );
  }
}
