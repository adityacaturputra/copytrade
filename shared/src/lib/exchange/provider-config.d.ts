export declare const SUPPORTED_EXCHANGE_PROVIDERS: readonly ["mexc", "okx", "binance", "bybit", "metatrader", "paper"];
export declare const DEFAULT_EXCHANGE_PROVIDER: "paper";
export declare const DEFAULT_ACCOUNT_EXCHANGE_PROVIDER: "okx";
export declare const EXCHANGE_CREDENTIAL_FIELDS: readonly ["apiKey", "secretKey", "passphrase", "baseUrl", "login", "password", "server", "platform", "bridgeToken"];
export type ExchangeProvider = (typeof SUPPORTED_EXCHANGE_PROVIDERS)[number];
export type ExchangeCredentialField = (typeof EXCHANGE_CREDENTIAL_FIELDS)[number];
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
export declare const EXCHANGE_PROVIDER_CONFIGS: Record<ExchangeProvider, ExchangeProviderConfig>;
export declare const EXCHANGE_CREDENTIAL_FIELD_LABELS: Record<ExchangeCredentialField, string>;
export declare const EXCHANGE_CREDENTIAL_FIELD_CONFIGS: Record<ExchangeCredentialField, ExchangeCredentialFieldConfig>;
export declare function normalizeExchangeProvider(value: unknown): ExchangeProvider | null;
export declare function getExchangeProviderConfig(providerValue: unknown): ExchangeProviderConfig | null;
export declare function isPaperExchangeProvider(providerValue: unknown): boolean;
export declare function exchangeProviderRequiresCredentials(providerValue: unknown): boolean;
export declare function getExchangeProviderOptions(): ExchangeProviderConfig[];
export declare function getExchangeCredentialFieldConfig(field: ExchangeCredentialField): ExchangeCredentialFieldConfig;
export declare function getExchangeProviderCredentialFields(providerValue: unknown, options?: {
    includeOptional?: boolean;
}): ExchangeCredentialField[];
export declare function getExchangeProviderCredentialFieldConfigs(providerValue: unknown, options?: {
    includeOptional?: boolean;
}): ExchangeCredentialFieldConfig[];
export declare function getDefaultExchangeCredentialValues(): Record<ExchangeCredentialField, string>;
export declare function maskExchangeDataForDisplay(providerValue: unknown, exchangeData?: Record<string, unknown> | null): Record<string, unknown>;
export declare function getMissingExchangeCredentialFields(providerValue: unknown, exchangeData?: Record<string, unknown> | null): ExchangeCredentialField[];
export declare function validateExchangeCredentials(providerValue: unknown, exchangeData?: Record<string, unknown> | null): {
    valid: boolean;
    error?: string;
    missingFields: ExchangeCredentialField[];
};
//# sourceMappingURL=provider-config.d.ts.map