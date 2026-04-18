import { ExchangeClient } from "./types";
import { MexcExchange } from "./MexcExchange";
import { OkxExchange } from "./OkxExchange";
import { PaperExchange } from "./PaperExchange";
import { BinanceExchange } from "./BinanceExchange";
import { BybitExchange } from "./BybitExchange";

export const SUPPORTED_EXCHANGE_PROVIDERS = [
  "mexc",
  "okx",
  "binance",
  "bybit",
  "paper",
] as const;

export type ExchangeProvider =
  (typeof SUPPORTED_EXCHANGE_PROVIDERS)[number];

export function normalizeExchangeProvider(
  value: unknown,
): ExchangeProvider | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (SUPPORTED_EXCHANGE_PROVIDERS as readonly string[]).includes(
    normalized,
  )
    ? (normalized as ExchangeProvider)
    : null;
}

/**
 * ExchangeCredentials — per-account exchange configuration stored in DB.
 */
export interface ExchangeCredentials {
  provider: ExchangeProvider;
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  simulated?: boolean;
  [key: string]: unknown;
}

/**
 * ExchangeFactory — dynamic factory for exchange clients.
 *
 * All credentials come from the Account model in the database.
 * No more env-var-based exchange configuration.
 *
 * To add a new exchange:
 *   1. Create src/lib/exchange/<Name>Exchange.ts implementing ExchangeClient
 *   2. Add the provider type above
 *   3. Add a case in createClient()
 */
export class ExchangeFactory {
  /**
   * Get an exchange client using account-specific credentials.
   * Credentials come from the Account model in DB.
   */
  static getClientForAccount(credentials: ExchangeCredentials): ExchangeClient {
    return ExchangeFactory.createClient(credentials.provider, credentials);
  }

  /**
   * Get a paper trading client (no credentials needed).
   */
  static getPaperClient(): ExchangeClient {
    return new PaperExchange();
  }

  private static createClient(
    provider: ExchangeProvider,
    creds?: ExchangeCredentials,
  ): ExchangeClient {
    switch (provider) {
      case "okx": {
        const apiKey = creds?.apiKey;
        const secretKey = creds?.secretKey;
        const passphrase = creds?.passphrase;
        if (!apiKey || !secretKey || !passphrase) {
          throw new Error(
            "OKX apiKey, secretKey, and passphrase must be configured in account settings",
          );
        }
        const simulated = creds?.simulated ?? false;
        return new OkxExchange(apiKey, secretKey, passphrase, simulated);
      }

      case "mexc":
      {
        const apiKey = creds?.apiKey;
        const secretKey = creds?.secretKey;
        if (!apiKey || !secretKey) {
          throw new Error(
            "MEXC apiKey and secretKey must be configured in account settings",
          );
        }
        return new MexcExchange(apiKey, secretKey);
      }

      case "binance": {
        const apiKey = creds?.apiKey;
        const secretKey = creds?.secretKey;
        if (!apiKey || !secretKey) {
          throw new Error(
            "Binance apiKey and secretKey must be configured in account settings",
          );
        }
        const simulated = creds?.simulated ?? false;
        return new BinanceExchange(apiKey, secretKey, simulated);
      }

      case "bybit": {
        const apiKey = creds?.apiKey;
        const secretKey = creds?.secretKey;
        if (!apiKey || !secretKey) {
          throw new Error(
            "Bybit apiKey and secretKey must be configured in account settings",
          );
        }
        const simulated = creds?.simulated ?? false;
        return new BybitExchange(apiKey, secretKey, simulated);
      }

      default: {
        return new PaperExchange();
      }
    }
  }

  /**
   * @deprecated Use getClientForAccount() with per-account credentials.
   * Legacy fallback — returns paper exchange.
   * Used by agent/tools.ts, mexc-api.ts, risk.ts which haven't been
   * migrated to multi-account yet.
   */
  static getClient(): ExchangeClient {
    console.warn(
      "[ExchangeFactory] getClient() is deprecated — using paper exchange as fallback. " +
        "Migrate caller to getClientForAccount().",
    );
    return new PaperExchange();
  }

  /** @deprecated Provider name is now per-account, not global */
  static getProviderName(): string {
    return "paper";
  }

  /** No-op — factory now always reads credentials dynamically */
  static reset(): void {}
}
