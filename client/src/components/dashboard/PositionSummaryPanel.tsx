import { HoverTapTooltip } from './HoverTapTooltip';
import { getCompactDateTimeParts } from './types';
import React, { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Position, DraftTrade, formatUsd, formatCompactDateTime, getPositionSourceLabel, getPositionKey, formatPositionTakeProfitTargets, calculatePositionPnlUsd, estimatePositionMargin, formatMarginMode, resolvePositionPnlUsd, resolvePositionPnlPercent, DraftAction } from './types';
import { PaginationBar } from './PaginationBar';
import { StatusBadge } from './StatusBadge';
import { ProcessLogsAccordion } from './ProcessLogsAccordion';

export function PositionSummaryPanel({
  positions,
  title,
  borderColor,
  dotColor,
  dotAnimate = false,
  type,
  channelNames,
  loadingExchange = false,
  footerNote,
}: {
  positions: Position[];
  title: ReactNode;
  borderColor?: string;
  dotColor: string;
  dotAnimate?: boolean;
  type: "open" | "pending";
  channelNames: Record<string, string>;
  loadingExchange?: boolean;
  footerNote?: ReactNode;
}) {
  if (positions.length === 0) return null;

  return (
    <div className={`card ${borderColor || ""}`}>
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span
          className={`w-2 h-2 ${dotColor} rounded-full ${dotAnimate ? "animate-pulse" : "pulse-dot"}`}
        />
        {title}
        {type === "open" && loadingExchange && (
          <div
            className="spinner w-3 h-3 border-2 ml-2"
            title="Syncing PnL..."
          />
        )}
      </h2>

      {/* Mobile Card View */}
      <div className="sm:hidden flex flex-col gap-3">
        {positions.map((pos) => {
          const estimatedMargin = pos.margin ?? estimatePositionMargin(pos);
          const pnlUsdDisplay = resolvePositionPnlUsd(pos);
          const pnlPercent = resolvePositionPnlPercent(pos);
          const sourceLabel = getPositionSourceLabel(pos, channelNames);
          const displayMarginType = pos.marginType;

          return (
            <div
              key={`summary-mobile-${pos._id || pos.id}`}
              className="bg-slate-800/40 rounded-lg border border-slate-700/50 p-3"
            >
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-200">{pos.symbol}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      pos.side === "LONG"
                        ? "bg-emerald-950 text-emerald-400"
                        : "bg-red-950 text-red-400"
                    }`}
                  >
                    {pos.side}
                  </span>
                </div>
                {type === "pending" ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-600/30 text-amber-300 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                    PENDING
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-600/30 text-primary-300">
                    OPEN
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                  <span className="text-[9px] text-slate-500 uppercase">
                    {type === "pending" ? "Limit" : "Entry"}
                  </span>
                  <span className="text-xs font-mono text-slate-300">
                    {pos.entryPrice?.toFixed(4) || "-"}
                  </span>
                </div>
                {type === "open" && (
                  <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                    <span className="text-[9px] text-slate-500 uppercase">
                      Current
                    </span>
                    <span className="text-xs font-mono text-slate-300">
                      {pos.currentPrice?.toFixed(4) || "-"}
                    </span>
                  </div>
                )}
                <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                  <span className="text-[9px] text-slate-500 uppercase">
                    Mode
                  </span>
                  <span className="text-xs font-mono text-slate-300">
                    {formatMarginMode(displayMarginType)}
                  </span>
                </div>
                <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                  <span className="text-[9px] text-slate-500 uppercase">
                    Margin
                  </span>
                  <span className="text-xs font-mono text-slate-300">
                    {formatUsd(estimatedMargin, {
                      estimated: pos.margin == null,
                    })}
                  </span>
                </div>
                <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                  <span className="text-[9px] text-slate-500 uppercase">
                    Source
                  </span>
                  <span className="text-xs text-slate-300 truncate">
                    {sourceLabel}
                  </span>
                </div>
                {type === "open" && (
                  <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                    <span className="text-[9px] text-slate-500 uppercase">
                      PNL
                    </span>
                    <div
                      className={`text-xs font-mono font-bold ${
                        pnlUsdDisplay.value !== null
                          ? pnlUsdDisplay.value >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                          : pnlPercent !== null
                            ? pnlPercent >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                            : "text-slate-400"
                      }`}
                    >
                      {pnlUsdDisplay.value !== null
                        ? `${pnlUsdDisplay.value >= 0 ? "+" : ""}${formatUsd(pnlUsdDisplay.value, { estimated: pnlUsdDisplay.estimated })}`
                        : "-"}
                      {pnlPercent !== null && (
                        <span className="text-[9px] ml-1 opacity-80 font-normal">
                          ({pnlPercent >= 0 ? "+" : ""}
                          {pnlPercent.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* TP / SL row */}
              <div className="space-y-1 text-[10px] mb-2">
                <div className="flex justify-between">
                  <span className="text-slate-500 uppercase">TP</span>
                  <span className="text-success break-words text-right max-w-[70%]">
                    {formatPositionTakeProfitTargets(pos)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 uppercase">SL</span>
                  <span className="text-danger">
                    {pos.stopLossPrice?.toFixed(2) || "-"}
                  </span>
                </div>
              </div>

              <div className="flex justify-between text-[10px] text-slate-500">
                <span>Opened</span>
                <span>{formatCompactDateTime(pos.openedAt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block overflow-visible">
        <table className="data-table data-table-compact">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Source</th>
              <th>{type === "pending" ? "Limit Price" : "Entry"}</th>
              {type === "open" && <th>Current</th>}
              <th>Mode</th>
              <th>Margin</th>
              {type === "open" && (
                <>
                  <th>TP</th>
                  <th>SL</th>
                </>
              )}
              {type === "pending" && (
                <>
                  <th>TP</th>
                  <th>SL</th>
                </>
              )}
              {type === "open" && <th>PnL</th>}
              {type === "pending" && <th>Status</th>}
              <th>{type === "pending" ? "Created" : "Opened"}</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const estimatedMargin = pos.margin ?? estimatePositionMargin(pos);
              const pnlUsdDisplay = resolvePositionPnlUsd(pos);
              const pnlPercent = resolvePositionPnlPercent(pos);
              const pnlClass =
                type === "pending"
                  ? "text-slate-400"
                  : pnlUsdDisplay.value !== null
                    ? pnlUsdDisplay.value >= 0
                      ? "text-success"
                      : "text-danger"
                    : pnlPercent !== null
                      ? pnlPercent >= 0
                        ? "text-success"
                        : "text-danger"
                      : "text-slate-400";
              const sourceLabel = getPositionSourceLabel(pos, channelNames);
              const openedAtParts = getCompactDateTimeParts(pos.openedAt);

              return (
                <tr
                  key={pos._id || pos.id}
                  className={
                    type === "pending"
                      ? "opacity-80 border-b border-slate-700/50"
                      : "border-b border-slate-700/50"
                  }
                >
                  <td className="font-medium">{pos.symbol}</td>
                  <td>
                    <span
                      className={`badge ${pos.side === "LONG" ? "badge-success" : "badge-danger"}`}
                    >
                      {pos.side}
                    </span>
                  </td>
                  <td className="text-slate-300">
                    <HoverTapTooltip
                      wrapperClassName="max-w-[120px]"
                      triggerClassName="block truncate"
                      tooltipClassName="left-0 min-w-[160px] max-w-[280px]"
                      trigger={
                        <span className="block truncate">{sourceLabel}</span>
                      }
                      content={sourceLabel}
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    {pos.entryPrice?.toFixed(4)}
                  </td>
                  {type === "open" && (
                    <td className="whitespace-nowrap">
                      {pos.currentPrice?.toFixed(4) || "-"}
                    </td>
                  )}
                  <td>
                    <span className="badge badge-neutral">
                      {formatMarginMode(pos.marginType)}
                    </span>
                  </td>
                  <td className="font-mono whitespace-nowrap">
                    {formatUsd(estimatedMargin, {
                      estimated: type === "pending" && pos.margin == null,
                    })}
                  </td>
                  {type === "open" && (
                    <>
                      <td className="text-success min-w-0">
                        {formatPositionTakeProfitTargets(pos, {
                          includePercent: true,
                        })}
                      </td>
                      <td className="text-danger whitespace-nowrap">
                        {pos.stopLossPrice?.toFixed(2) || "-"}
                      </td>
                    </>
                  )}
                  {type === "pending" && (
                    <>
                      <td className="text-success min-w-0">
                        {formatPositionTakeProfitTargets(pos)}
                      </td>
                      <td className="text-danger whitespace-nowrap">
                        {pos.stopLossPrice?.toFixed(2) || "-"}
                      </td>
                    </>
                  )}
                  {type === "open" && (
                    <td className={`font-mono whitespace-nowrap ${pnlClass}`}>
                      <span className="inline-flex items-center gap-1">
                        {pnlUsdDisplay.value !== null &&
                        pnlUsdDisplay.value >= 0
                          ? "+"
                          : ""}
                        {formatUsd(pnlUsdDisplay.value, {
                          estimated: pnlUsdDisplay.estimated,
                        })}
                      </span>
                      {pnlPercent !== null && (
                        <span className="text-[10px] opacity-80 whitespace-nowrap ml-1">
                          ({pnlPercent >= 0 ? "+" : ""}
                          {pnlPercent.toFixed(2)}%)
                        </span>
                      )}
                    </td>
                  )}
                  {type === "pending" && (
                    <td>
                      <span className="inline-flex items-center gap-1 badge badge-warning">
                        <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                        Pending
                      </span>
                    </td>
                  )}
                  <td className="text-[10px] text-slate-400 leading-tight whitespace-nowrap">
                    <div>{openedAtParts.date}</div>
                    <div className="text-slate-500">{openedAtParts.time}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {footerNote && <div className="mt-3">{footerNote}</div>}
    </div>
  );
}
