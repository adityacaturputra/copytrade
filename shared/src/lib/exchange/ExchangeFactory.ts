import { ExchangeClient } from "./types";
import { PaperExchange } from "./paper/index";
import { type ExchangeProvider } from "./provider-config";
import {
  buildExchangeCredentials,
  type ExchangeCredentials,
} from "./exchange-credentials";
import { getExchangeProviderRuntime } from "./provider-runtime";

export {
  SUPPORTED_EXCHANGE_PROVIDERS,
  exchangeProviderRequiresCredentials,
  getExchangeProviderConfig,
  getExchangeProviderOptions,
  isPaperExchangeProvider,
  normalizeExchangeProvider,
  validateExchangeCredentials,
} from "./provider-config";
export { buildExchangeCredentials } from "./exchange-credentials";
export {
  exchangeSupportsDirectAlgoCancel,
  getExchangeProviderRuntime,
} from "./provider-runtime";
export type { ExchangeProvider, ExchangeProviderConfig } from "./provider-config";
export type { ExchangeCredentials } from "./exchange-credentials";

/**
 * ExchangeFactory — dynamic factory for exchange clients.
 *
 * All credentials come from the Account model in the database.
 * No more env-var-based exchange configuration.
 *
 * To add a new exchange:
 *   1. Create src/lib/exchange/<Name>Exchange.ts implementing ExchangeClient
 *   2. Register provider metadata in provider-config.ts
 *   3. Register runtime creation in provider-runtime.ts
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
    const runtime = getExchangeProviderRuntime(provider);
    if (!runtime) {
      throw new Error(`Unsupported exchange provider: ${provider}`);
    }
    return runtime.createClient(creds);
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
