import { calculateTPPercentages } from '@copytrade/shared/lib/risk/calc';

export function DraftCardTpTargets({
  takeProfitTargets,
  tpCloseMode = 'equal',
}: {
  takeProfitTargets: number[];
  tpCloseMode?: 'equal' | 'halving';
}) {
  if (!takeProfitTargets?.length) return null;

  const percentages = calculateTPPercentages(takeProfitTargets.length, tpCloseMode);

  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {takeProfitTargets.map((tp, idx) => {
        const pct = percentages[idx] || 0;

        return (
          <span
            key={idx}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] sm:text-xs font-mono bg-green-900/30 border border-green-700/40 text-success"
          >
            TP{idx + 1}: {tp}
            <span className="hidden sm:inline text-green-400/70">
              ({pct.toFixed(pct % 1 === 0 ? 0 : 2)}%)
            </span>
          </span>
        );
      })}
    </div>
  );
}
