import { DEFAULT_ACCOUNT_EXCHANGE_PROVIDER, DEFAULT_EXCHANGE_PROVIDER, getExchangeProviderConfig, getExchangeProviderOptions } from "@copytrade/shared/lib/exchange/provider-config";
import { createEmptyExchangeFormValues, ExchangeFormValues, AccountExchangeData } from "./exchange-form";
import { getStoredActionPassword } from "@/lib/action-auth";


export interface AccountData {
  _id: string;
  name: string;
  sourceType: string;
  sourceData: {
    method?: string;
    token?: string;
    refreshToken?: string;
    autoRefresh?: boolean;
    tokenExpiresAt?: string;
    botToken?: string;
    [key: string]: unknown;
  };
  channelIds: string[];
  channelNames?: Record<string, string>;
  disabledChannelIds?: string[];
  riskOverrides?: {
    riskPerTradePercent?: number;
    autoRaiseMinOrderEnabled?: boolean;
    autoRaiseMinOrderMaxMarginUsdt?: number;
    autoRaiseTpCountEnabled?: boolean;
    autoRaiseTpCountMaxMarginUsdt?: number;
    [key: string]: unknown;
  } | null;
  channelConfigs?: Record<
    string,
    {
      riskOverrides?: {
        riskPerTradePercent?: number;
        autoRaiseMinOrderEnabled?: boolean;
        autoRaiseMinOrderMaxMarginUsdt?: number;
        autoRaiseTpCountEnabled?: boolean;
        autoRaiseTpCountMaxMarginUsdt?: number;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }
  >;
  tradingPlatform: string;
  exchangeData?: AccountExchangeData;
  isActive: boolean;
  lastFetchedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthStatus {
  valid: boolean;
  error?: string;
  needsRefresh: boolean;
}

export type AutoRaiseOverrideMode = "inherit" | "enabled" | "disabled";

export interface ChannelEntry {
  id: string;
  name: string;
  riskPerTradePercent: string;
  autoRaiseMinOrderMode: AutoRaiseOverrideMode;
  autoRaiseMinOrderMaxMarginUsdt: string;
  autoRaiseTpCountMode: AutoRaiseOverrideMode;
  autoRaiseTpCountMaxMarginUsdt: string;
}

export interface AccountFormData {
  duplicateFromId: string | null;
  name: string;
  sourceType: string;
  // Discord
  method: string;
  token: string;
  refreshToken: string;
  autoRefresh: boolean;
  // Telegram
  botToken: string;
  // Channels
  channels: ChannelEntry[];
  accountRiskPerTradePercent: string;
  accountAutoRaiseMinOrderMode: AutoRaiseOverrideMode;
  accountAutoRaiseMinOrderMaxMarginUsdt: string;
  accountAutoRaiseTpCountMode: AutoRaiseOverrideMode;
  accountAutoRaiseTpCountMaxMarginUsdt: string;
  // Exchange
  tradingPlatform: string;
  exchangeValues: ExchangeFormValues;
  exchangeIsDemo: boolean;
}

export const emptyForm: AccountFormData = {
  duplicateFromId: null,
  name: "",
  sourceType: "discord",
  method: "bot",
  token: "",
  refreshToken: "",
  autoRefresh: true,
  botToken: "",
  channels: [
    {
      id: "",
      name: "",
      riskPerTradePercent: "",
      autoRaiseMinOrderMode: "inherit",
      autoRaiseMinOrderMaxMarginUsdt: "",
      autoRaiseTpCountMode: "inherit",
      autoRaiseTpCountMaxMarginUsdt: "",
    },
  ],
  accountRiskPerTradePercent: "",
  accountAutoRaiseMinOrderMode: "inherit",
  accountAutoRaiseMinOrderMaxMarginUsdt: "",
  accountAutoRaiseTpCountMode: "inherit",
  accountAutoRaiseTpCountMaxMarginUsdt: "",
  tradingPlatform: DEFAULT_ACCOUNT_EXCHANGE_PROVIDER,
  exchangeValues: createEmptyExchangeFormValues(),
  exchangeIsDemo: false,
};

export function createEmptyAccountForm(): AccountFormData {
  return {
    ...emptyForm,
    channels: [
      {
        id: "",
        name: "",
        riskPerTradePercent: "",
        autoRaiseMinOrderMode: "inherit",
        autoRaiseMinOrderMaxMarginUsdt: "",
        autoRaiseTpCountMode: "inherit",
        autoRaiseTpCountMaxMarginUsdt: "",
      },
    ],
    exchangeValues: createEmptyExchangeFormValues(),
  };
}

export interface RiskConfig {
  riskPerTradePercent: number;
  maxLeverage: number;
  minLeverage: number;
  skipNoSL: boolean;
  defaultRR: number;
  defaultPositionSize: number;
  defaultLeverage: number;
  maxPositions: number;
  autoRaiseMinOrderEnabled: boolean;
  autoRaiseMinOrderMaxMarginUsdt: number;
  autoRaiseTpCountEnabled: boolean;
  autoRaiseTpCountMaxMarginUsdt: number;
}

export const defaultRiskConfig: RiskConfig = {
  riskPerTradePercent: 1,
  maxLeverage: 100,
  minLeverage: 1,
  skipNoSL: true,
  defaultRR: 3,
  defaultPositionSize: 50,
  defaultLeverage: 10,
  maxPositions: 5,
  autoRaiseMinOrderEnabled: false,
  autoRaiseMinOrderMaxMarginUsdt: 0,
  autoRaiseTpCountEnabled: false,
  autoRaiseTpCountMaxMarginUsdt: 0,
};

export interface SignalConfigType {
  fetchLimit: number;
  timeWindowHours: number;
}

export const defaultSignalConfig: SignalConfigType = {
  fetchLimit: 10,
  timeWindowHours: 24,
};

export const RECOMMENDED_SCHEDULES: Record<
  string,
  { label: string; description: string }
> = {
  "signal-check": {
    label: "Every 5 minutes",
    description:
      "Check sources for new signals frequently. Recommended: 5 min.",
  },
  "position-monitor": {
    label: "Every 30 minutes",
    description: "Monitor open positions for changes. Recommended: 30 min.",
  },
  "tp-sl-monitor": {
    label: "Every 5 minutes",
    description: "Place TP/SL for filled limit orders. Recommended: 5 min.",
  },
  "orphan-cleanup": {
    label: "Every 60 minutes",
    description:
      "Clean up orphan algo orders on exchange. Recommended: 60 min.",
  },
};

export const EXCHANGE_PROVIDER_OPTIONS = getExchangeProviderOptions();

export function getTradingPlatformConfig(provider: string) {
  return (
    getExchangeProviderConfig(provider) ||
    getExchangeProviderConfig(DEFAULT_EXCHANGE_PROVIDER)
  );
}

export function parseOptionalPositiveNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseOptionalNonNegativeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function formatOptionalNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

export function toAutoRaiseOverrideMode(value: unknown): AutoRaiseOverrideMode {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  return "inherit";
}

// Helper to add action password header to mutation requests
export function withActionPassword(
  headers: Record<string, string> = {},
): Record<string, string> {
  const pw = getStoredActionPassword();
  if (pw) headers["x-action-password"] = pw;
  return headers;
}
