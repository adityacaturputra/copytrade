import type { DraftTrade } from '../types';
import type { ResolvedStyle } from './types';

export function CollapsedDraftCard({
  draft,
  resolvedStyle,
  onExpand,
}: {
  draft: DraftTrade;
  resolvedStyle: ResolvedStyle;
  onExpand: () => void;
}) {
  return (
    <div className={`border rounded-lg overflow-hidden ${resolvedStyle.borderColor} ${resolvedStyle.bgColor}`}>
      <button
        onClick={onExpand}
        className="w-full px-3 sm:px-4 py-4 text-left hover:brightness-110 transition"
      >
        <div className="sm:hidden flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="shrink-0 text-sm">{resolvedStyle.icon}</span>
              <span className={`badge shrink-0 text-[11px] px-2 py-0.5 ${draft.side === 'LONG' ? 'badge-success' : 'badge-danger'}`}>
                {draft.action}
              </span>
              <span className="text-sm font-semibold text-white">{draft.symbol}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
              <span>by @{draft.author}</span>
              {draft.resolvedAt && <span>{new Date(draft.resolvedAt).toLocaleString()}</span>}
            </div>
          </div>
          <span className="shrink-0 text-slate-500 text-[10px] pt-0.5">▼</span>
        </div>

        <div className="hidden sm:flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="shrink-0">{resolvedStyle.icon}</span>
            <span className={`badge shrink-0 ${draft.side === 'LONG' ? 'badge-success' : 'badge-danger'}`}>
              {draft.action}
            </span>
            <span className="text-sm font-semibold text-white">{draft.symbol}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-[11px] text-slate-500">
            <span>by @{draft.author}</span>
            {draft.resolvedAt && <span>{new Date(draft.resolvedAt).toLocaleString()}</span>}
            <span>▼</span>
          </div>
        </div>
      </button>
    </div>
  );
}
