import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import {
  connectDB,
  Account,
  DiscordSource,
} from "@copytrade/shared/lib/database/index";
import { SourceType } from "@copytrade/shared/lib/enums/index";
import type { ExchangeCredentialValues } from "@copytrade/shared/lib/exchange/exchange-credentials";
import {
  DEFAULT_EXCHANGE_PROVIDER,
  maskExchangeDataForDisplay,
  normalizeExchangeProvider,
  validateExchangeCredentials,
} from "@copytrade/shared/lib/exchange/provider-config";
import { verifyActionAuth } from "../_lib/action-auth";

const MASKED_VALUE_PREFIX = "••••••••";

type AccountUpdateInput = {
  name?: string;
  isActive?: boolean;
  channelIds?: string[];
  channelNames?: Record<string, string>;
  disabledChannelIds?: string[];
  riskOverrides?: Record<string, unknown> | null;
  channelConfigs?: Record<string, { riskOverrides?: Record<string, unknown> }>;
  duplicateFromId?: string;
  tradingPlatform?: unknown;
  sourceData?: Record<string, unknown>;
  exchangeData?: ExchangeCredentialValues;
};

type DuplicateSourceAccount = {
  _id: unknown;
  name: string;
  sourceType?: string;
  sourceData?: Record<string, unknown> | null;
  tradingPlatform?: string | null;
  exchangeData?: Record<string, unknown> | null;
  riskOverrides?: Record<string, unknown> | null;
  channelConfigs?: Record<string, { riskOverrides?: Record<string, unknown> }>;
  disabledChannelIds?: string[];
};

const RISK_OVERRIDE_VALIDATORS: Record<string, (value: unknown) => boolean> = {
  riskPerTradePercent: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.1 &&
    value <= 100,
  maxLeverage: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 125,
  minLeverage: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 125,
  skipNoSL: (value) => typeof value === "boolean",
  defaultRR: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.5 &&
    value <= 20,
  defaultPositionSize: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 1_000_000,
  defaultLeverage: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 125,
  maxPositions: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100,
  autoRaiseMinOrderEnabled: (value) => typeof value === "boolean",
  autoRaiseMinOrderMaxMarginUsdt: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1_000_000,
  autoRaiseTpCountEnabled: (value) => typeof value === "boolean",
  autoRaiseTpCountMaxMarginUsdt: (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1_000_000,
};

function isMaskedValue(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(MASKED_VALUE_PREFIX);
}

function shouldSkipPersistedValue(value: unknown): boolean {
  return isMaskedValue(value) || value === "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function mergePersistedConfig(
  currentValue: unknown,
  incomingValue: unknown,
): Record<string, unknown> {
  const merged = { ...toRecord(currentValue) };

  for (const [key, value] of Object.entries(toRecord(incomingValue))) {
    if (shouldSkipPersistedValue(value)) continue;
    merged[key] = value;
  }

  return merged;
}

function resolveAccountTradingPlatform(
  currentValue: unknown,
  nextValue: unknown,
) {
  return (
    normalizeExchangeProvider(
      nextValue !== undefined ? nextValue : currentValue,
    ) || DEFAULT_EXCHANGE_PROVIDER
  );
}

function getTradingPlatformError(tradingPlatform: unknown): string | null {
  if (
    tradingPlatform !== undefined &&
    !normalizeExchangeProvider(tradingPlatform)
  ) {
    return `Invalid trading platform: ${String(tradingPlatform)}`;
  }

  return null;
}

function validateUpdatedExchangeConfiguration(
  account: {
    tradingPlatform?: unknown;
    exchangeData?: unknown;
  },
  updates: AccountUpdateInput,
): string | null {
  if (!updates.exchangeData) return null;

  const tradingPlatform = resolveAccountTradingPlatform(
    account.tradingPlatform,
    updates.tradingPlatform,
  );
  const mergedExchangeData = mergePersistedConfig(
    account.exchangeData,
    updates.exchangeData,
  );
  const validation = validateExchangeCredentials(
    tradingPlatform,
    mergedExchangeData,
  );

  return validation.valid
    ? null
    : validation.error || "Invalid exchange configuration";
}

function applyAccountUpdates(
  account: {
    name?: string;
    isActive?: boolean;
    channelIds?: string[];
    channelNames?: Record<string, string> | Map<string, string>;
    disabledChannelIds?: string[];
    riskOverrides?: Record<string, unknown> | null;
    channelConfigs?: unknown;
    tradingPlatform?: unknown;
    sourceData?: unknown;
    exchangeData?: unknown;
  },
  updates: AccountUpdateInput,
) {
  if (updates.name !== undefined) account.name = updates.name;
  if (updates.isActive !== undefined) account.isActive = updates.isActive;
  if (updates.channelIds !== undefined) account.channelIds = updates.channelIds;
  if (updates.channelNames !== undefined)
    account.channelNames = updates.channelNames;
  if (updates.disabledChannelIds !== undefined)
    account.disabledChannelIds = updates.disabledChannelIds;
  if (updates.riskOverrides !== undefined) {
    account.riskOverrides = updates.riskOverrides;
  }
  if (updates.channelConfigs !== undefined) {
    const activeChannelIds = new Set(
      updates.channelIds || account.channelIds || [],
    );
    account.channelConfigs = Object.fromEntries(
      Object.entries(updates.channelConfigs).filter(([channelId]) =>
        activeChannelIds.has(channelId),
      ),
    );
  }
  if (updates.tradingPlatform !== undefined)
    account.tradingPlatform = updates.tradingPlatform;
  if (updates.sourceData !== undefined) {
    account.sourceData = mergePersistedConfig(
      account.sourceData,
      updates.sourceData,
    );
  }
  if (updates.exchangeData !== undefined) {
    account.exchangeData = mergePersistedConfig(
      account.exchangeData,
      updates.exchangeData,
    );
  }
}

function validateSourceConfiguration(
  sourceType: unknown,
  sourceData?: Record<string, unknown> | null,
): string | null {
  const data = sourceData || {};

  if (sourceType === "discord") {
    if (!data.token) return "Discord token is required";
    if (!data.method) return "Discord method (bot/user) is required";
  }

  if (sourceType === "telegram" && !data.botToken) {
    return "Telegram bot token is required";
  }

  return null;
}

async function getDuplicateSourceAccount(
  duplicateFromId: unknown,
): Promise<DuplicateSourceAccount | null> {
  if (
    typeof duplicateFromId !== "string" ||
    duplicateFromId.trim().length === 0
  ) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(duplicateFromId.trim())) {
    return null;
  }

  const account = await Account.findById(duplicateFromId.trim()).lean();
  return account as DuplicateSourceAccount | null;
}

