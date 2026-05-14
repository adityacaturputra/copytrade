/**
 * Webshare.io Proxy Provider
 *
 * Uses Webshare API to fetch rotating/static proxy list.
 * API Docs: https://apidocs.webshare.io/
 */

import { HttpsProxyAgent } from "https-proxy-agent";
import { IProxyProvider, ProxyEntry, ProxyInfoResult } from "./types";

type WebshareApiKeyPoolState = {
  keys: string[];
  activeIndex: number;
  allowedCountryCodes?: string[];
};

let resolveWebshareApiKeyPool: () =>
  | Promise<WebshareApiKeyPoolState>
  | WebshareApiKeyPoolState = () => ({
  keys: [process.env.WEBSHARE_API_KEY || ""].filter(Boolean),
  activeIndex: 0,
  allowedCountryCodes: [],
});

let persistWebshareActiveIndex:
  | ((index: number) => Promise<void> | void)
  | null = null;

export function configureWebshareApiKeyPool(options: {
  resolvePool: () => Promise<WebshareApiKeyPoolState> | WebshareApiKeyPoolState;
  persistActiveIndex?: (index: number) => Promise<void> | void;
}): void {
  resolveWebshareApiKeyPool = options.resolvePool;
  persistWebshareActiveIndex = options.persistActiveIndex || null;
}

/** Cached proxy list to avoid repeated API calls */
let proxyCache: { data: ProxyEntry[]; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let missingKeyWarned = false;
let proxyFetchErrorWarned = false;
let roundRobinCursor = 0;
let blockedCountryCodes = new Set<string>();
let blockedIps = new Set<string>();
let lastSelectedProxyMeta: {
  ip: string;
  countryCode: string;
  city: string;
} | null = null;
let preferredCountryCode: string | null = null;
let preferredIp: string | null = null;

function normalizeIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
}

function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "****";
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

export class WebshareProvider implements IProxyProvider {
  readonly name = "Webshare";

