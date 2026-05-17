import React, { useState, type ReactNode } from 'react';
import {
  Position,
  formatUsd,
  formatCompactDateTime,
  getPositionSourceLabel,
  formatPositionTakeProfitTargets,
  estimatePositionMargin,
  formatMarginMode,
  resolvePositionPnlUsd,
  resolvePositionPnlPercent,
} from './types';

export function PositionSummaryPanel({
  positions,
  title,
  borderColor,
  dotColor,
  dotAnimate = false,
  type,
  channelNames,
  loadingExchange = false,
}: {
  positions: Position[];
  title: ReactNode;
  borderColor?: string;
  dotColor: string;
  dotAnimate?: boolean;
  type: 'open' | 'pending';
  channelNames: Record<string, string>;
  loadingExchange?: boolean;
  footerNote?: ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasContent = positions.length > 0;
  const showSkeleton = loadingExchange && !hasContent;
  const shouldRenderBody = isExpanded && (hasContent || showSkeleton);
  const isDisabled = !hasContent && !showSkeleton;

  return (
    <div className={`card ${borderColor || ''}`}>
      <button
        onClick={() => {
          if (isDisabled) return;
          setIsExpanded((prev) => !prev);
        }}
        className={`w-full flex items-center justify-between gap-2 text-left ${isDisabled ? 'cursor-default opacity-70' : ''}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 ${dotColor} rounded-full ${dotAnimate ? 'animate-pulse' : 'pulse-dot'}`} />
          <div className="text-sm sm:text-base font-semibold flex items-center gap-2 min-w-0">
            {title}
            {type === 'open' && loadingExchange ? (
              <div className="spinner w-3 h-3 border-2 ml-1" title="Syncing PnL..." />
            ) : null}
          </div>
        </div>
        <span className={`text-[10px] text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'} ${isDisabled ? 'opacity-40' : ''}`}>
          ▼
        </span>
      </button>

      {shouldRenderBody ? (
        <div className="mt-2">
          {showSkeleton ? (
            <div className="flex gap-2 overflow-x-auto pt-1 pb-0.5">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="w-[220px] shrink-0 rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 animate-pulse">
                  <div className="h-3.5 w-20 rounded bg-slate-800/80" />
                  <div className="mt-1.5 h-2.5 w-24 rounded bg-slate-800/70" />
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <div className="h-8 rounded bg-slate-800/70" />
                    <div className="h-8 rounded bg-slate-800/70" />
                    <div className="h-8 rounded bg-slate-800/70" />
                  </div>
                  <div className="mt-2 h-10 rounded bg-slate-800/60" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pt-1 pb-0.5">
              {positions.map((pos) => {
                const estimatedMargin = pos.margin ?? estimatePositionMargin(pos);
                const pnlUsdDisplay = resolvePositionPnlUsd(pos);
                const pnlPercent = resolvePositionPnlPercent(pos);
                const sourceLabel = getPositionSourceLabel(pos, channelNames);
                const marginMode = formatMarginMode(pos.marginType);
                const pnlClass =
                  type === 'pending'
                    ? 'text-slate-400'
                    : pnlUsdDisplay.value !== null
                      ? pnlUsdDisplay.value >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                      : pnlPercent !== null
                        ? pnlPercent >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                        : 'text-slate-400';

                return (
                  <div
                    key={pos._id || pos.id}
                    className="w-[220px] shrink-0 rounded-lg border border-slate-700/50 bg-slate-800/40 p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-slate-100 truncate">{pos.symbol}</span>
                        <span className={`badge text-[10px] px-1.5 py-0.5 ${pos.side === 'LONG' ? 'badge-success' : 'badge-danger'}`}>
                          {pos.side}
                        </span>
                      </div>
                      <span className="badge badge-neutral text-[10px] px-1.5 py-0.5">{marginMode}</span>
                    </div>

                    <div className="mt-1 text-[9px] uppercase tracking-[0.14em] text-slate-500 truncate">
                      {sourceLabel}
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                      <div className="rounded-md bg-slate-950/60 px-1.5 py-1">
                        <div className="text-[9px] uppercase tracking-wide text-slate-500">{type === 'pending' ? 'Limit' : 'Entry'}</div>
                        <div className="mt-1 font-mono text-xs text-white">{pos.entryPrice?.toFixed(4) || '-'}</div>
                      </div>
                      <div className="rounded-md bg-slate-950/60 px-1.5 py-1">
                        <div className="text-[9px] uppercase tracking-wide text-slate-500">Margin</div>
                        <div className="mt-1 font-mono text-xs text-white">
                          {formatUsd(estimatedMargin, { estimated: type === 'pending' && pos.margin == null })}
                        </div>
                      </div>
                      <div className="rounded-md bg-slate-950/60 px-1.5 py-1">
                        <div className="text-[9px] uppercase tracking-wide text-slate-500">
                          {type === 'pending' ? 'Status' : 'PnL'}
                        </div>
                        <div className={`mt-1 font-mono text-xs ${type === 'pending' ? 'text-amber-300' : pnlClass}`}>
                          {type === 'pending'
                            ? 'Pending'
                            : `${pnlUsdDisplay.value !== null && pnlUsdDisplay.value >= 0 ? '+' : ''}${formatUsd(pnlUsdDisplay.value, { estimated: pnlUsdDisplay.estimated })}`}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 space-y-0.5 text-[10px]">
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500 uppercase">TP</span>
                        <span className="text-success text-right break-words max-w-[70%]">
                          {formatPositionTakeProfitTargets(pos)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500 uppercase">SL</span>
                        <span className="text-rose-400">{pos.stopLossPrice?.toFixed(2) || '-'}</span>
                      </div>
                    </div>

                    <div className="mt-2 flex justify-between text-[9px] text-slate-500">
                      <span>{type === 'pending' ? 'Created' : 'Opened'}</span>
                      <span>{formatCompactDateTime(pos.openedAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
