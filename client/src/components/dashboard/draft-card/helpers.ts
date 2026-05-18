import { calculateRisk } from '@copytrade/shared/lib/risk/calc';
import { autoCalculateTPFromRR } from '@copytrade/shared/lib/executor/utils/signal';
import type { DraftTrade, RiskConfig } from '../types';
import type { ResolvedStyle } from './types';

export function getResolvedStyle(status: string): ResolvedStyle {
  const styles: Record<string, ResolvedStyle> = {
    accepted: {
      icon: '✅',
      borderColor: 'border-green-700/40',
      bgColor: 'bg-green-950/10',
    },
    rejected: {
      icon: '❌',
      borderColor: 'border-red-700/40',
      bgColor: 'bg-red-950/10',
    },
    expired: {
      icon: '⏰',
      borderColor: 'border-slate-600/40',
      bgColor: 'bg-slate-800/20',
    },
  };
  return styles[status] || styles.expired;
}

export function parseDraftSignal(signalData: string): {
  orderType: string | null;
  parsedSignalData: unknown;
} {
  try {
    const signal = JSON.parse(signalData);
    return {
      orderType: signal.orderType || null,
      parsedSignalData: signal,
    };
  } catch {
    return {
      orderType: null,
      parsedSignalData: null,
    };
  }
}

export function buildAutoTpPreview(
  draft: DraftTrade,
  customRR: number,
): number[] {
  const hasNoTP = !draft.takeProfitTargets || draft.takeProfitTargets.length === 0;
  const canCalcTPFromRR =
    hasNoTP && !!draft.entryPrice && draft.entryPrice > 0 && !!draft.stopLoss;

  if (!canCalcTPFromRR) return [];

  return autoCalculateTPFromRR(
    draft.entryPrice!,
    draft.stopLoss!,
    customRR,
    draft.side,
  );
}

export function getTpMinimums(
  draft: DraftTrade,
  riskConfig: RiskConfig | null,
  accountBalance: number,
) {
  const hasSL = !!draft.stopLoss && draft.stopLoss > 0;
  const canCalcRisk = hasSL && !!draft.entryPrice && draft.entryPrice > 0;
  const rpt = riskConfig?.riskPerTradePercent ?? 1;

  const riskResult =
    canCalcRisk && riskConfig
      ? calculateRisk({
          accountBalance,
          riskPerTradePercent: rpt,
          entryPrice: draft.entryPrice!,
          stopLossPrice: draft.stopLoss!,
          minLeverage: riskConfig.minLeverage,
          maxLeverage: riskConfig.maxLeverage,
        })
      : null;

  const riskLeverage = riskResult?.leverage ?? draft.leverage;
  const tpCount = draft.takeProfitTargets?.length ?? 0;
  const tpMinQty =
    draft.instrumentLotSize && tpCount > 0
      ? draft.instrumentLotSize * tpCount
      : null;
  const tpMinMarginUsdt =
    tpMinQty && draft.entryPrice && draft.entryPrice > 0 && riskLeverage > 0
      ? (tpMinQty * draft.entryPrice) / riskLeverage
      : null;
  const minOrderQty =
    typeof draft.minOrderQty === 'number' && Number.isFinite(draft.minOrderQty)
      ? draft.minOrderQty
      : draft.instrumentLotSize && draft.instrumentLotSize > 0
        ? draft.instrumentLotSize
        : null;
  const minOrderMarginUsdt =
    typeof draft.minOrderMarginUsdt === 'number' &&
    Number.isFinite(draft.minOrderMarginUsdt)
      ? draft.minOrderMarginUsdt
      : minOrderQty &&
          draft.entryPrice &&
          draft.entryPrice > 0 &&
          riskLeverage > 0
        ? (minOrderQty * draft.entryPrice) / riskLeverage
        : null;

  return {
    tpCount,
    tpMinQty,
    tpMinMarginUsdt,
    minOrderQty,
    minOrderMarginUsdt,
    riskLeverage,
  };
}