function shouldInheritSourceData(
  sourceAccount: DuplicateSourceAccount | null,
  sourceType: unknown,
): boolean {
  return Boolean(sourceAccount && sourceAccount.sourceType === sourceType);
}

function shouldInheritExchangeData(
  sourceAccount: DuplicateSourceAccount | null,
  tradingPlatform: unknown,
): boolean {
  if (!sourceAccount) return false;

  return (
    resolveAccountTradingPlatform(sourceAccount.tradingPlatform, undefined) ===
    resolveAccountTradingPlatform(undefined, tradingPlatform)
  );
}

function buildSourceDataForCreate(
  sourceAccount: DuplicateSourceAccount | null,
  sourceType: unknown,
  sourceData: unknown,
) {
  return mergePersistedConfig(
    shouldInheritSourceData(sourceAccount, sourceType)
      ? sourceAccount?.sourceData
      : null,
    sourceData,
  );
}

function buildExchangeDataForCreate(
  sourceAccount: DuplicateSourceAccount | null,
  tradingPlatform: unknown,
  exchangeData: unknown,
) {
  return mergePersistedConfig(
    shouldInheritExchangeData(sourceAccount, tradingPlatform)
      ? sourceAccount?.exchangeData
      : null,
    exchangeData,
  );
}

function buildDisabledChannelIdsForCreate(
  sourceAccount: DuplicateSourceAccount | null,
  channelIds: string[],
) {
  if (!sourceAccount?.disabledChannelIds?.length) return [];

  const activeChannelIds = new Set(channelIds);
  return sourceAccount.disabledChannelIds.filter((channelId) =>
    activeChannelIds.has(channelId),
  );
}

