/**
 * Webshare.io Proxy Provider
 *
 * Uses Webshare API to fetch rotating/static proxy list.
 * API Docs: https://apidocs.webshare.io/
 */

import { createHttpsProxyAgent } from "../core/agent-runtime";
import {
  IProxyProvider,
  ProxyAgentLike,
  ProxyEntry,
  ProxyInfoResult,
} from "../types";

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
type AffinityState = {
  blockedCountryCodes: Set<string>;
  blockedIps: Set<string>;
  cooldownIps: Map<string, number>;
  lastSelectedProxyMeta: {
    ip: string;
    countryCode: string;
    city: string;
  } | null;
  preferredCountryCode: string | null;
  preferredIp: string | null;
};

const DEFAULT_AFFINITY_KEY = "__global__";
let affinityStates = new Map<string, AffinityState>();

function getAffinityState(affinityKey?: string): AffinityState {
  const key = affinityKey || DEFAULT_AFFINITY_KEY;
  const existing = affinityStates.get(key);
  if (existing) return existing;
  const created: AffinityState = {
    blockedCountryCodes: new Set<string>(),
    blockedIps: new Set<string>(),
    cooldownIps: new Map<string, number>(),
    lastSelectedProxyMeta: null,
    preferredCountryCode: null,
    preferredIp: null,
  };
  affinityStates.set(key, created);
  return created;
}

function getAffinityLabel(affinityKey?: string): string {
  return affinityKey || DEFAULT_AFFINITY_KEY;
}

let lastSelectedProxyMeta: {
  ip: string;
  countryCode: string;
  city: string;
} | null = null;
let activeWebshareKeyIndex = 0;
let providerInfoCache: { value: ProxyInfoResult; ts: number } | null = null;
const WEBHARE_PROXY_IP_COOLDOWN_MS = 60 * 60 * 1000;

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

function isUsageLimitedResponse(status: number, text: string): boolean {
  return (
    status === 402 ||
    status === 429 ||
    status === 401 ||
    status === 403 ||
    /rate.?limit|usage|quota|bandwidth limit reached|upgrade to continue using the proxy/i.test(
      text,
    )
  );
}

function isIpCoolingDown(affinity: AffinityState, ip: string): boolean {
  const until = affinity.cooldownIps.get(ip) || 0;
  return until > Date.now();
}

function markIpCooldown(affinity: AffinityState, ip?: string): void {
  const normalized = String(ip || "").trim();
  if (!normalized) return;
  affinity.cooldownIps.set(
    normalized,
    Date.now() + WEBHARE_PROXY_IP_COOLDOWN_MS,
  );
}