  private async resolveAllowedCountryCodes(): Promise<Set<string>> {
    const pool = await resolveWebshareApiKeyPool();
    const allowed = (pool.allowedCountryCodes || [])
      .map((code) =>
        String(code || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);
    return new Set(allowed);
  }

  /** Fetch proxy list from Webshare API (cached for 5 min) */
  async fetchProxyList(): Promise<ProxyEntry[]> {
    const pool = await resolveWebshareApiKeyPool();
    const apiKeys = (pool.keys || []).map((k) => k.trim()).filter(Boolean);
    const startIndex = normalizeIndex(pool.activeIndex || 0, apiKeys.length);

    if (apiKeys.length === 0) {
      throw new Error("WEBSHARE_API_KEY is not set in environment variables");
    }

    // Return cached if fresh
    if (proxyCache && Date.now() - proxyCache.ts < CACHE_TTL_MS) {
      return proxyCache.data;
    }

    const baseUrl =
      "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100";

    let lastError = "Unknown Webshare API error";
    let json: any = null;
    let successfulIndex = startIndex;

    for (let i = 0; i < apiKeys.length; i++) {
      const keyIndex = normalizeIndex(startIndex + i, apiKeys.length);
      const response = await fetch(baseUrl, {
        headers: {
          Authorization: `Token ${apiKeys[keyIndex]}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        json = await response.json();
        successfulIndex = keyIndex;
        break;
      }

      const text = await response.text();
      lastError = `Webshare API error (${response.status}): ${text}`;
      const usageLimited =
        response.status === 429 ||
        response.status === 401 ||
        response.status === 403 ||
        /rate.?limit|usage|quota/i.test(text);

      if (!usageLimited) {
        throw new Error(lastError);
      }
    }

    if (!json) {
      throw new Error(lastError);
    }

    if (persistWebshareActiveIndex) {
      await persistWebshareActiveIndex(successfulIndex);
    }

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
    const pool = await resolveWebshareApiKeyPool();
    const hasAnyApiKey = (pool.keys || []).some((k) => k.trim().length > 0);
    if (!hasAnyApiKey) {
      if (!missingKeyWarned) {
        console.warn(
          "[WebshareProxy] WEBSHARE_API_KEY is missing. Proxy will be skipped and direct connection will be used.",
        );
        missingKeyWarned = true;
      }
      return null;
    }
    missingKeyWarned = false;

    try {
      const proxies = await this.fetchProxyList();
      const validProxies = proxies.filter((p) => p.valid);
      if (validProxies.length === 0) return null;

      const allowedCountryCodes = await this.resolveAllowedCountryCodes();
      const countryFilteredProxies =
        allowedCountryCodes.size > 0
          ? validProxies.filter((p) =>
              allowedCountryCodes.has((p.country_code || "").toUpperCase()),
            )
          : validProxies;
      const eligibleProxies =
        countryFilteredProxies.length > 0
          ? countryFilteredProxies
          : validProxies;

      const preferredIpMatch =
        preferredIp &&
        eligibleProxies.find(
          (p) =>
            p.ip === preferredIp &&
            !blockedIps.has(p.ip) &&
            !blockedCountryCodes.has((p.country_code || "").toUpperCase()),
        );
      if (preferredIpMatch) {
        lastSelectedProxyMeta = {
          ip: preferredIpMatch.ip,
          countryCode: preferredIpMatch.country_code,
          city: preferredIpMatch.city_name,
        };
        proxyFetchErrorWarned = false;
        return `http://${preferredIpMatch.username}:${preferredIpMatch.password}@${preferredIpMatch.ip}:${preferredIpMatch.port}`;
      }

      const preferredCountryPool = preferredCountryCode
        ? eligibleProxies.filter(
            (p) =>
              !blockedIps.has(p.ip) &&
              (p.country_code || "").toUpperCase() === preferredCountryCode &&
              !blockedCountryCodes.has((p.country_code || "").toUpperCase()),
          )
        : [];

      if (preferredCountryPool.length > 0) {
        const idx = roundRobinCursor % preferredCountryPool.length;
        const selected = preferredCountryPool[idx];
        roundRobinCursor = (roundRobinCursor + 1) % preferredCountryPool.length;
        lastSelectedProxyMeta = {
          ip: selected.ip,
          countryCode: selected.country_code,
          city: selected.city_name,
        };
        proxyFetchErrorWarned = false;
        return `http://${selected.username}:${selected.password}@${selected.ip}:${selected.port}`;
      }

      const preferred = eligibleProxies.filter(
        (p) =>
          !blockedIps.has(p.ip) &&
          !blockedCountryCodes.has((p.country_code || "").toUpperCase()),
      );
      const candidatePool = preferred.length > 0 ? preferred : eligibleProxies;

      const index = roundRobinCursor % candidatePool.length;
      const selectedProxy = candidatePool[index];
      roundRobinCursor = (roundRobinCursor + 1) % candidatePool.length;

      lastSelectedProxyMeta = {
        ip: selectedProxy.ip,
        countryCode: selectedProxy.country_code,
        city: selectedProxy.city_name,
      };

      proxyFetchErrorWarned = false;
      return `http://${selectedProxy.username}:${selectedProxy.password}@${selectedProxy.ip}:${selectedProxy.port}`;
    } catch (error) {
      if (!proxyFetchErrorWarned) {
        console.error(
          "[WebshareProxy] Failed to get proxy URL:",
          error instanceof Error ? error.message : String(error),
        );
        proxyFetchErrorWarned = true;
      }
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
      const pool = await resolveWebshareApiKeyPool();
      const cleaned = (pool.keys || []).map((k) => k.trim()).filter(Boolean);
      const activeIndex = normalizeIndex(
        pool.activeIndex || 0,
        cleaned.length || 1,
      );
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
        webshareApiKeys: {
          total: cleaned.length,
          activeIndex,
          activeKeyMasked: cleaned[activeIndex]
            ? maskApiKey(cleaned[activeIndex])
            : null,
        },
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
    roundRobinCursor = 0;
    blockedCountryCodes = new Set<string>();
    blockedIps = new Set<string>();
    lastSelectedProxyMeta = null;
  }

  markCountryBlocked(countryCode?: string): void {
    const normalized = String(countryCode || "")
      .trim()
      .toUpperCase();
    if (!normalized) return;
    blockedCountryCodes.add(normalized);
    if (preferredCountryCode === normalized) {
      preferredCountryCode = null;
      preferredIp = null;
    }
  }

  getLastSelectedProxyMeta(): {
    ip: string;
    countryCode: string;
    city: string;
  } | null {
    return lastSelectedProxyMeta;
  }

  markCurrentProxySuccessful(): void {
    if (!lastSelectedProxyMeta) return;
    preferredCountryCode = (
      lastSelectedProxyMeta.countryCode || ""
    ).toUpperCase();
    preferredIp = lastSelectedProxyMeta.ip;
  }

  markIpBlocked(ip?: string): void {
    const normalized = String(ip || "").trim();
    if (!normalized) return;
    blockedIps.add(normalized);
    if (preferredIp === normalized) {
      preferredIp = null;
    }
  }
}
