export const SUPPORTED_EXCHANGE_PROVIDERS = [
  "mexc",
  "okx",
  "binance",
  "bybit",
  "metatrader",
  "paper",
] as const;

export const DEFAULT_EXCHANGE_PROVIDER = "paper" as const;
export const DEFAULT_ACCOUNT_EXCHANGE_PROVIDER = "okx" as const;

export const EXCHANGE_CREDENTIAL_FIELDS = [
  "apiKey",
  "secretKey",
  "passphrase",
  "baseUrl",
  "login",
  "password",
  "server",
  "platform",
  "bridgeToken",
] as const;

export type ExchangeProvider =
  (typeof SUPPORTED_EXCHANGE_PROVIDERS)[number];

export type ExchangeCredentialField =
  (typeof EXCHANGE_CREDENTIAL_FIELDS)[number];

export type ExchangeAuthMode = "none" | "api" | "bridge";
export type ExchangeCredentialInputType = "text" | "password" | "select";
export type ExchangeCredentialMaskMode = "none" | "full" | "last4";

export type ExchangeCredentialFieldOption = {
  value: string;
  label: string;
};

export type ExchangeCredentialFieldConfig = {
  field: ExchangeCredentialField;
  label: string;
  inputType: ExchangeCredentialInputType;
  placeholder?: string;
  editPlaceholder?: string;
  options?: ExchangeCredentialFieldOption[];
  defaultValue?: string;
  monospace?: boolean;
  maskMode: ExchangeCredentialMaskMode;
};

export type ExchangeProviderConfig = {
  provider: ExchangeProvider;
  label: string;
  optionLabel?: string;
  authMode: ExchangeAuthMode;
  requiredFields: ExchangeCredentialField[];
  optionalFields?: ExchangeCredentialField[];
};

export const EXCHANGE_PROVIDER_CONFIGS: Record<
  ExchangeProvider,
  ExchangeProviderConfig
> = {
  mexc: {
    provider: "mexc",
    label: "MEXC",
    authMode: "api",
    requiredFields: ["apiKey", "secretKey"],
  },
  okx: {
    provider: "okx",
    label: "OKX",
    authMode: "api",
    requiredFields: ["apiKey", "secretKey", "passphrase"],
  },
  binance: {
    provider: "binance",
    label: "Binance",
    optionLabel: "Binance Futures",
    authMode: "api",
    requiredFields: ["apiKey", "secretKey"],
  },
  bybit: {
    provider: "bybit",
    label: "Bybit",
    authMode: "api",
    requiredFields: ["apiKey", "secretKey"],
  },
  metatrader: {
    provider: "metatrader",
    label: "MetaTrader",
    optionLabel: "MetaTrader (MT4/MT5)",
    authMode: "bridge",
    requiredFields: ["baseUrl", "login", "password", "server"],
    optionalFields: ["platform", "bridgeToken"],
  },
  paper: {
    provider: "paper",
    label: "Paper Trading",
    optionLabel: "📝 Paper Trading (simulated)",
    authMode: "none",
    requiredFields: [],
  },
};

export const EXCHANGE_CREDENTIAL_FIELD_LABELS: Record<
  ExchangeCredentialField,
  string
> = {
  apiKey: "API key",
  secretKey: "secret key",
  passphrase: "passphrase",
  baseUrl: "bridge URL",
  login: "login",
  password: "password",
  server: "server",
  platform: "platform",
  bridgeToken: "bridge token",
};

export const EXCHANGE_CREDENTIAL_FIELD_CONFIGS: Record<
  ExchangeCredentialField,
  ExchangeCredentialFieldConfig
> = {
  apiKey: {
    field: "apiKey",
    label: "API Key",
    inputType: "password",
    placeholder: "API Key",
    editPlaceholder: "Leave empty to keep",
    monospace: true,
    maskMode: "last4",
  },
  secretKey: {
    field: "secretKey",
    label: "Secret Key",
    inputType: "password",
    placeholder: "Secret Key",
    editPlaceholder: "Leave empty to keep",
    monospace: true,
    maskMode: "full",
  },
  passphrase: {
    field: "passphrase",
    label: "Passphrase",
    inputType: "password",
    placeholder: "Passphrase",
    editPlaceholder: "Leave empty to keep",
    monospace: true,
    maskMode: "full",
  },
  baseUrl: {
    field: "baseUrl",
    label: "Bridge URL",
    inputType: "text",
    placeholder: "http://localhost:4000",
    editPlaceholder: "Leave empty to keep",
    maskMode: "none",
  },
  login: {
    field: "login",
    label: "Login",
    inputType: "text",
    placeholder: "12345678",
    editPlaceholder: "Leave empty to keep",
    monospace: true,
    maskMode: "none",
  },
  password: {
    field: "password",
    label: "Password",
    inputType: "password",
    placeholder: "Master password",
    editPlaceholder: "Leave empty to keep",
    monospace: true,
    maskMode: "full",
  },
  server: {
    field: "server",
    label: "Server",
    inputType: "text",
    placeholder: "Broker-Server",
    maskMode: "none",
  },
  platform: {
    field: "platform",
    label: "Platform",
    inputType: "select",
    defaultValue: "mt5",
    options: [
      { value: "mt5", label: "MT5" },
      { value: "mt4", label: "MT4" },
    ],
    maskMode: "none",
  },
  bridgeToken: {
    field: "bridgeToken",
    label: "Bridge Token",
    inputType: "password",
    placeholder: "Optional bridge auth token",
    editPlaceholder: "Leave empty to keep",
    monospace: true,
    maskMode: "full",
  },
};

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

