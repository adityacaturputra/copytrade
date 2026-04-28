"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXCHANGE_CREDENTIAL_FIELD_CONFIGS = exports.EXCHANGE_CREDENTIAL_FIELD_LABELS = exports.EXCHANGE_PROVIDER_CONFIGS = exports.EXCHANGE_CREDENTIAL_FIELDS = exports.DEFAULT_ACCOUNT_EXCHANGE_PROVIDER = exports.DEFAULT_EXCHANGE_PROVIDER = exports.SUPPORTED_EXCHANGE_PROVIDERS = void 0;
exports.normalizeExchangeProvider = normalizeExchangeProvider;
exports.getExchangeProviderConfig = getExchangeProviderConfig;
exports.isPaperExchangeProvider = isPaperExchangeProvider;
exports.exchangeProviderRequiresCredentials = exchangeProviderRequiresCredentials;
exports.getExchangeProviderOptions = getExchangeProviderOptions;
exports.getExchangeCredentialFieldConfig = getExchangeCredentialFieldConfig;
exports.getExchangeProviderCredentialFields = getExchangeProviderCredentialFields;
exports.getExchangeProviderCredentialFieldConfigs = getExchangeProviderCredentialFieldConfigs;
exports.getDefaultExchangeCredentialValues = getDefaultExchangeCredentialValues;
exports.maskExchangeDataForDisplay = maskExchangeDataForDisplay;
exports.getMissingExchangeCredentialFields = getMissingExchangeCredentialFields;
exports.validateExchangeCredentials = validateExchangeCredentials;
exports.SUPPORTED_EXCHANGE_PROVIDERS = [
    "mexc",
    "okx",
    "binance",
    "bybit",
    "metatrader",
    "paper",
];
exports.DEFAULT_EXCHANGE_PROVIDER = "paper";
exports.DEFAULT_ACCOUNT_EXCHANGE_PROVIDER = "okx";
exports.EXCHANGE_CREDENTIAL_FIELDS = [
    "apiKey",
    "secretKey",
    "passphrase",
    "baseUrl",
    "login",
    "password",
    "server",
    "platform",
    "bridgeToken",
];
exports.EXCHANGE_PROVIDER_CONFIGS = {
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
exports.EXCHANGE_CREDENTIAL_FIELD_LABELS = {
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
exports.EXCHANGE_CREDENTIAL_FIELD_CONFIGS = {
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
function normalizeExchangeProvider(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim().toLowerCase();
    return exports.SUPPORTED_EXCHANGE_PROVIDERS.includes(normalized)
        ? normalized
        : null;
}
function getExchangeProviderConfig(providerValue) {
    const provider = normalizeExchangeProvider(providerValue);
    return provider ? exports.EXCHANGE_PROVIDER_CONFIGS[provider] : null;
}
function isPaperExchangeProvider(providerValue) {
    return normalizeExchangeProvider(providerValue) === exports.DEFAULT_EXCHANGE_PROVIDER;
}
function exchangeProviderRequiresCredentials(providerValue) {
    const config = getExchangeProviderConfig(providerValue);
    return Boolean(config && config.authMode !== "none");
}
function getExchangeProviderOptions() {
    return exports.SUPPORTED_EXCHANGE_PROVIDERS.map((provider) => exports.EXCHANGE_PROVIDER_CONFIGS[provider]);
}
function getExchangeCredentialFieldConfig(field) {
    return exports.EXCHANGE_CREDENTIAL_FIELD_CONFIGS[field];
}
function getExchangeProviderCredentialFields(providerValue, options) {
    const config = getExchangeProviderConfig(providerValue);
    if (!config)
        return [];
    const includeOptional = options?.includeOptional ?? true;
    const fields = includeOptional
        ? [...config.requiredFields, ...(config.optionalFields || [])]
        : [...config.requiredFields];
    return Array.from(new Set(fields));
}
function getExchangeProviderCredentialFieldConfigs(providerValue, options) {
    return getExchangeProviderCredentialFields(providerValue, options).map((field) => getExchangeCredentialFieldConfig(field));
}
function getDefaultExchangeCredentialValues() {
    return exports.EXCHANGE_CREDENTIAL_FIELDS.reduce((values, field) => {
        values[field] = exports.EXCHANGE_CREDENTIAL_FIELD_CONFIGS[field].defaultValue || "";
        return values;
    }, {});
}
function maskExchangeCredentialValue(field, value) {
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
function maskExchangeDataForDisplay(providerValue, exchangeData) {
    const data = exchangeData || {};
    const masked = { ...data };
    for (const field of getExchangeProviderCredentialFields(providerValue)) {
        masked[field] = maskExchangeCredentialValue(field, data[field]);
    }
    return masked;
}
function getMissingExchangeCredentialFields(providerValue, exchangeData) {
    const config = getExchangeProviderConfig(providerValue);
    if (!config)
        return [];
    const data = exchangeData || {};
    return config.requiredFields.filter((field) => {
        const value = data[field];
        return typeof value !== "string" || value.trim().length === 0;
    });
}
function validateExchangeCredentials(providerValue, exchangeData) {
    const config = getExchangeProviderConfig(providerValue);
    if (!config) {
        return {
            valid: false,
            error: `Invalid trading platform: ${String(providerValue || "")}`,
            missingFields: [],
        };
    }
    const missingFields = getMissingExchangeCredentialFields(config.provider, exchangeData);
    if (missingFields.length === 0) {
        return { valid: true, missingFields: [] };
    }
    const missingLabels = missingFields.map((field) => exports.EXCHANGE_CREDENTIAL_FIELD_LABELS[field]);
    return {
        valid: false,
        error: `${config.label} ${missingLabels.join(", ")} ${missingLabels.length === 1 ? "is" : "are"} required`,
        missingFields,
    };
}
//# sourceMappingURL=provider-config.js.map