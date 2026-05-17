export function DraftCardTpMargin({
  tpCount,
  tpMinQty,
  tpMinMarginUsdt,
  riskLeverage,
}: {
  tpCount: number;
  tpMinQty: number | null;
  tpMinMarginUsdt: number | null;
  riskLeverage: number;
}) {
  if (tpMinMarginUsdt === null) return null;

  return (
    <div className="rounded-lg border border-sky-700/30 bg-sky-950/20 p-3 mb-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-300">📏 TP{tpCount} Min Margin</span>
        <span className="badge bg-sky-700/30 text-sky-300">${tpMinMarginUsdt.toFixed(2)}</span>
        <span className="text-slate-500">
          Needs min qty <span className="font-mono text-slate-300">{tpMinQty?.toFixed(6).replace(/\.?0+$/, '')}</span> at {riskLeverage}x
        </span>
      </div>
    </div>
  );
}