export function getExchangeProviderConfig(
  providerValue: unknown,
): ExchangeProviderConfig | null {
  const provider = normalizeExchangeProvider(providerValue);
  return provider ? EXCHANGE_PROVIDER_CONFIGS[provider] : null;
}

export function isPaperExchangeProvider(providerValue: unknown): boolean {
  return normalizeExchangeProvider(providerValue) === DEFAULT_EXCHANGE_PROVIDER;
}

export function exchangeProviderRequiresCredentials(
  providerValue: unknown,
): boolean {
  const config = getExchangeProviderConfig(providerValue);
  return Boolean(config && config.authMode !== "none");
}

export function getExchangeProviderOptions(): ExchangeProviderConfig[] {
  return SUPPORTED_EXCHANGE_PROVIDERS.map(
    (provider) => EXCHANGE_PROVIDER_CONFIGS[provider],
  );
}

export function getExchangeCredentialFieldConfig(
  field: ExchangeCredentialField,
): ExchangeCredentialFieldConfig {
  return EXCHANGE_CREDENTIAL_FIELD_CONFIGS[field];
}

export function getExchangeProviderCredentialFields(
  providerValue: unknown,
  options?: {
    includeOptional?: boolean;
  },
): ExchangeCredentialField[] {
  const config = getExchangeProviderConfig(providerValue);
  if (!config) return [];

  const includeOptional = options?.includeOptional ?? true;
  const fields = includeOptional
    ? [...config.requiredFields, ...(config.optionalFields || [])]
    : [...config.requiredFields];

  return Array.from(new Set(fields));
}

export function getExchangeProviderCredentialFieldConfigs(
  providerValue: unknown,
  options?: {
    includeOptional?: boolean;
  },
): ExchangeCredentialFieldConfig[] {
  return getExchangeProviderCredentialFields(providerValue, options).map(
    (field) => getExchangeCredentialFieldConfig(field),
  );
}

export function getDefaultExchangeCredentialValues(): Record<
  ExchangeCredentialField,
  string
> {
  return EXCHANGE_CREDENTIAL_FIELDS.reduce(
    (values, field) => {
      values[field] = EXCHANGE_CREDENTIAL_FIELD_CONFIGS[field].defaultValue || "";
      return values;
    },
    {} as Record<ExchangeCredentialField, string>,
  );
}

function maskExchangeCredentialValue(
  field: ExchangeCredentialField,
  value: unknown,
): unknown {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  const fieldConfig = getExchangeCredentialFieldConfig(field);
  if (fieldConfig.maskMode === "none") {
    return value;
  }

  if (fieldConfig.maskMode === "last4") {
    return `••••••••${value.slice(-4)}`;
  }

  return "••••••••";
}

export function maskExchangeDataForDisplay(
  providerValue: unknown,
  exchangeData?: Record<string, unknown> | null,
): Record<string, unknown> {
  const data = exchangeData || {};
  const masked = { ...data };

  for (const field of getExchangeProviderCredentialFields(providerValue)) {
    masked[field] = maskExchangeCredentialValue(field, data[field]);
  }

  return masked;
}

export function getMissingExchangeCredentialFields(
  providerValue: unknown,
  exchangeData?: Record<string, unknown> | null,
): ExchangeCredentialField[] {
  const config = getExchangeProviderConfig(providerValue);
  if (!config) return [];

  const data = exchangeData || {};
  return config.requiredFields.filter((field) => {
    const value = data[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

export function validateExchangeCredentials(
  providerValue: unknown,
  exchangeData?: Record<string, unknown> | null,
): { valid: boolean; error?: string; missingFields: ExchangeCredentialField[] } {
  const config = getExchangeProviderConfig(providerValue);
  if (!config) {
    return {
      valid: false,
      error: `Invalid trading platform: ${String(providerValue || "")}`,
      missingFields: [],
    };
  }

  const missingFields = getMissingExchangeCredentialFields(
    config.provider,
    exchangeData,
  );

  if (missingFields.length === 0) {
    return { valid: true, missingFields: [] };
  }

  const missingLabels = missingFields.map(
    (field) => EXCHANGE_CREDENTIAL_FIELD_LABELS[field],
  );

  return {
    valid: false,
    error: `${config.label} ${missingLabels.join(", ")} ${missingLabels.length === 1 ? "is" : "are"} required`,
    missingFields,
  };
}
