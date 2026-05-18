import axios from "axios";
import { buildHttpErrorMessage, getHttpErrorDetails } from "../../../http/error";
import {
  getCurrentProxyMeta,
  markCurrentProxyCountryBlocked,
  markCurrentProxyIpBlocked,
  markCurrentProxySuccessful,
  rotateCurrentProxyCredentialForError,
} from "../../../proxy/ProxyFactory";
import { BybitCtx } from "./types";

const COUNTRY_BLOCK_MAX_RETRIES = 10;

function stringifyProxyMeta(
  meta: Awaited<ReturnType<typeof getCurrentProxyMeta>>,
): string {
  if (!meta) return "proxy=none";

  const parts = [
    `proxyProvider=${meta.provider || "unknown"}`,
    `proxyIp=${meta.ip || "unknown"}`,
    `proxyCountry=${meta.countryCode || "unknown"}`,
  ];

  if (meta.city) {
    parts.push(`proxyCity=${meta.city}`);
  }

  return parts.join(" ");
}

async function enrichBybitError(
  ctx: BybitCtx,
  error: unknown,
  method: "GET" | "POST",
  path: string,
  payload: Record<string, any>,
): Promise<Error> {
  const proxyMeta = await getCurrentProxyMeta(ctx.proxyAffinityKey);
  const details = getHttpErrorDetails(error, {
    messageKeys: ["retMsg", "message", "msg", "error", "error_description"],
    codeKeys: ["retCode", "code", "sCode", "errCode"],
  });

  const message = buildHttpErrorMessage(`[Bybit] ${method} ${path} failed`, error, {
    payload,
    includeResponseBody: true,
    messageKeys: ["retMsg", "message", "msg", "error", "error_description"],
    codeKeys: ["retCode", "code", "sCode", "errCode"],
  });

  const wrapped = new Error(`${message} | ${stringifyProxyMeta(proxyMeta)}`);
  Object.assign(wrapped, {
    status: details.status,
    code: details.code,
    responseBody: details.responseBody,
    proxyMeta,
    cause: error,
  });
  return wrapped;
}

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
      await markCurrentProxySuccessful(ctx.proxyAffinityKey);
      return response.data.result;
    } catch (error) {
      if (await rotateCurrentProxyCredentialForError(error, ctx.proxyAffinityKey)) {
        continue;
      }
      const errorText = extractBybitErrorText(error);
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        const dataText = JSON.stringify(error.response?.data || "").toLowerCase();
        if (dataText.includes("cloudfront") || dataText.includes("block access")) {
          await markCurrentProxyCountryBlocked(ctx.proxyAffinityKey);
          continue;
        }
        if (dataText.includes("unmatched") || dataText.includes("ip whitelist")) {
          await markCurrentProxyIpBlocked(ctx.proxyAffinityKey);
          continue;
        }
      }
      if (errorText.includes("cloudfront") || errorText.includes("block access")) {
        await markCurrentProxyCountryBlocked(ctx.proxyAffinityKey);
        continue;
      }
      if (errorText.includes("unmatched") || errorText.includes("ip whitelist") || errorText.includes("bound ip")) {
        await markCurrentProxyIpBlocked(ctx.proxyAffinityKey);
        continue;
      }
      if (attempt >= COUNTRY_BLOCK_MAX_RETRIES) {
        throw await enrichBybitError(ctx, error, method, path, payload);
      }
      throw await enrichBybitError(ctx, error, method, path, payload);
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
      await markCurrentProxySuccessful(ctx.proxyAffinityKey);
      return response.data.result;
    } catch (error) {
      if (await rotateCurrentProxyCredentialForError(error, ctx.proxyAffinityKey)) {
        continue;
      }
      const errorText = extractBybitErrorText(error);
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        const dataText = JSON.stringify(error.response?.data || "").toLowerCase();
        if (dataText.includes("cloudfront") || dataText.includes("block access")) {
          await markCurrentProxyCountryBlocked(ctx.proxyAffinityKey);
          continue;
        }
        if (dataText.includes("unmatched") || dataText.includes("ip whitelist")) {
          await markCurrentProxyIpBlocked(ctx.proxyAffinityKey);
          continue;
        }
      }
      if (errorText.includes("cloudfront") || errorText.includes("block access")) {
        await markCurrentProxyCountryBlocked(ctx.proxyAffinityKey);
        continue;
      }
      if (
        errorText.includes("unmatched") ||
        errorText.includes("ip whitelist") ||
        errorText.includes("bound ip")
      ) {
        await markCurrentProxyIpBlocked(ctx.proxyAffinityKey);
        continue;
      }
      if (attempt >= COUNTRY_BLOCK_MAX_RETRIES) {
        throw await enrichBybitError(ctx, error, "GET", path, params);
      }
      throw await enrichBybitError(ctx, error, "GET", path, params);
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
