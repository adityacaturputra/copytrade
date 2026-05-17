import type { DraftTrade } from '../types';

export function DraftCardMetrics({ draft }: { draft: DraftTrade }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm mb-3">
      {draft.entryPrice && (
        <div className="rounded-md bg-slate-900/40 px-2.5 py-2">
          <div className="text-slate-500">Entry</div>
          <div className="text-white font-mono">{draft.entryPrice}</div>
        </div>
      )}
      {draft.stopLoss && (
        <div className="rounded-md bg-slate-900/40 px-2.5 py-2">
          <div className="text-slate-500">SL</div>
          <div className="text-danger font-mono">{draft.stopLoss}</div>
        </div>
      )}
    </div>
  );
}
