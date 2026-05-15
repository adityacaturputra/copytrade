import { BinanceExchange } from "./binance/index";
import { BybitExchange } from "./bybit/index";
import { type ExchangeCredentials } from "./exchange-credentials";
import { MetaTraderExchange } from "./metatrader/index";
import { MexcExchange } from "./mexc/index";
import { OkxExchange } from "./okx/index";
import { PaperExchange } from "./paper/index";
import {
  type ExchangeCredentialField,
  type ExchangeProvider,
  getExchangeProviderConfig,
  normalizeExchangeProvider,
} from "./provider-config";
import { type ExchangeClient } from "./types";

type ExchangeProviderCapabilities = {
  supportsDirectAlgoCancel: boolean;
};

type ExchangeProviderRuntime = {
  createClient: (credentials?: ExchangeCredentials) => ExchangeClient;
  capabilities: ExchangeProviderCapabilities;
};

type ExchangeProviderRuntimeRegistry = Record<
  ExchangeProvider,
  ExchangeProviderRuntime
>;

function getStringCredential(
  credentials: ExchangeCredentials | undefined,
  field: ExchangeCredentialField,
): string | undefined {
  const value = credentials?.[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getRequiredStringCredentials(
  provider: ExchangeProvider,
  credentials: ExchangeCredentials | undefined,
  fields: ExchangeCredentialField[],
): Record<ExchangeCredentialField, string> {
  const providerConfig = getExchangeProviderConfig(provider);
  if (!providerConfig) {
    throw new Error(`Unsupported exchange provider: ${provider}`);
  }

  const values: Partial<Record<ExchangeCredentialField, string>> = {};
  const missingFields: ExchangeCredentialField[] = [];

  for (const field of fields) {
    const value = getStringCredential(credentials, field);
    if (!value) {
      missingFields.push(field);
      continue;
    }
    values[field] = value;
  }

  if (missingFields.length > 0) {
    throw new Error(
      `${providerConfig.label} ${missingFields.join(", ")} must be configured in account settings`,
    );
  }

  return values as Record<ExchangeCredentialField, string>;
}

export const EXCHANGE_PROVIDER_RUNTIME_REGISTRY: ExchangeProviderRuntimeRegistry =
  {
    paper: {
      createClient: () => new PaperExchange(),
      capabilities: {
        supportsDirectAlgoCancel: false,
      },
    },
    mexc: {
      createClient: (credentials) => {
        const { apiKey, secretKey } = getRequiredStringCredentials(
          "mexc",
          credentials,
          ["apiKey", "secretKey"],
        );
        return new MexcExchange(apiKey, secretKey);
      },
      capabilities: {
        supportsDirectAlgoCancel: false,
      },
    },
    okx: {
      createClient: (credentials) => {
        const { apiKey, secretKey, passphrase } = getRequiredStringCredentials(
          "okx",
          credentials,
          ["apiKey", "secretKey", "passphrase"],
        );
        return new OkxExchange(
          apiKey,
          secretKey,
          passphrase,
          credentials?.simulated ?? false,
        );
      },
      capabilities: {
        supportsDirectAlgoCancel: false,
      },
    },
    binance: {
      createClient: (credentials) => {
        const { apiKey, secretKey } = getRequiredStringCredentials(
          "binance",
          credentials,
          ["apiKey", "secretKey"],
        );
        return new BinanceExchange(
          apiKey,
          secretKey,
          credentials?.simulated ?? false,
        );
      },
      capabilities: {
        supportsDirectAlgoCancel: true,
      },
    },
    bybit: {
      createClient: (credentials) => {
        const { apiKey, secretKey } = getRequiredStringCredentials(
          "bybit",
          credentials,
          ["apiKey", "secretKey"],
        );
        return new BybitExchange(
          apiKey,
          secretKey,
          credentials?.simulated ?? false,
        );
      },
      capabilities: {
        supportsDirectAlgoCancel: true,
      },
    },
    metatrader: {
      createClient: (credentials) => {
        const { baseUrl, login, password, server } =
          getRequiredStringCredentials("metatrader", credentials, [
            "baseUrl",
            "login",
            "password",
            "server",
          ]);
        return new MetaTraderExchange({
          baseUrl,
          login,
          password,
          server,
          platform: getStringCredential(credentials, "platform"),
          bridgeToken:
            getStringCredential(credentials, "bridgeToken") ||
            getStringCredential(credentials, "apiKey"),
          simulated: credentials?.simulated ?? false,
        });
      },
      capabilities: {
        supportsDirectAlgoCancel: true,
      },
    },
  };

export function getExchangeProviderRuntime(
  providerValue: unknown,
): ExchangeProviderRuntime | null {
  const provider = normalizeExchangeProvider(providerValue);
  return provider ? EXCHANGE_PROVIDER_RUNTIME_REGISTRY[provider] : null;
}

export function exchangeSupportsDirectAlgoCancel(
  providerValue: unknown,
): boolean {
  return Boolean(
    getExchangeProviderRuntime(providerValue)?.capabilities
      .supportsDirectAlgoCancel,
  );
}
