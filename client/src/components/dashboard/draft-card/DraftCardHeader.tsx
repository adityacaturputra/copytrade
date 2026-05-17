import { StatusBadge } from '../StatusBadge';
import type { DraftTrade } from '../types';
import type { ResolvedStyle } from './types';

export function DraftCardHeader({
  draft,
  isPending,
  isResolved,
  isExpanded,
  resolvedStyle,
  orderType,
  onToggle,
}: {
  draft: DraftTrade;
  isPending: boolean;
  isResolved: boolean;
  isExpanded: boolean;
  resolvedStyle: ResolvedStyle;
  orderType: string | null;
  onToggle: () => void;
}) {
  const chevronClass = isExpanded ? 'rotate-180' : 'rotate-0';
  const mobileResolvedAt = draft.resolvedAt
    ? new Date(draft.resolvedAt).toLocaleString([], {
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <button
      onClick={onToggle}
      className="w-full px-3 py-2.5 text-left hover:brightness-110 transition border-b border-slate-700/50"
    >
      <div className="sm:hidden flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {!isPending && <span className="text-sm shrink-0">{resolvedStyle.icon}</span>}
            <span
              className={`badge shrink-0 text-[10px] px-1.5 py-0.5 ${draft.side === 'LONG' ? 'badge-success' : 'badge-danger'}`}
            >
              {draft.action}
            </span>
            <span className="text-xs font-semibold text-white">{draft.symbol}</span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
            {!isPending && (
              <div className="scale-90 origin-left">
                <StatusBadge status={draft.status} />
              </div>
            )}
            {orderType && <span>• {orderType === 'limit' ? 'Limit' : 'Market'}</span>}
            {draft.confidence > 0 && <span>• {draft.confidence}%</span>}
          </div>

          {isResolved && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <span>by @{draft.author}</span>
              {mobileResolvedAt && <span>{mobileResolvedAt}</span>}
            </div>
          )}
        </div>

        <span className={`inline-block shrink-0 text-[10px] text-slate-500 transition-transform duration-200 ${chevronClass}`}>
          ▼
        </span>
      </div>

      <div className="hidden sm:flex items-center gap-2 whitespace-nowrap">
        {!isPending && <span className="text-sm shrink-0">{resolvedStyle.icon}</span>}
        <span
          className={`badge shrink-0 text-[11px] px-1.5 py-0.5 ${draft.side === 'LONG' ? 'badge-success' : 'badge-danger'}`}
        >
          {draft.action}
        </span>
        <span className="shrink-0 text-sm font-semibold text-white">{draft.symbol}</span>
        {!isPending && (
          <div className="shrink-0 scale-100 origin-left">
            <StatusBadge status={draft.status} />
          </div>
        )}
        {orderType && <span className="shrink-0 text-[11px] text-slate-400">{orderType === 'limit' ? 'Limit' : 'Market'}</span>}
        {draft.confidence > 0 && <span className="shrink-0 text-[11px] text-slate-400">{draft.confidence}% conf</span>}
        {isResolved && (
          <>
            <span className="shrink-0 text-[11px] text-slate-500">by @{draft.author}</span>
            {draft.resolvedAt && (
              <span className="shrink-0 text-[11px] text-slate-500">{new Date(draft.resolvedAt).toLocaleString()}</span>
            )}
          </>
        )}
        <div className="ml-auto shrink-0 flex items-center">
          <span className={`inline-block text-[11px] text-slate-500 transition-transform duration-200 ${chevronClass}`}>
            ▼
          </span>
        </div>
      </div>
    </button>
  );
}
