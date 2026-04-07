/**
 * Webshare.io Proxy Provider
 *
 * Uses Webshare API to fetch rotating/static proxy list.
 * API Docs: https://apidocs.webshare.io/
 */

import { HttpsProxyAgent } from "https-proxy-agent";
import { IProxyProvider, ProxyEntry, ProxyInfoResult } from "./types";

const WEBSHARE_API_KEY = process.env.WEBSHARE_API_KEY || "";

/** Cached proxy list to avoid repeated API calls */
let proxyCache: { data: ProxyEntry[]; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class WebshareProvider implements IProxyProvider {
  readonly name = "Webshare";

  /** Fetch proxy list from Webshare API (cached for 5 min) */
  async fetchProxyList(): Promise<ProxyEntry[]> {
    if (!WEBSHARE_API_KEY) {
      throw new Error("WEBSHARE_API_KEY is not set in environment variables");
    }

    // Return cached if fresh
    if (proxyCache && Date.now() - proxyCache.ts < CACHE_TTL_MS) {
      return proxyCache.data;
    }

    const baseUrl =
      "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100";

    const response = await fetch(baseUrl, {
      headers: {
        Authorization: `Token ${WEBSHARE_API_KEY}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Webshare API error (${response.status}): ${text}`);
    }

    const json = await response.json();

    const proxies: ProxyEntry[] = (json.results || []).map(
      (p: Record<string, unknown>) => ({
        ip: String(p.proxy_address || ""),
        port: Number(p.port || 80),
        username: String(p.username || ""),
        password: String(p.password || ""),
        valid: Boolean(p.valid),
        country_code: String(p.country_code || ""),
        city_name: String(p.city_name || ""),
      }),
    );

    proxyCache = { data: proxies, ts: Date.now() };
    return proxies;
  }

  async getProxyUrl(): Promise<string | null> {
    try {
      const proxies = await this.fetchProxyList();
      const validProxy = proxies.find((p) => p.valid);
      if (!validProxy) return null;
      return `http://${validProxy.username}:${validProxy.password}@${validProxy.ip}:${validProxy.port}`;
    } catch (error) {
      console.error("[WebshareProxy] Failed to get proxy URL:", error);
      return null;
    }
  }

  async getProxyAgent(): Promise<HttpsProxyAgent<string> | null> {
    const proxyUrl = await this.getProxyUrl();
    if (!proxyUrl) return null;
    return new HttpsProxyAgent(proxyUrl);
  }

  async getProxyInfo(): Promise<ProxyInfoResult> {
    try {
      const proxies = await this.fetchProxyList();
      const validProxies = proxies.filter((p) => p.valid);
      const firstProxy = validProxies[0];

      return {
        success: true,
        credentials: firstProxy
          ? { username: firstProxy.username, password: firstProxy.password }
          : undefined,
        proxies,
        ipList: validProxies.map((p) => p.ip),
        total: proxies.length,
        validCount: validProxies.length,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch proxy info",
      };
    }
  }

  /** Clear the proxy cache */
  clearCache(): void {
    proxyCache = null;
  }
}
