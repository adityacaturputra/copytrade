export function DraftCardTpTargets({ takeProfitTargets }: { takeProfitTargets: number[] }) {
  if (!takeProfitTargets?.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {takeProfitTargets.map((tp, idx) => {
        const total = takeProfitTargets.length;
        const pct =
          total === 1
            ? 100
            : idx < total - 1
              ? Math.floor((100 / total) * 100) / 100
              : Math.round((100 - (total - 1) * (Math.floor((100 / total) * 100) / 100)) * 100) / 100;

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
