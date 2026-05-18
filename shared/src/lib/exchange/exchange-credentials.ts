import { type ExchangeProvider, normalizeExchangeProvider } from "./provider-config";

/**
 * ExchangeCredentials — per-account exchange configuration stored in DB.
 */
export interface ExchangeCredentials {
  provider: ExchangeProvider;
  proxyAffinityKey?: string;
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  simulated?: boolean;
  baseUrl?: string;
  login?: string;
  password?: string;
  server?: string;
  platform?: string;
  bridgeToken?: string;
  [key: string]: unknown;
}

export type ExchangeCredentialValues = Omit<ExchangeCredentials, "provider">;

export function buildExchangeCredentials(
  providerValue: unknown,
  exchangeData?: Record<string, unknown> | null,
  options?: { proxyAffinityKey?: string },
): ExchangeCredentials | null {
  const provider = normalizeExchangeProvider(providerValue);
  if (!provider) return null;

  const data = exchangeData || {};

  return {
    ...data,
    provider,
    proxyAffinityKey:
      typeof options?.proxyAffinityKey === "string" &&
      options.proxyAffinityKey.trim().length > 0
        ? options.proxyAffinityKey.trim()
        : undefined,
    apiKey: typeof data.apiKey === "string" ? data.apiKey : undefined,
    secretKey: typeof data.secretKey === "string" ? data.secretKey : undefined,
    passphrase:
      typeof data.passphrase === "string" ? data.passphrase : undefined,
    simulated:
      typeof data.simulated === "boolean" ? data.simulated : undefined,
    baseUrl: typeof data.baseUrl === "string" ? data.baseUrl : undefined,
    login: typeof data.login === "string" ? data.login : undefined,
    password: typeof data.password === "string" ? data.password : undefined,
    server: typeof data.server === "string" ? data.server : undefined,
    platform: typeof data.platform === "string" ? data.platform : undefined,
    bridgeToken:
      typeof data.bridgeToken === "string" ? data.bridgeToken : undefined,
  };
}
