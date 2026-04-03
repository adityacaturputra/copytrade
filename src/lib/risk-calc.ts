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
 * Pure risk calculation — no side effects, no API calls.
 *
 * Logic:
 *   margin = balance × (riskPerTradePercent / 100)
 *   slDistance = |entry - SL| / entry
 *   leverage = clamp(ceil(1 / slDistance), minLev, maxLev)
 *   notional = margin / slDistance
 *   quantity = notional / entryPrice
 */
export function calculateRisk(params: RiskCalcInput): RiskCalcOutput {
  const {
    accountBalance,
    riskPerTradePercent,
    entryPrice,
    stopLossPrice,
    minLeverage,
    maxLeverage,
  } = params;

  // Margin = fixed % of balance
  const marginUsdt = accountBalance * (riskPerTradePercent / 100);

  // SL distance as decimal
  const slDistancePercent = Math.abs(entryPrice - stopLossPrice) / entryPrice;

  // Leverage derived from SL distance
  const rawLeverage =
    slDistancePercent > 0 ? Math.ceil(1 / slDistancePercent) : 1;
  const leverage = Math.max(minLeverage, Math.min(maxLeverage, rawLeverage));

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
