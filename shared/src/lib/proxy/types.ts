/**
 * Proxy Provider Types & Interfaces
 *
 * Factory pattern for proxy providers — easy to add new providers
 * (Webshare, custom VPS, etc.)
 */

export type ProxyAgentLike = {
  [key: string]: unknown;
};

/** Proxy configuration stored in DB */
export interface ProxyConfig {
  /** Whether proxy is enabled for OKX API requests */
  enabled: boolean;
  /** Which provider to use */
  provider: ProxyProviderType;
  /** Custom proxy settings (for "custom" provider) */
  custom?: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
}

export type ProxyProviderType = "webshare" | "custom";

/** A single proxy entry from a provider */
export interface ProxyEntry {
  ip: string;
  port: number;
  username: string;
  password: string;
  valid: boolean;
  country_code: string;
  city_name: string;
}

/** Result from fetching proxy info (for settings display) */
export interface ProxyInfoResult {
  success: boolean;
  credentials?: { username: string; password: string };
  proxies?: ProxyEntry[];
  ipList?: string[];
  ipListsByKey?: string[][];
  allIpList?: string[];
  total?: number;
  validCount?: number;
  error?: string;
  providerName?: string;
  telemetry?: {
    snapshotUpdatedAt?: string;
    cacheExpiresAt?: string;
    previousIps?: string[];
    currentIps?: string[];
    addedIps?: string[];
    removedIps?: string[];
  };
  webshareApiKeys?: {
    total: number;
    activeIndex: number;
    activeKeyMasked: string | null;
  };
}

/** Interface that all proxy providers must implement */
export interface IProxyProvider {
  /** Provider name for display */
  readonly name: string;

  /** Get a proxy URL string (http://user:pass@host:port) */
  getProxyUrl(affinityKey?: string): Promise<string | null>;

  /** Get an HTTPS proxy agent for fetch/axios */
  getProxyAgent(affinityKey?: string): Promise<ProxyAgentLike | null>;

  /** Get proxy info for the settings page (IP list, credentials, etc.) */
  getProxyInfo(): Promise<ProxyInfoResult>;
}
