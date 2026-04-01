import { ExchangeFactory } from "./exchange/ExchangeFactory";
import { connectDB, RiskSettings as RiskSettingsModel } from "./database";
import { calculateRisk } from "./risk-calc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskConfig {
  riskPerTradePercent: number; // e.g., 1 = 1% of balance (margin per trade)
  maxLeverage: number; // e.g., 100
  minLeverage: number; // e.g., 1
  skipNoSL: boolean; // skip trades without stop loss
  defaultRR: number; // default 3 — auto-calculate TP from RR when no TP provided
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

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_RISK_CONFIG: RiskConfig = {
  riskPerTradePercent: 1,
  maxLeverage: 100,
  minLeverage: 1,
  skipNoSL: true,
  defaultRR: 3,
};

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
  };
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
): Promise<RiskCalculation> {
  const config = await getRiskConfig();

  // Fetch account balance
  let accountBalance: number;
  try {
    const exchange = ExchangeFactory.getClient();
    const account = await exchange.getAccountInfo();
    accountBalance = account.availableBalance || account.totalBalance;
    console.log(
      `[Risk] 💰 Fetched account balance: $${accountBalance.toFixed(2)}`,
    );
  } catch (err) {
    console.warn(
      "Failed to fetch account balance for risk calc, using original params:",
      err instanceof Error ? err.message : String(err),
    );
    return {
      applied: false,
      accountBalance: 0,
      marginUsdt: 0,
      slDistancePercent: 0,
      notionalSize: 0,
      quantity: originalQuantity,
      leverage: originalLeverage,
      skipReason: `Failed to fetch account balance: ${err instanceof Error ? err.message : String(err)}`,
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