function getIpCooldownRemainingMs(
  affinity: AffinityState,
  ip: string,
): number {
  return Math.max(0, (affinity.cooldownIps.get(ip) || 0) - Date.now());
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
        activeWebshareKeyIndex = keyIndex;
        break;
      }

      const text = await response.text();
      lastError = `Webshare API error (${response.status}): ${text}`;
      const usageLimited = isUsageLimitedResponse(response.status, text);

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
    activeWebshareKeyIndex = successfulIndex;

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

  async rotateApiKey(): Promise<boolean> {
    const pool = await resolveWebshareApiKeyPool();
    const apiKeys = (pool.keys || []).map((k) => k.trim()).filter(Boolean);
    if (apiKeys.length <= 1) {
      console.warn(
        "[WebshareProxy] Rotation skipped: only one Webshare API key is configured.",
      );
      return false;
    }
    const nextIndex = normalizeIndex(activeWebshareKeyIndex + 1, apiKeys.length);

    console.warn(
      `[WebshareProxy] Rotating API key ${activeWebshareKeyIndex + 1} -> ${nextIndex + 1}`,
    );

    activeWebshareKeyIndex = nextIndex;
    proxyCache = null;
    affinityStates = new Map<string, AffinityState>();
    lastSelectedProxyMeta = null;

    if (persistWebshareActiveIndex) {
      await persistWebshareActiveIndex(nextIndex);
    }

    return true;
  }

  async tryRotateApiKeyForError(error: unknown): Promise<boolean> {
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined;
    const responseBody =
      typeof error === "object" && error && "responseBody" in error
        ? String((error as { responseBody?: unknown }).responseBody || "")
        : error instanceof Error
          ? error.message
          : String(error || "");

    if (
      typeof status === "number" &&
      isUsageLimitedResponse(status, responseBody)
    ) {
      console.warn(
        `[WebshareProxy] Usage-limited proxy error detected (status=${status}). Trying API key rotation...`,
      );
      return this.rotateApiKey();
    }

    return false;
  }

  async getProxyUrl(affinityKey?: string): Promise<string | null> {
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
      const affinity = getAffinityState(affinityKey);
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
      const nonCoolingProxies = eligibleProxies.filter(
        (p) => !isIpCoolingDown(affinity, p.ip),
      );
      const activeEligibleProxies =
        nonCoolingProxies.length > 0 ? nonCoolingProxies : eligibleProxies;

      const preferredIpMatch =
        affinity.preferredIp &&
        activeEligibleProxies.find(
          (p) =>
            p.ip === affinity.preferredIp &&
            !affinity.blockedIps.has(p.ip) &&
            !affinity.blockedCountryCodes.has((p.country_code || "").toUpperCase()),
        );
      if (preferredIpMatch) {
        affinity.lastSelectedProxyMeta = {
          ip: preferredIpMatch.ip,
          countryCode: preferredIpMatch.country_code,
          city: preferredIpMatch.city_name,
        };
        lastSelectedProxyMeta = affinity.lastSelectedProxyMeta;
        proxyFetchErrorWarned = false;
        return `http://${preferredIpMatch.username}:${preferredIpMatch.password}@${preferredIpMatch.ip}:${preferredIpMatch.port}`;
      }

      const preferredCountryPool = affinity.preferredCountryCode
          ? activeEligibleProxies.filter(
            (p) =>
              !affinity.blockedIps.has(p.ip) &&
              (p.country_code || "").toUpperCase() === affinity.preferredCountryCode &&
              !affinity.blockedCountryCodes.has((p.country_code || "").toUpperCase()),
          )
        : [];

      if (preferredCountryPool.length > 0) {
        const idx = roundRobinCursor % preferredCountryPool.length;
        const selected = preferredCountryPool[idx];
        roundRobinCursor = (roundRobinCursor + 1) % preferredCountryPool.length;
        affinity.lastSelectedProxyMeta = {
          ip: selected.ip,
          countryCode: selected.country_code,
          city: selected.city_name,
        };
        lastSelectedProxyMeta = affinity.lastSelectedProxyMeta;
        proxyFetchErrorWarned = false;
        return `http://${selected.username}:${selected.password}@${selected.ip}:${selected.port}`;
      }

      const preferred = activeEligibleProxies.filter(
        (p) =>
          !affinity.blockedIps.has(p.ip) &&
          !affinity.blockedCountryCodes.has((p.country_code || "").toUpperCase()),
      );
      const candidatePool = preferred.length > 0 ? preferred : activeEligibleProxies;

      const index = roundRobinCursor % candidatePool.length;
      const selectedProxy = candidatePool[index];
      roundRobinCursor = (roundRobinCursor + 1) % candidatePool.length;

      affinity.lastSelectedProxyMeta = {
        ip: selectedProxy.ip,
        countryCode: selectedProxy.country_code,
        city: selectedProxy.city_name,
      };
      lastSelectedProxyMeta = affinity.lastSelectedProxyMeta;

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

  async getProxyAgent(affinityKey?: string): Promise<ProxyAgentLike | null> {
    const proxyUrl = await this.getProxyUrl(affinityKey);
    if (!proxyUrl) return null;
    return createHttpsProxyAgent(proxyUrl);
  }

  async getProxyInfo(): Promise<ProxyInfoResult> {
    try {
      if (providerInfoCache && Date.now() - providerInfoCache.ts < 60_000) {
        return providerInfoCache.value;
      }

      const pool = await resolveWebshareApiKeyPool();
      const cleaned = (pool.keys || []).map((k) => k.trim()).filter(Boolean);
      const activeIndex = normalizeIndex(
        pool.activeIndex || 0,
        cleaned.length || 1,
      );
      const ipListsByKey: string[][] = [];
      let mergedProxies: ProxyEntry[] = [];
      const originalCache = proxyCache;

      for (let index = 0; index < cleaned.length; index++) {
        proxyCache = null;
        if (persistWebshareActiveIndex) {
          await persistWebshareActiveIndex(index);
        }
        activeWebshareKeyIndex = index;
        const jsonProxies = await this.fetchProxyList();
        mergedProxies = mergedProxies.concat(jsonProxies);
        ipListsByKey.push(jsonProxies.filter((p) => p.valid).map((p) => p.ip));
      }

      proxyCache = null;
      if (persistWebshareActiveIndex) {
        await persistWebshareActiveIndex(activeIndex);
      }
      activeWebshareKeyIndex = activeIndex;
      proxyCache = originalCache;

      const dedupedByIp = new Map<string, ProxyEntry>();
      for (const proxy of mergedProxies) {
        if (!dedupedByIp.has(proxy.ip)) {
          dedupedByIp.set(proxy.ip, proxy);
        }
      }

      const proxies = Array.from(dedupedByIp.values());
      const validProxies = proxies.filter((p) => p.valid);
      const firstProxy = validProxies[0];

      const result = {
        success: true,
        credentials: firstProxy
          ? { username: firstProxy.username, password: firstProxy.password }
          : undefined,
        proxies,
        ipList: validProxies.map((p) => p.ip),
        ipListsByKey,
        allIpList: validProxies.map((p) => p.ip),
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
      providerInfoCache = { value: result, ts: Date.now() };
      return result;
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
    providerInfoCache = null;
    affinityStates = new Map<string, AffinityState>();
    roundRobinCursor = 0;
    lastSelectedProxyMeta = null;
  }

  markCountryBlocked(countryCode?: string, affinityKey?: string): void {
    const affinity = getAffinityState(affinityKey);
    const normalized = String(countryCode || "")
      .trim()
      .toUpperCase();
    if (!normalized) return;
    affinity.blockedCountryCodes.add(normalized);
    if (affinity.preferredCountryCode === normalized) {
      affinity.preferredCountryCode = null;
      affinity.preferredIp = null;
    }
  }

  getLastSelectedProxyMeta(affinityKey?: string): {
    ip: string;
    countryCode: string;
    city: string;
  } | null {
    return getAffinityState(affinityKey).lastSelectedProxyMeta;
  }

  markCurrentProxySuccessful(affinityKey?: string): void {
    const affinity = getAffinityState(affinityKey);
    if (!affinity.lastSelectedProxyMeta) return;
    affinity.preferredCountryCode = (
      affinity.lastSelectedProxyMeta.countryCode || ""
    ).toUpperCase();
    affinity.preferredIp = affinity.lastSelectedProxyMeta.ip;
  }

  markIpBlocked(ip?: string, affinityKey?: string): void {
    const affinity = getAffinityState(affinityKey);
    const normalized = String(ip || "").trim();
    if (!normalized) return;
    affinity.blockedIps.add(normalized);
    markIpCooldown(affinity, normalized);
    if (affinity.preferredIp === normalized) {
      affinity.preferredIp = null;
    }
  }
}