function validateRiskOverrides(
  riskOverrides: unknown,
  scope: string,
): string | null {
  if (riskOverrides === undefined || riskOverrides === null) return null;
  if (!riskOverrides || typeof riskOverrides !== "object") {
    return `${scope} risk overrides must be an object`;
  }

  for (const [field, value] of Object.entries(
    riskOverrides as Record<string, unknown>,
  )) {
    const validator = RISK_OVERRIDE_VALIDATORS[field];
    if (!validator) {
      return `${scope} risk override field is not supported: ${field}`;
    }
    if (!validator(value)) {
      return `${scope} risk override is invalid for ${field}`;
    }
  }

  return null;
}

function validateChannelConfigs(channelConfigs: unknown): string | null {
  if (channelConfigs === undefined || channelConfigs === null) return null;
  if (!channelConfigs || typeof channelConfigs !== "object") {
    return "Channel configs must be an object";
  }

  for (const [channelId, config] of Object.entries(
    channelConfigs as Record<string, unknown>,
  )) {
    if (!config || typeof config !== "object") {
      return `Channel config must be an object for ${channelId}`;
    }
    const error = validateRiskOverrides(
      (config as Record<string, unknown>).riskOverrides,
      `Channel ${channelId}`,
    );
    if (error) return error;
  }

  return null;
}

function buildChannelConfigsForCreate(
  sourceAccount: DuplicateSourceAccount | null,
  channelIds: string[],
  channelConfigs: unknown,
) {
  const activeChannelIds = new Set(channelIds);
  const inherited =
    sourceAccount?.channelConfigs &&
    typeof sourceAccount.channelConfigs === "object"
      ? sourceAccount.channelConfigs
      : {};
  const incoming =
    channelConfigs && typeof channelConfigs === "object"
      ? (channelConfigs as Record<string, unknown>)
      : {};

  return Object.fromEntries(
    Object.entries({
      ...inherited,
      ...incoming,
    }).filter(([channelId]) => activeChannelIds.has(channelId)),
  );
}

// ─── GET /api/accounts ─────────────────────────────────────────────────────
export async function GET() {
  try {
    await connectDB();

    const accounts = await Account.find().sort({ createdAt: 1 }).lean();

    // Mask sensitive fields for display
    const masked = accounts.map((acc) => ({
      ...acc,
      sourceData: {
        ...acc.sourceData,
        token: acc.sourceData?.token
          ? "••••••••" + String(acc.sourceData.token).slice(-4)
          : undefined,
        refreshToken: acc.sourceData?.refreshToken
          ? "••••••••" + String(acc.sourceData.refreshToken).slice(-4)
          : undefined,
        botToken: acc.sourceData?.botToken
          ? "••••••••" + String(acc.sourceData.botToken).slice(-4)
          : undefined,
      },
      exchangeData: {
        ...maskExchangeDataForDisplay(
          acc.tradingPlatform,
          acc.exchangeData as Record<string, unknown> | null | undefined,
        ),
      },
    }));

    return NextResponse.json({ success: true, accounts: masked });
  } catch (error) {
    console.error("Failed to fetch accounts:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch accounts" },
      { status: 500 },
    );
  }
}

