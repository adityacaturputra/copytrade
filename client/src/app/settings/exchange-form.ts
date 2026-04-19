import type { ExchangeCredentialValues } from "@copytrade/shared/lib/exchange/exchange-credentials";
import {
  DEFAULT_ACCOUNT_EXCHANGE_PROVIDER,
  getDefaultExchangeCredentialValues,
  getExchangeProviderConfig,
  getExchangeProviderCredentialFieldConfigs,
  normalizeExchangeProvider,
  type ExchangeCredentialField,
  type ExchangeCredentialFieldConfig,
} from "@copytrade/shared/lib/exchange/provider-config";

const MASKED_VALUE_PREFIX = "••••••••";

export type AccountExchangeData = ExchangeCredentialValues & {
  isDemo?: boolean;
};

export type ExchangeFormValues = Record<ExchangeCredentialField, string>;

export function createEmptyExchangeFormValues(): ExchangeFormValues {
  return getDefaultExchangeCredentialValues();
}

export function resolveAccountFormTradingPlatform(
  providerValue: unknown,
): string {
  return (
    normalizeExchangeProvider(providerValue) || DEFAULT_ACCOUNT_EXCHANGE_PROVIDER
  );
}

export function buildExchangeFormValues(
  exchangeData?: AccountExchangeData | null,
): ExchangeFormValues {
  const values = createEmptyExchangeFormValues();
  if (!exchangeData) return values;

  for (const field of Object.keys(values) as ExchangeCredentialField[]) {
    const value = exchangeData[field];
    if (
      typeof value === "string" &&
      !value.startsWith(MASKED_VALUE_PREFIX)
    ) {
      values[field] = value;
    }
  }

  return values;
}

export function getExchangeSimulationValue(
  exchangeData?: AccountExchangeData | null,
): boolean {
  return Boolean(exchangeData?.isDemo ?? exchangeData?.simulated ?? false);
}

function buildExchangeDataRecord(
  providerValue: unknown,
  exchangeValues: ExchangeFormValues,
  options?: {
    simulated?: boolean;
  },
): Record<string, unknown> {
  const providerConfig = getExchangeProviderConfig(providerValue);
  if (!providerConfig || providerConfig.authMode === "none") {
    return {};
  }

  const exchangeData: Record<string, unknown> = {};

  for (const fieldConfig of getExchangeProviderCredentialFieldConfigs(
    providerConfig.provider,
  )) {
    const value = exchangeValues[fieldConfig.field];
    if (typeof value === "string" && value.trim().length > 0) {
      exchangeData[fieldConfig.field] = value.trim();
    }
  }

  exchangeData.simulated = Boolean(options?.simulated);
  return exchangeData;
}

export function buildExchangeDataPreview(
  providerValue: unknown,
  exchangeValues: ExchangeFormValues,
): Record<string, unknown> {
  return buildExchangeDataRecord(providerValue, exchangeValues);
}

export function buildExchangeDataPayload(
  providerValue: unknown,
  exchangeValues: ExchangeFormValues,
  simulated: boolean,
): Record<string, unknown> {
  return buildExchangeDataRecord(providerValue, exchangeValues, { simulated });
}

export function getExchangeFieldConfigs(
  providerValue: unknown,
): ExchangeCredentialFieldConfig[] {
  return getExchangeProviderCredentialFieldConfigs(providerValue);
}

export function getExchangeFieldLabel(
  fieldConfig: ExchangeCredentialFieldConfig,
  requiredFields: ExchangeCredentialField[],
  editing: boolean,
): string {
  const isRequired = requiredFields.includes(fieldConfig.field);

  if (!editing) {
    return isRequired ? `${fieldConfig.label} *` : `${fieldConfig.label} (optional)`;
  }

  return isRequired
    ? `${fieldConfig.label} (leave empty to keep)`
    : `${fieldConfig.label} (optional)`;
}

export function getExchangeFieldPlaceholder(
  fieldConfig: ExchangeCredentialFieldConfig,
  editing: boolean,
): string | undefined {
  if (editing && fieldConfig.editPlaceholder) {
    return fieldConfig.editPlaceholder;
  }

  return fieldConfig.placeholder;
}
