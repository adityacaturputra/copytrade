import {
  Account,
  connectDB,
  RiskSettings as RiskSettingsModel,
} from "../database/index";
import { calculateRisk } from "./calc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskConfig {
  riskPerTradePercent: number; // e.g., 1 = 1% of balance (margin per trade)
  maxLeverage: number; // e.g., 100
  minLeverage: number; // e.g., 1
  skipNoSL: boolean; // skip trades without stop loss
  defaultRR: number; // default 3 — auto-calculate TP from RR when no TP provided
  defaultPositionSize: number; // default 50 — fallback position size (USDT) when signal has no size
  defaultLeverage: number; // default 10 — fallback leverage when signal has no leverage
  maxPositions: number; // default 5 — max concurrent open positions (0 = unlimited)
  autoRaiseMinOrderEnabled: boolean; // allow auto-raising margin to meet exchange minimums
  autoRaiseMinOrderMaxMarginUsdt: number; // max margin in USDT allowed for auto-raise
}

export interface RiskCalculation {
  /** Whether risk calculation was possible */
  applied: boolean;
  /** Account balance used for calculation */
  accountBalance: number;
  /** Margin allocated for this trade (balance × risk%) */
  marginUsdt: number;
  /** Distance from entry to SL as a decimal (e.g., 0.02 = 2%) */
  slDistancePercent: number;
  /** Total notional position size in USDT */
  notionalSize: number;
  /** Adjusted quantity (contracts/coins) */
  quantity: number;
  /** Required leverage to support this position */
  leverage: number;
  /** Reason if risk management couldn't be applied */
  skipReason?: string;
}

export type RiskOverrideConfig = Partial<RiskConfig>;