// ─── POST /api/accounts ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authError = verifyActionAuth(req);
  if (authError) return authError;

  try {
    await connectDB();
    const body = await req.json();

    const {
      name,
      sourceType,
      sourceData,
      channelIds,
      channelNames,
      duplicateFromId,
      tradingPlatform,
      exchangeData,
      riskOverrides,
      channelConfigs,
    } = body;

    if (!name || !sourceType) {
      return NextResponse.json(
        { success: false, error: "Name and source type are required" },
        { status: 400 },
      );
    }

    if (!Object.values(SourceType).includes(sourceType)) {
      return NextResponse.json(
        { success: false, error: `Invalid source type: ${sourceType}` },
        { status: 400 },
      );
    }

    if (!channelIds || channelIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one channel ID is required" },
        { status: 400 },
      );
    }

    const tradingPlatformError = getTradingPlatformError(tradingPlatform);
    if (tradingPlatformError) {
      return NextResponse.json(
        { success: false, error: tradingPlatformError },
        { status: 400 },
      );
    }
    const provider = resolveAccountTradingPlatform(
      DEFAULT_EXCHANGE_PROVIDER,
      tradingPlatform,
    );
    const duplicateSourceAccount =
      await getDuplicateSourceAccount(duplicateFromId);
    if (duplicateFromId && !duplicateSourceAccount) {
      return NextResponse.json(
        { success: false, error: "Source account for duplication not found" },
        { status: 404 },
      );
    }

    const mergedSourceData = buildSourceDataForCreate(
      duplicateSourceAccount,
      sourceType,
      sourceData,
    );
    const mergedExchangeData = buildExchangeDataForCreate(
      duplicateSourceAccount,
      provider,
      exchangeData,
    );

    const sourceValidationError = validateSourceConfiguration(
      sourceType,
      mergedSourceData,
    );
    if (sourceValidationError) {
      return NextResponse.json(
        { success: false, error: sourceValidationError },
        { status: 400 },
      );
    }

    const exchangeValidation = validateExchangeCredentials(
      provider,
      mergedExchangeData,
    );
    if (!exchangeValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: exchangeValidation.error || "Invalid exchange configuration",
        },
        { status: 400 },
      );
    }

    const riskOverrideError = validateRiskOverrides(riskOverrides, "Account");
    if (riskOverrideError) {
      return NextResponse.json(
        { success: false, error: riskOverrideError },
        { status: 400 },
      );
    }

    const channelConfigError = validateChannelConfigs(channelConfigs);
    if (channelConfigError) {
      return NextResponse.json(
        { success: false, error: channelConfigError },
        { status: 400 },
      );
    }

    const account = await Account.create({
      name,
      isActive: true,
      sourceType,
      sourceData: mergedSourceData,
      channelIds,
      channelNames: channelNames || {},
      disabledChannelIds: buildDisabledChannelIdsForCreate(
        duplicateSourceAccount,
        channelIds,
      ),
      tradingPlatform: provider,
      exchangeData: Object.keys(mergedExchangeData).length
        ? mergedExchangeData
        : null,
      riskOverrides:
        riskOverrides && typeof riskOverrides === "object"
          ? riskOverrides
          : duplicateSourceAccount?.riskOverrides || null,
      channelConfigs: buildChannelConfigsForCreate(
        duplicateSourceAccount,
        channelIds,
        channelConfigs,
      ),
    });

    console.log(`✅ Created account: ${name} (${sourceType} → ${provider})`);

    return NextResponse.json({ success: true, account });
  } catch (error) {
    console.error("Failed to create account:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create account",
      },
      { status: 500 },
    );
  }
}

// ─── PUT /api/accounts ─────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const authError = verifyActionAuth(req);
  if (authError) return authError;

  try {
    await connectDB();
    const body = await req.json();
    const { id, ...rawUpdates } = body;
    const updates = rawUpdates as AccountUpdateInput;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Account ID is required" },
        { status: 400 },
      );
    }

    const account = await Account.findById(id);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Account not found" },
        { status: 404 },
      );
    }

    const tradingPlatformError = getTradingPlatformError(
      updates.tradingPlatform,
    );
    if (tradingPlatformError) {
      return NextResponse.json(
        { success: false, error: tradingPlatformError },
        { status: 400 },
      );
    }

    const exchangeConfigError = validateUpdatedExchangeConfiguration(
      account,
      updates,
    );
    if (exchangeConfigError) {
      return NextResponse.json(
        { success: false, error: exchangeConfigError },
        { status: 400 },
      );
    }

    const riskOverrideError = validateRiskOverrides(
      updates.riskOverrides,
      "Account",
    );
    if (riskOverrideError) {
      return NextResponse.json(
        { success: false, error: riskOverrideError },
        { status: 400 },
      );
    }

    const channelConfigError = validateChannelConfigs(updates.channelConfigs);
    if (channelConfigError) {
      return NextResponse.json(
        { success: false, error: channelConfigError },
        { status: 400 },
      );
    }

    applyAccountUpdates(account, updates);

    await account.save();

    console.log(`✅ Updated account: ${account.name}`);

    return NextResponse.json({ success: true, account });
  } catch (error) {
    console.error("Failed to update account:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update account",
      },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/accounts ──────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authError = verifyActionAuth(req);
  if (authError) return authError;

  try {
    await connectDB();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Account ID is required" },
        { status: 400 },
      );
    }

    const account = await Account.findByIdAndDelete(id);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Account not found" },
        { status: 404 },
      );
    }

    console.log(`🗑️ Deleted account: ${account.name}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete account:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete account",
      },
      { status: 500 },
    );
  }
}
