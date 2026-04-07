/* ========================================
   BTC Market Maker Monitor - Calculations
   RSI, MACD, Volume Divergence
   ======================================== */

// ─── RSI Calculation ──────────────────────────

export function calculateRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── MACD Calculation ─────────────────────────

export function calculateEMA(data: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push((data[i] - ema[i - 1]) * multiplier + ema[i - 1]);
  }
  return ema;
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  prevHistogram: number;
  crossover: boolean;
  crossunder: boolean;
}

export function calculateMACD(closes: number[]): MACDResult | null {
  if (closes.length < 35) return null;

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((val, i) => val - ema26[i]);
  const signalLine = calculateEMA(macdLine.slice(25), 9);

  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine[signalLine.length - 1];
  const histogram = macdVal - signalVal;

  const prevMacdVal = macdLine[macdLine.length - 2];
  const prevSignalVal = signalLine[signalLine.length - 2];
  const prevHistogram = prevMacdVal - prevSignalVal;

  return {
    macd: macdVal,
    signal: signalVal,
    histogram,
    prevHistogram,
    crossover: prevHistogram <= 0 && histogram > 0,
    crossunder: prevHistogram >= 0 && histogram < 0,
  };
}

// ─── Volume Divergence Detection ──────────────

export interface VolDivResult {
  type: 'none' | 'bullish' | 'bearish';
  strength: 'none' | 'weak' | 'moderate' | 'strong';
  volDrop: number;
  detail: string;
}

export function detectVolumeDivergence(closes: number[], volumes: number[]): VolDivResult | null {
  if (!closes || !volumes || closes.length < 15) return null;

  const lookback = 2;
  const len = closes.length;

  const swingHighs: { idx: number; price: number; vol: number }[] = [];
  const swingLows: { idx: number; price: number; vol: number }[] = [];

  for (let i = lookback; i < len - lookback; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (closes[i] <= closes[i - j] || closes[i] <= closes[i + j]) isHigh = false;
      if (closes[i] >= closes[i - j] || closes[i] >= closes[i + j]) isLow = false;
    }

    if (isHigh) swingHighs.push({ idx: i, price: closes[i], vol: volumes[i] });
    if (isLow) swingLows.push({ idx: i, price: closes[i], vol: volumes[i] });
  }

  function getAvgVolume(idx: number): number {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, idx - 1); i <= Math.min(len - 1, idx + 1); i++) {
      sum += volumes[i];
      count++;
    }
    return sum / count;
  }

  let result: VolDivResult = { type: 'none', strength: 'none', volDrop: 0, detail: 'Tidak ada divergence' };

  // Check bearish divergence (price higher high, volume lower)
  if (swingHighs.length >= 2) {
    const prev = swingHighs[swingHighs.length - 2];
    const curr = swingHighs[swingHighs.length - 1];
    const prevVol = getAvgVolume(prev.idx);
    const currVol = getAvgVolume(curr.idx);

    if (curr.price > prev.price && currVol < prevVol) {
      const volDrop = ((prevVol - currVol) / prevVol) * 100;
      if (volDrop > 5) {
        let strength: 'weak' | 'moderate' | 'strong';
        if (volDrop > 35) strength = 'strong';
        else if (volDrop > 18) strength = 'moderate';
        else strength = 'weak';

        result = {
          type: 'bearish',
          strength,
          volDrop,
          detail: `HH + Vol ↓${volDrop.toFixed(0)}%`,
        };
      }
    }
  }

  // Check bullish divergence (price lower low, volume lower)
  if (swingLows.length >= 2) {
    const prev = swingLows[swingLows.length - 2];
    const curr = swingLows[swingLows.length - 1];
    const prevVol = getAvgVolume(prev.idx);
    const currVol = getAvgVolume(curr.idx);

    if (curr.price < prev.price && currVol < prevVol) {
      const volDrop = ((prevVol - currVol) / prevVol) * 100;
      if (volDrop > 5) {
        let strength: 'weak' | 'moderate' | 'strong';
        if (volDrop > 35) strength = 'strong';
        else if (volDrop > 18) strength = 'moderate';
        else strength = 'weak';

        if (result.type === 'none' || volDrop > result.volDrop) {
          result = {
            type: 'bullish',
            strength,
            volDrop,
            detail: `LL + Vol ↓${volDrop.toFixed(0)}%`,
          };
        }
      }
    }
  }

  return result;
}

// ─── Timeframe Reliability Map ────────────────

export const TF_RELIABILITY: Record<string, { tier: string; label: string; color: string }> = {
  '15M': { tier: 'short', label: 'SHORT-TERM', color: '#f59e0b' },
  '30M': { tier: 'short', label: 'SHORT-TERM', color: '#f59e0b' },
  '1H': { tier: 'best', label: '⭐ BEST', color: '#10b981' },
  '2H': { tier: 'best', label: '⭐ BEST', color: '#10b981' },
  '4H': { tier: 'best', label: '⭐ BEST', color: '#10b981' },
  '6H': { tier: 'swing', label: 'SWING', color: '#6366f1' },
  '8H': { tier: 'swing', label: 'SWING', color: '#6366f1' },
  '12H': { tier: 'swing', label: 'SWING', color: '#6366f1' },
  '1D': { tier: 'long', label: 'LONG-TERM', color: '#8b5cf6' },
  '1W': { tier: 'long', label: 'LONG-TERM', color: '#8b5cf6' },
};