export interface EffectiveRiskConfig extends RiskConfig {
  sources: {
    riskPerTradePercent: "global" | "account" | "source_chat";
    maxLeverage: "global" | "account" | "source_chat";
    minLeverage: "global" | "account" | "source_chat";
    skipNoSL: "global" | "account" | "source_chat";
    defaultRR: "global" | "account" | "source_chat";
    defaultPositionSize: "global" | "account" | "source_chat";
    defaultLeverage: "global" | "account" | "source_chat";
    maxPositions: "global" | "account" | "source_chat";
    autoRaiseMinOrderEnabled: "global" | "account" | "source_chat";
    autoRaiseMinOrderMaxMarginUsdt: "global" | "account" | "source_chat";
  };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_RISK_CONFIG: RiskConfig = {
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
};

type RiskConfigField = keyof RiskConfig;

const RISK_CONFIG_FIELDS: RiskConfigField[] = [
  "riskPerTradePercent",
  "maxLeverage",
  "minLeverage",
  "skipNoSL",
  "defaultRR",
  "defaultPositionSize",
  "defaultLeverage",
  "maxPositions",
  "autoRaiseMinOrderEnabled",
  "autoRaiseMinOrderMaxMarginUsdt",
];

function toRiskOverrideConfig(value: unknown): RiskOverrideConfig {
  if (!value || typeof value !== "object") return {};

  const record = value as Record<string, unknown>;
  const overrides: RiskOverrideConfig = {};

  for (const field of RISK_CONFIG_FIELDS) {
    const fieldValue = record[field];
    if (
      typeof fieldValue === "number" &&
      Number.isFinite(fieldValue)
    ) {
      overrides[field] = fieldValue as never;
      continue;
    }

    if (
      typeof fieldValue === "boolean" &&
      (field === "skipNoSL" || field === "autoRaiseMinOrderEnabled")
    ) {
      overrides[field] = fieldValue as never;
    }
  }

  return overrides;
}

function readChannelRiskOverrides(
  channelConfigs: unknown,
  channelId?: string | null,
): RiskOverrideConfig {
  if (!channelId || !channelConfigs || typeof channelConfigs !== "object") {
    return {};
  }

  const normalizedChannelId = channelId.trim();
  if (!normalizedChannelId) return {};

  const rawEntry =
    channelConfigs instanceof Map
      ? channelConfigs.get(normalizedChannelId)
      : (channelConfigs as Record<string, unknown>)[normalizedChannelId];

  if (!rawEntry || typeof rawEntry !== "object") return {};

  return toRiskOverrideConfig(
    (rawEntry as Record<string, unknown>).riskOverrides,
  );
}

export function mergeRiskConfigOverrides(
  baseConfig: RiskConfig,
  accountOverrides?: RiskOverrideConfig | null,
  sourceChatOverrides?: RiskOverrideConfig | null,
): EffectiveRiskConfig {
  const merged: RiskConfig = {
    ...baseConfig,
    ...accountOverrides,
    ...sourceChatOverrides,
  };

  const sources: EffectiveRiskConfig["sources"] = {
    riskPerTradePercent: "global",
    maxLeverage: "global",
    minLeverage: "global",
    skipNoSL: "global",
    defaultRR: "global",
    defaultPositionSize: "global",
    defaultLeverage: "global",
    maxPositions: "global",
    autoRaiseMinOrderEnabled: "global",
    autoRaiseMinOrderMaxMarginUsdt: "global",
  };

  for (const field of RISK_CONFIG_FIELDS) {
    if (accountOverrides?.[field] !== undefined) {
      sources[field] = "account";
    }
    if (sourceChatOverrides?.[field] !== undefined) {
      sources[field] = "source_chat";
    }
  }

  return {
    ...merged,
    sources,
  };
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

export async function getRiskConfig(): Promise<RiskConfig> {
  try {
    await connectDB();
    const settings = await RiskSettingsModel.findOne()
      .sort({ updatedAt: -1 })
      .lean();
    if (settings) {
      return {
        riskPerTradePercent: settings.riskPerTradePercent,
        maxLeverage: settings.maxLeverage,
        minLeverage: settings.minLeverage,
        skipNoSL: settings.skipNoSL ?? true,
        defaultRR: settings.defaultRR ?? 3,
        defaultPositionSize: settings.defaultPositionSize ?? 50,
        defaultLeverage: settings.defaultLeverage ?? 10,
        maxPositions: settings.maxPositions ?? 5,
        autoRaiseMinOrderEnabled:
          settings.autoRaiseMinOrderEnabled ?? false,
        autoRaiseMinOrderMaxMarginUsdt:
          settings.autoRaiseMinOrderMaxMarginUsdt ?? 0,
      };
    }
  } catch (err) {
    console.warn(
      "Failed to fetch risk settings from DB, using defaults:",
      err instanceof Error ? err.message : String(err),
    );
  }
  return DEFAULT_RISK_CONFIG;
}

export async function setRiskConfig(
  config: Partial<RiskConfig>,
): Promise<RiskConfig> {
  await connectDB();
  const update: Record<string, unknown> = {};
  if (config.riskPerTradePercent !== undefined) {
    update.riskPerTradePercent = config.riskPerTradePercent;
  }
  if (config.maxLeverage !== undefined) {
    update.maxLeverage = config.maxLeverage;
  }
  if (config.minLeverage !== undefined) {
    update.minLeverage = config.minLeverage;
  }
  if (config.skipNoSL !== undefined) {
    update.skipNoSL = config.skipNoSL;
  }
  if (config.defaultRR !== undefined) {
    update.defaultRR = config.defaultRR;
  }
  if (config.defaultPositionSize !== undefined) {
    update.defaultPositionSize = config.defaultPositionSize;
  }
  if (config.defaultLeverage !== undefined) {
    update.defaultLeverage = config.defaultLeverage;
  }
  if (config.maxPositions !== undefined) {
    update.maxPositions = config.maxPositions;
  }
  if (config.autoRaiseMinOrderEnabled !== undefined) {
    update.autoRaiseMinOrderEnabled = config.autoRaiseMinOrderEnabled;
  }
  if (config.autoRaiseMinOrderMaxMarginUsdt !== undefined) {
    update.autoRaiseMinOrderMaxMarginUsdt =
      config.autoRaiseMinOrderMaxMarginUsdt;
  }
  const doc = await RiskSettingsModel.findOneAndUpdate({}, update, {
    upsert: true,
    new: true,
  }).lean();
  return {
    riskPerTradePercent: doc.riskPerTradePercent,
    maxLeverage: doc.maxLeverage,
    minLeverage: doc.minLeverage,
    skipNoSL: doc.skipNoSL ?? true,
    defaultRR: doc.defaultRR ?? 3,
    defaultPositionSize: doc.defaultPositionSize ?? 50,
    defaultLeverage: doc.defaultLeverage ?? 10,
    maxPositions: doc.maxPositions ?? 5,
    autoRaiseMinOrderEnabled: doc.autoRaiseMinOrderEnabled ?? false,
    autoRaiseMinOrderMaxMarginUsdt: doc.autoRaiseMinOrderMaxMarginUsdt ?? 0,
  };
}

export async function resolveEffectiveRiskConfig(options?: {
  accountId?: string | null;
  channelId?: string | null;
}): Promise<EffectiveRiskConfig> {
  const globalConfig = await getRiskConfig();

  if (!options?.accountId) {
    return mergeRiskConfigOverrides(globalConfig);
  }

  await connectDB();
  const account = await Account.findById(options.accountId)
    .select({ riskOverrides: 1, channelConfigs: 1 })
    .lean()
    .exec();

  const accountOverrides = toRiskOverrideConfig(account?.riskOverrides);
  const sourceChatOverrides = readChannelRiskOverrides(
    account?.channelConfigs,
    options.channelId,
  );

  return mergeRiskConfigOverrides(
    globalConfig,
    accountOverrides,
    sourceChatOverrides,
  );
}

// ─── Core Calculation ─────────────────────────────────────────────────────────

/**
 * Calculate position size and leverage based on risk management.
 *
 * Simplified logic:
 *   margin = accountBalance × (riskPerTradePercent / 100)
 *   slDistance = |entryPrice - stopLossPrice| / entryPrice
 *   leverage = ceil(1 / slDistance)  ← derived from SL distance
 *   notionalSize = margin / slDistance
 *   quantity = notionalSize / entryPrice
 *
 * The margin is always a fixed % of balance (e.g., 1%).
 * The leverage adjusts based on how far the SL is from entry.
 *
 * Example: $5000 balance, 1% risk, SL 2% away:
 *   margin = $50
 *   leverage = ceil(1/0.02) = 50x
 *   notional = $50 / 0.02 = $2,500
 *   quantity = $2,500 / entryPrice
 */
export async function calculateRiskBasedPosition(
  entryPrice: number,
  stopLossPrice: number | null | undefined,
  side: "LONG" | "SHORT",
  originalQuantity: number,
  originalLeverage: number,
  accountBalance: number | null | undefined,
  options?: {
    accountId?: string | null;
    channelId?: string | null;
  },
): Promise<RiskCalculation> {
  const config = await resolveEffectiveRiskConfig(options);

  // Caller must provide the balance from the target trading account.
  if (
    !accountBalance ||
    !Number.isFinite(accountBalance) ||
    accountBalance <= 0
  ) {
    return {
      applied: false,
      accountBalance: 0,
      marginUsdt: 0,
      slDistancePercent: 0,
      notionalSize: 0,
      quantity: originalQuantity,
      leverage: originalLeverage,
      skipReason: "No valid account balance provided for risk calculation",
    };
  }

  // Must have SL to calculate risk
  if (!stopLossPrice || stopLossPrice === 0) {
    if (config.skipNoSL) {
      return {
        applied: false,
        accountBalance,
        marginUsdt: 0,
        slDistancePercent: 0,
        notionalSize: 0,
        quantity: 0,
        leverage: originalLeverage,
        skipReason:
          "No Stop Loss — trade skipped (skipNoSL is enabled in risk settings)",
      };
    }
    return {
      applied: false,
      accountBalance,
      marginUsdt: 0,
      slDistancePercent: 0,
      notionalSize: 0,
      quantity: originalQuantity,
      leverage: originalLeverage,
      skipReason:
        "No Stop Loss price provided — cannot calculate risk-based position size",
    };
  }

  // Calculate SL distance as decimal (e.g., 0.02 = 2%)
  const slDistancePercent = Math.abs(entryPrice - stopLossPrice) / entryPrice;

  if (slDistancePercent < 0.0001) {
    // SL too close (< 0.01%), would result in massive leverage
    return {
      applied: false,
      accountBalance,
      marginUsdt: 0,
      slDistancePercent,
      notionalSize: 0,
      quantity: originalQuantity,
      leverage: originalLeverage,
      skipReason: "Stop Loss too close to entry price (< 0.01%)",
    };
  }

  // ─── Core calculation (single source of truth: risk-calc.ts) ────────
  const calc = calculateRisk({
    accountBalance,
    riskPerTradePercent: config.riskPerTradePercent,
    entryPrice,
    stopLossPrice,
    minLeverage: config.minLeverage,
    maxLeverage: config.maxLeverage,
  });

  console.log(
    `[Risk] 💰 Balance: $${accountBalance.toFixed(2)} | Margin (${config.riskPerTradePercent}%): $${calc.marginUsdt.toFixed(2)} | SL distance: ${(calc.slDistancePercent * 100).toFixed(2)}%`,
  );
  console.log(
    `[Risk] 📊 Notional: $${calc.notionalSize.toFixed(2)} | Qty: ${calc.quantity.toFixed(6)} | Leverage: ${calc.leverage}x`,
  );

  return {
    applied: true,
    accountBalance,
    ...calc,
  };
}
