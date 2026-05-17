import type { DraftTrade, DraftAction } from '../types';

export function PendingDraftActions({
  draft,
  acting,
  customRR,
  canCalcTPFromRR,
  onDraftAction,
}: {
  draft: DraftTrade;
  acting: boolean;
  customRR: number;
  canCalcTPFromRR: boolean;
  onDraftAction: (id: string, action: DraftAction, extraBody?: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex sm:flex-col gap-2 sm:min-w-[120px]">
      <button
        onClick={() => onDraftAction(draft._id, 'accept', canCalcTPFromRR ? { rr: customRR } : undefined)}
        disabled={acting}
        className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
      >
        {acting ? <div className="spinner w-4 h-4 border-2" /> : '✅'}
        Accept{canCalcTPFromRR ? ` (${customRR}RR)` : ''}
      </button>
      <button
        onClick={() => onDraftAction(draft._id, 'reject')}
        disabled={acting}
        className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
      >
        ❌ Reject
      </button>
      <button
        onClick={() => onDraftAction(draft._id, 'reanalyze')}
        disabled={acting}
        className="flex-1 sm:flex-none bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
      >
        🔄 Re-analyze
      </button>
    </div>
  );
}

export function ResolvedDraftActions({
  draft,
  acting,
  onDraftAction,
}: {
  draft: DraftTrade;
  acting: boolean;
  onDraftAction: (id: string, action: DraftAction, extraBody?: Record<string, unknown>) => void;
}) {
  return (
    <div className="sm:min-w-[220px] sm:pt-0 flex flex-col items-end gap-3">
      <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-1.5">
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => onDraftAction(draft._id, 'redraft')}
            disabled={acting}
            className="w-full rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/80 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <span className="text-slate-400">📝</span>
              <span>Draft again</span>
            </span>
            {acting ? <div className="spinner w-4 h-4 border-2" /> : null}
          </button>
          <button
            onClick={() => onDraftAction(draft._id, 'reanalyze')}
            disabled={acting}
            className="w-full rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/80 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <span className="text-slate-400">🔄</span>
              <span>Re-analyze</span>
            </span>
            {acting ? <div className="spinner w-4 h-4 border-2" /> : null}
          </button>
        </div>
      </div>
    </div>
  );
}
