/**
 * Pure risk calculation functions — shared between backend and frontend.
 *
 * Single source of truth for risk math. No server-only dependencies
 * (no DB, no exchange) so it can be imported by client components.
 */

export interface RiskCalcInput {
  accountBalance: number;
  riskPerTradePercent: number; // e.g., 1 = 1%
  entryPrice: number;
  stopLossPrice: number;
  minLeverage: number;
  maxLeverage: number;
  /**
   * Maintenance margin rate safety buffer (default: 0.01 = 1%).
   * This buffer ensures the liquidation price stays BELOW the stop loss,
   * accounting for the exchange's maintenance margin requirements.
   *
   * Typical OKX rates: 0.5% for BTC/ETH, 1-2% for alts.
   * Using 1% as default provides a safe margin for most instruments.
   */
  maintenanceMarginBuffer?: number; // default 0.01 (1%)
}

export interface RiskCalcOutput {
  /** Margin allocated for this trade (balance × risk%) */
  marginUsdt: number;
  /** Distance from entry to SL as a decimal (e.g., 0.0458 = 4.58%) */
  slDistancePercent: number;
  /** Total notional position size in USDT */
  notionalSize: number;
  /** Adjusted quantity (contracts/coins) */
  quantity: number;
  /** Required leverage to support this position */
  leverage: number;
}

/**
 * Calculate the maximum safe leverage so that the liquidation price
 * stays BELOW (LONG) or ABOVE (SHORT) the stop loss price.
 *
 * Exchanges add a maintenance margin rate (MMR) on top of the initial
 * margin. For isolated LONG positions:
 *
 *   liqPrice = entry × (1 - 1/lev + mmr)
 *
 * For liqPrice ≤ SL:
 *   1 - 1/lev + mmr ≤ (SL / entry)
 *   1/lev ≥ 1 - SL/entry + mmr
 *   lev ≤ 1 / (1 - SL/entry + mmr)           ← LONG
 *
 * For SHORT:
 *   liqPrice = entry × (1 + 1/lev - mmr)
 *   liqPrice ≥ SL:
 *   1/lev ≥ SL/entry - 1 + mmr
 *   lev ≤ 1 / (SL/entry - 1 + mmr)           ← SHORT
 *
 * @param entryPrice    Entry price
 * @param stopLossPrice Stop loss price
 * @param side          "LONG" or "SHORT"
 * @param mmr           Maintenance margin rate (e.g., 0.01 = 1%)
 * @returns Maximum safe leverage (floored, ≥ 1)
 */
export function calculateMaxSafeLeverage(
  entryPrice: number,
  stopLossPrice: number,
  side: "LONG" | "SHORT",
  mmr: number = 0.01,
): number {
  if (entryPrice <= 0) return 1;
  const slRatio = stopLossPrice / entryPrice;

  let maxLev: number;
  if (side === "LONG") {
    // liqPrice ≤ SL  →  lev ≤ 1 / (1 - SL/entry + mmr)
    const denominator = 1 - slRatio + mmr;
    maxLev = denominator > 0.001 ? 1 / denominator : 1;
  } else {
    // SHORT: liqPrice ≥ SL  →  lev ≤ 1 / (SL/entry - 1 + mmr)
    const denominator = slRatio - 1 + mmr;
    maxLev = denominator > 0.001 ? 1 / denominator : 1;
  }

  return Math.max(1, Math.floor(maxLev));
}

/**
 * Pure risk calculation — no side effects, no API calls.
 *
 * Logic:
 *   margin = balance × (riskPerTradePercent / 100)
 *   slDistance = |entry - SL| / entry
 *   leverage = min(ceil(1/slDist), maxSafeLev) — capped so liq price stays past SL
 *   notional = margin / slDistance
 *   quantity = notional / entryPrice
 *
 * The maintenance margin buffer ensures the exchange's liquidation price
 * is always beyond the stop loss, preventing liquidation before SL triggers.
 */
export function calculateRisk(params: RiskCalcInput): RiskCalcOutput {
  const {
    accountBalance,
    riskPerTradePercent,
    entryPrice,
    stopLossPrice,
    minLeverage,
    maxLeverage,
    maintenanceMarginBuffer = 0.01, // default 1% safety buffer
  } = params;

  // Margin = fixed % of balance
  const marginUsdt = accountBalance * (riskPerTradePercent / 100);

  // SL distance as decimal
  const slDistancePercent = Math.abs(entryPrice - stopLossPrice) / entryPrice;

  // Determine trade side from entry vs SL
  const side: "LONG" | "SHORT" = stopLossPrice < entryPrice ? "LONG" : "SHORT";

  // Calculate max safe leverage (accounts for exchange maintenance margin)
  const maxSafeLev = calculateMaxSafeLeverage(
    entryPrice,
    stopLossPrice,
    side,
    maintenanceMarginBuffer,
  );

  // Leverage derived from SL distance, but capped to max safe leverage
  const rawLeverage =
    slDistancePercent > 0 ? Math.ceil(1 / slDistancePercent) : 1;
  const cappedLeverage = Math.min(rawLeverage, maxSafeLev);
  const leverage = Math.max(minLeverage, Math.min(maxLeverage, cappedLeverage));

  if (rawLeverage > maxSafeLev) {
    console.log(
      `[Risk] 🛡️ Leverage capped from ${rawLeverage}x to ${maxSafeLev}x to keep liquidation past SL (mmr buffer: ${(maintenanceMarginBuffer * 100).toFixed(1)}%)`,
    );
  }

  // Notional position size
  const notionalSize =
    slDistancePercent > 0.0001 ? marginUsdt / slDistancePercent : 0;

  // Quantity in base currency
  const quantity = entryPrice > 0 ? notionalSize / entryPrice : 0;

  return {
    marginUsdt: Math.round(marginUsdt * 100) / 100,
    slDistancePercent: Math.round(slDistancePercent * 10000) / 10000,
    notionalSize: Math.round(notionalSize * 100) / 100,
    quantity: Math.round(quantity * 100) / 100,
    leverage,
  };
}
