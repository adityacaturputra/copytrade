import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB, Account, DiscordSource } from "@copytrade/shared/lib/database";
import { SourceType } from "@copytrade/shared/lib/enums";
import type { ExchangeCredentialValues } from "@copytrade/shared/lib/exchange/exchange-credentials";
import {
  DEFAULT_EXCHANGE_PROVIDER,
  maskExchangeDataForDisplay,
  normalizeExchangeProvider,
  validateExchangeCredentials,
} from "@copytrade/shared/lib/exchange/provider-config";

const MASKED_VALUE_PREFIX = "••••••••";

type AccountUpdateInput = {
  name?: string;
  isActive?: boolean;
  channelIds?: string[];
  channelNames?: Record<string, string>;
  disabledChannelIds?: string[];
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
  disabledChannelIds?: string[];
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
  if (typeof duplicateFromId !== "string" || duplicateFromId.trim().length === 0) {
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
    const duplicateSourceAccount = await getDuplicateSourceAccount(duplicateFromId);
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
        { success: false, error: exchangeValidation.error || "Invalid exchange configuration" },
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
    });

    console.log(
      `✅ Created account: ${name} (${sourceType} → ${provider})`,
    );

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

    const tradingPlatformError = getTradingPlatformError(updates.tradingPlatform);
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
