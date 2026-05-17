import axios from "axios";
import { getCurrentProxyMeta, markCurrentProxyCountryBlocked, markCurrentProxyIpBlocked, markCurrentProxySuccessful } from "../../../proxy/ProxyFactory";
import { BybitCtx } from "./types";

const COUNTRY_BLOCK_MAX_RETRIES = 10;

export async function bybitRequest(ctx: BybitCtx, method: "GET" | "POST", path: string, payload: Record<string, any> = {}): Promise<any> {
  for (let attempt = 1; attempt <= COUNTRY_BLOCK_MAX_RETRIES; attempt++) {
    try {
      const timestamp = Date.now().toString();
      let response;
      if (method === "GET") {
        const query = ctx.buildQueryString(payload);
        const headers = ctx.buildSignedHeaders(timestamp, query);
        response = await ctx.client.get(query ? `${path}?${query}` : path, { headers });
      } else {
        const body = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined && v !== null));
        const serialized = JSON.stringify(body);
        const headers = ctx.buildSignedHeaders(timestamp, serialized);
        response = await ctx.client.post(path, body, { headers });
      }
      if (response.data.retCode !== 0) throw new Error(response.data.retMsg || "Unknown Bybit error");
      await markCurrentProxySuccessful();
      return response.data.result;
    } catch (error) {
      if (attempt >= COUNTRY_BLOCK_MAX_RETRIES) throw error;
      const errorText = extractBybitErrorText(error);
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        const dataText = JSON.stringify(error.response?.data || "").toLowerCase();
        if (dataText.includes("cloudfront") || dataText.includes("block access")) {
          await markCurrentProxyCountryBlocked();
          continue;
        }
        if (dataText.includes("unmatched") || dataText.includes("ip whitelist")) {
          await markCurrentProxyIpBlocked();
          continue;
        }
      }
      if (errorText.includes("cloudfront") || errorText.includes("block access")) {
        await markCurrentProxyCountryBlocked();
        continue;
      }
      if (errorText.includes("unmatched") || errorText.includes("ip whitelist") || errorText.includes("bound ip")) {
        await markCurrentProxyIpBlocked();
        continue;
      }
      throw error;
    }
  }
}

export async function bybitPublicRequest(
  ctx: BybitCtx,
  path: string,
  params: Record<string, any> = {},
): Promise<any> {
  for (let attempt = 1; attempt <= COUNTRY_BLOCK_MAX_RETRIES; attempt++) {
    try {
      const response = await ctx.client.get(path, { params });
      if (response.data.retCode !== 0) {
        throw new Error(response.data.retMsg || "Unknown Bybit error");
      }
      await markCurrentProxySuccessful();
      return response.data.result;
    } catch (error) {
      if (attempt >= COUNTRY_BLOCK_MAX_RETRIES) throw error;
      const errorText = extractBybitErrorText(error);
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        const dataText = JSON.stringify(error.response?.data || "").toLowerCase();
        if (dataText.includes("cloudfront") || dataText.includes("block access")) {
          await markCurrentProxyCountryBlocked();
          continue;
        }
        if (dataText.includes("unmatched") || dataText.includes("ip whitelist")) {
          await markCurrentProxyIpBlocked();
          continue;
        }
      }
      if (errorText.includes("cloudfront") || errorText.includes("block access")) {
        await markCurrentProxyCountryBlocked();
        continue;
      }
      if (
        errorText.includes("unmatched") ||
        errorText.includes("ip whitelist") ||
        errorText.includes("bound ip")
      ) {
        await markCurrentProxyIpBlocked();
        continue;
      }
      throw error;
    }
  }
}

function extractBybitErrorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return `${error.message} ${JSON.stringify(error.response?.data || "")}`.toLowerCase();
  }
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return String(error || "").toLowerCase();
}
