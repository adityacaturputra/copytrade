function roundRrValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function buildRRTargetMultipliers(rr: number): number[] {
  if (!Number.isFinite(rr) || rr <= 0) return [];

  const normalizedRr = roundRrValue(rr);
  const wholeTargets = Math.floor(normalizedRr);
  const multipliers: number[] = [];

  for (let index = 1; index <= wholeTargets; index++) {
    multipliers.push(index);
  }

  const hasFractionalTarget =
    multipliers.length === 0 ||
    Math.abs(multipliers[multipliers.length - 1] - normalizedRr) > 1e-9;

  if (hasFractionalTarget) {
    multipliers.push(normalizedRr);
  }

  return multipliers;
}

/**
 * Auto-calculate Take Profit targets based on RR (Risk-Reward) ratio.
 * If a signal has entryPrice + stopLoss but no TP, generate TP levels using RR.
 */
export function autoCalculateTPFromRR(
  entryPrice: number,
  stopLoss: number,
  rr: number,
  side: "LONG" | "SHORT",
): number[] {
  const riskDistance = Math.abs(entryPrice - stopLoss);
  const direction = side === "LONG" ? 1 : -1;
  return buildRRTargetMultipliers(rr).map(
    (multiplier) => entryPrice + direction * riskDistance * multiplier,
  );
}

/**
 * Auto-calculate Stop Loss from TP distance using RR ratio.
 * Reverse of autoCalculateTPFromRR when signal has TP but no SL.
 */
export function autoCalculateSLFromRR(
  entryPrice: number,
  tpPrice: number,
  rr: number,
  side: "LONG" | "SHORT",
): number {
  const tpDistance = Math.abs(tpPrice - entryPrice);
  const slDistance = tpDistance / rr;
  const direction = side === "LONG" ? -1 : 1;
  return entryPrice + direction * slDistance;
}

/**
 * Sanitize leverage value from AI response.
 * AI may return leverage as "10x", "10-25x", or other string formats.
 */
export function sanitizeLeverage(
  leverage: number | string | undefined | null,
): number | null {
  if (leverage === undefined || leverage === null) return null;
  if (typeof leverage === "number") {
    return isNaN(leverage) ? null : leverage;
  }

  const match = String(leverage).match(/(\d+)/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  return isNaN(value) ? null : value;
}
