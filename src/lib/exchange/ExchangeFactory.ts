import { ExchangeClient } from "./types";
import { MexcExchange } from "./MexcExchange";
import { OkxExchange } from "./OkxExchange";
import { PaperExchange } from "./PaperExchange";

export type ExchangeProvider = "mexc" | "okx" | "paper";

/**
 * ExchangeFactory — singleton factory for exchange clients.
 *
 * Mirrors the AIFactory pattern:
 *   - Reads EXCHANGE_PROVIDER from env (default: "mexc")
 *   - Lazy-initialises the correct adapter
 *   - Consumers call ExchangeFactory.getClient() and get a typed ExchangeClient
 *
 * To add a new exchange:
 *   1. Create src/lib/exchange/<Name>Exchange.ts implementing ExchangeClient
 *   2. Add the provider type above
 *   3. Add a case in createClient()
 *   4. Add env vars to .env.example
 */
export class ExchangeFactory {
  private static instance: ExchangeClient | null = null;

  static getClient(provider?: ExchangeProvider): ExchangeClient {
    const selectedProvider =
      provider || (process.env.EXCHANGE_PROVIDER as ExchangeProvider) || "mexc";

    // Re-create if provider changed
    if (
      ExchangeFactory.instance &&
      ExchangeFactory.instance.name === selectedProvider
    ) {
      return ExchangeFactory.instance;
    }

    const client = ExchangeFactory.createClient(selectedProvider);
    ExchangeFactory.instance = client;
    return client;
  }

  private static createClient(provider: ExchangeProvider): ExchangeClient {
    switch (provider) {
      case "paper": {
        return new PaperExchange();
      }

      case "okx": {
        const apiKey = process.env.OKX_API_KEY;
        const secretKey = process.env.OKX_SECRET_KEY;
        const passphrase = process.env.OKX_PASSPHRASE;
        if (!apiKey || !secretKey || !passphrase) {
          throw new Error(
            "OKX_API_KEY, OKX_SECRET_KEY, and OKX_PASSPHRASE must be configured",
          );
        }
        const simulated = process.env.OKX_SIMULATED === "true";
        return new OkxExchange(apiKey, secretKey, passphrase, simulated);
      }

      case "mexc":
      default: {
        const apiKey = process.env.MEXC_API_KEY;
        const secretKey = process.env.MEXC_SECRET_KEY;
        if (!apiKey || !secretKey) {
          throw new Error(
            "MEXC_API_KEY and MEXC_SECRET_KEY must be configured",
          );
        }
        return new MexcExchange(apiKey, secretKey);
      }
    }
  }

  /** Force re-initialisation (e.g. after env change) */
  static reset(): void {
    ExchangeFactory.instance = null;
  }

  /** Get the currently configured provider name */
  static getProviderName(): ExchangeProvider {
    return (process.env.EXCHANGE_PROVIDER as ExchangeProvider) || "mexc";
  }
}
