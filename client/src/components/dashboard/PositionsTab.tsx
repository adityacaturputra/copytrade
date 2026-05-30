import { HoverTapTooltip } from './HoverTapTooltip';
import { getCompactDateTimeParts } from './types';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Position, DraftTrade, formatUsd, formatCompactDateTime, getPositionSourceLabel, getPositionKey, formatPositionTakeProfitTargets, calculatePositionPnlUsd, estimatePositionMargin, formatMarginMode, resolvePositionPnlUsd, resolvePositionPnlPercent, DraftAction } from './types';
import { PaginationBar } from './PaginationBar';
import { StatusBadge } from './StatusBadge';
import { ProcessLogsAccordion } from './ProcessLogsAccordion';
import { PositionSummaryPanel } from './PositionSummaryPanel';
import { ImageModal } from './ImageModal';

export function PositionsTab({
  channelIdFilter,
  accountIdFilter,
  refreshKey,
  livePositions = [],
  channelNames,
}: {
  channelIdFilter: string;
  accountIdFilter: string;
  refreshKey: number;
  livePositions?: Position[];
  channelNames: Record<string, string>;
}) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [positionFilter, setPositionFilter] = useState<
    "open" | "closed" | "pending"
  >("closed");
  const [statusCounts, setStatusCounts] = useState<{
    open: number;
    closed: number;
    pending: number;
  }>({
    open: 0,
    closed: 0,
    pending: 0,
  });
  const [expandedPosId, setExpandedPosId] = useState<string | null>(null);
  const expandedLogsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to expanded logs panel when opened, scroll back to row when closed
  useEffect(() => {
    if (expandedPosId) {
      // Small delay to let React render the logs panel
      const timer = setTimeout(() => {
        expandedLogsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
      return () => clearTimeout(timer);
    } else {
      // Scroll back to the position row (if any was previously expanded)
      // We rely on the browser's native scroll-restoration for the row
    }
  }, [expandedPosId]);

  const handleToggleExpand = useCallback(
    (posId: string) => {
      if (expandedPosId === posId) {
        // Closing — scroll back to the row first, then close
        const row = document.getElementById(`pos-row-${posId}`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        // Small delay so scroll starts before the panel disappears
        setTimeout(() => setExpandedPosId(null), 150);
      } else {
        // Opening — just set the id, useEffect handles scroll
        setExpandedPosId(posId);
      }
    },
    [expandedPosId],
  );

  const fetchStatusCounts = useCallback(async (signal?: AbortSignal) => {
    try {
      const statuses: Array<"open" | "closed" | "pending"> = [
        "open",
        "closed",
        "pending",
      ];
      const countPromises = statuses.map(async (status) => {
        const params = new URLSearchParams({
          page: "1",
          limit: "1",
          status,
        });
        if (channelIdFilter !== "all") params.set("channelId", channelIdFilter);
        if (accountIdFilter !== "all") params.set("accountId", accountIdFilter);
        const res = await fetch(`/api/positions?${params}`, { signal });
        const json = await res.json();
        return [
          status,
          json?.success ? (json.data?.totalCount ?? 0) : 0,
        ] as const;
      });

      const counts = await Promise.all(countPromises);
      setStatusCounts({
        open: counts.find(([status]) => status === "open")?.[1] || 0,
        closed: counts.find(([status]) => status === "closed")?.[1] || 0,
        pending: counts.find(([status]) => status === "pending")?.[1] || 0,
      });
    } catch (e: any) {
      if (e.name === "AbortError") return;
    }
  }, [channelIdFilter, accountIdFilter]);

  const fetchPositions = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        status: positionFilter,
      });
      if (channelIdFilter !== "all") params.set("channelId", channelIdFilter);
      if (accountIdFilter !== "all") params.set("accountId", accountIdFilter);
      const res = await fetch(`/api/positions?${params}`, { signal });
      const json = await res.json();
      if (json.success) {
        setPositions(json.data.positions);
        setTotalCount(json.data.totalCount);
        setTotalPages(json.data.totalPages);
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
    }
    setLoading(false);
  }, [page, pageSize, positionFilter, channelIdFilter, accountIdFilter]);

  useEffect(() => {
    const controller = new AbortController();
    fetchPositions(controller.signal);
    return () => controller.abort();
  }, [fetchPositions, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetchStatusCounts(controller.signal);
    return () => controller.abort();
  }, [fetchStatusCounts, refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, channelIdFilter, accountIdFilter, positionFilter]);

  const getStatusColor = (status: string) => {
    if (status === "open") return "bg-primary-600/30 text-primary-300";
    if (status === "closed") return "bg-slate-700 text-slate-300";
    if (status === "pending") return "bg-amber-600/30 text-amber-300";
    return "bg-slate-800 text-slate-400";
  };

  if (loading && positions.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="spinner mx-auto mb-3" />
        <p>Loading positions...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Open / Closed sub-tabs + Refresh */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 mb-4 pb-2">
        <button
          onClick={() => setPositionFilter("open")}
          className={`px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition flex items-center gap-1.5 whitespace-nowrap ${
            positionFilter === "open"
              ? "border-green-500 text-green-400"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          🔓 Open
          <span
            className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
              positionFilter === "open"
                ? "bg-green-600/30 text-green-300"
                : "bg-slate-700 text-slate-400"
            }`}
          >
            {statusCounts.open}
          </span>
        </button>
        <button
          onClick={() => setPositionFilter("closed")}
          className={`px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition flex items-center gap-1.5 whitespace-nowrap ${
            positionFilter === "closed"
              ? "border-slate-400 text-slate-300"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          📋 Closed
          <span
            className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
              positionFilter === "closed"
                ? "bg-slate-600/30 text-slate-300"
                : "bg-slate-700 text-slate-400"
            }`}
          >
            {statusCounts.closed}
          </span>
        </button>
        <button
          onClick={() => setPositionFilter("pending")}
          className={`px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition flex items-center gap-1.5 whitespace-nowrap ${
            positionFilter === "pending"
              ? "border-amber-500 text-amber-400"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          ⏳ Pending
          <span
            className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
              positionFilter === "pending"
                ? "bg-amber-600/30 text-amber-300"
                : "bg-slate-700 text-slate-400"
            }`}
          >
            {statusCounts.pending}
          </span>
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            fetchPositions();
            fetchStatusCounts();
          }}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 transition mb-1"
        >
          🔄 Refresh
        </button>
      </div>

      {positions.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <div className="text-4xl mb-2">
            {positionFilter === "open"
              ? "📭"
              : positionFilter === "closed"
                ? "📋"
                : "⏳"}
          </div>
          <p>
            {positionFilter === "open"
              ? "No open positions."
              : positionFilter === "closed"
                ? "No closed positions yet."
                : "No pending limit orders."}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="sm:hidden flex flex-col gap-3 pb-4">
            {positions.map((pos) => {
              const livePos =
                pos.status === "open" && livePositions.length > 0
                  ? livePositions.find(
                      (lp) => (lp._id || lp.id) === (pos._id || pos.id),
                    )
                  : null;
              const displayPosition = livePos ? { ...pos, ...livePos } : pos;
              const pnlUsdDisplay = resolvePositionPnlUsd(displayPosition);
              const pnlPercent = resolvePositionPnlPercent(displayPosition);
              const displayMarginType = displayPosition.marginType;
              const estimatedMargin =
                displayPosition.margin ??
                estimatePositionMargin(displayPosition);
              const sourceLabel = getPositionSourceLabel(pos, channelNames);

              const isExpanded = expandedPosId === (pos._id || String(pos.id));

              return (
                <div
                  key={`mobile-${pos._id || pos.id}`}
                  className="bg-slate-800/40 rounded-lg border border-slate-700/50 p-3"
                >
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-200">
                        {pos.symbol}
                      </span>
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
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${getStatusColor(pos.status)}`}
                    >
                      {pos.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                      <span className="text-[9px] text-slate-500 uppercase">
                        Entry
                      </span>
                      <span className="text-xs font-mono text-slate-300">
                        {pos.entryPrice?.toFixed(4) || "-"}
                      </span>
                    </div>
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
                        PNL
                      </span>
                      <div
                        className={`text-xs font-mono font-bold ${
                          positionFilter === "pending"
                            ? "text-slate-400"
                            : pnlUsdDisplay.value !== null
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
                        {positionFilter === "pending" ||
                        pnlUsdDisplay.value === null
                          ? "-"
                          : `${pnlUsdDisplay.value > 0 ? "+" : ""}${formatUsd(pnlUsdDisplay.value, { estimated: pnlUsdDisplay.estimated })}`}
                        {positionFilter === "open" && pnlPercent !== null && (
                          <span className="text-[9px] ml-1 opacity-80 font-normal">
                            ({pnlPercent >= 0 ? "+" : ""}
                            {pnlPercent.toFixed(2)}%)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                      <span className="text-[9px] text-slate-500 uppercase">
                        Margin
                      </span>
                      <span className="text-xs font-mono text-slate-300">
                        {formatUsd(estimatedMargin, {
                          estimated: displayPosition.margin == null,
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
                  </div>

                  <div className="flex flex-col gap-1 mb-3 text-[10px] text-slate-500">
                    <div className="flex justify-between">
                      <span>Opened</span>
                      <span>{formatCompactDateTime(pos.openedAt)}</span>
                    </div>
                    {pos.closedAt && (
                      <div className="flex justify-between">
                        <span>Closed</span>
                        <span>{formatCompactDateTime(pos.closedAt)}</span>
                      </div>
                    )}
                    {pos.closeReason && (
                      <div className="bg-slate-900/50 p-1.5 rounded mt-1 border border-slate-700/50 relative min-w-0 overflow-visible">
                        <span className="text-[9px] text-slate-500 uppercase block mb-0.5">
                          Close Reason
                        </span>
                        <HoverTapTooltip
                          wrapperClassName="block min-w-0 max-w-full"
                          triggerClassName="block w-full min-w-0 text-left text-slate-300"
                          tooltipClassName="left-0 right-auto top-full bottom-auto mt-2 mb-0 min-w-[220px] max-w-[min(22rem,calc(100vw-2rem))]"
                          trigger={
                            <span className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-slate-400">
                              {pos.closeReason}
                            </span>
                          }
                          content={pos.closeReason}
                        />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() =>
                      setExpandedPosId(
                        isExpanded ? null : pos._id || String(pos.id),
                      )
                    }
                    className={`w-full text-xs py-1.5 rounded transition-colors flex items-center justify-center gap-1 ${
                      isExpanded
                        ? "bg-slate-700 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {isExpanded ? "▲ Hide Logs" : "▶ View Logs"}
                  </button>

                  {isExpanded && (
                    <div className="mt-3 bg-slate-900/80 rounded-lg p-2 border border-slate-700/50 w-full min-w-0 overflow-hidden">
                      <ProcessLogsAccordion
                        processId={pos.processId}
                        refreshKey={refreshKey}
                        hideHeader={true}
                        defaultOpen={true}
                      />
                    </div>
                  )}
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
                  <th>Entry</th>
                  {positionFilter === "open" && <th>Current</th>}
                  <th>Mode</th>
                  <th>Margin</th>
                  <th>PnL</th>
                  {positionFilter === "closed" && <th>Close Reason</th>}
                  {positionFilter === "pending" && <th>Status</th>}
                  <th>Opened</th>
                  {positionFilter === "closed" && <th>Closed</th>}
                  <th className="text-right">Logs</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const livePos =
                    pos.status === "open" && livePositions.length > 0
                      ? livePositions.find(
                          (lp) => (lp._id || lp.id) === (pos._id || pos.id),
                        )
                      : null;
                  const displayPosition = livePos
                    ? { ...pos, ...livePos }
                    : pos;
                  const displayCurrentPrice =
                    displayPosition.currentPrice || displayPosition.entryPrice;
                  const displayMarginType = displayPosition.marginType;
                  const estimatedMargin =
                    displayPosition.margin ??
                    estimatePositionMargin(displayPosition);
                  const pnlUsdDisplay = resolvePositionPnlUsd(displayPosition);
                  const pnlPercent = resolvePositionPnlPercent(displayPosition);
                  const pnlClass =
                    positionFilter === "pending"
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
                  const closedAtParts = getCompactDateTimeParts(pos.closedAt);

                  return (
                    <tr
                      id={`pos-row-${pos._id || pos.id}`}
                      key={`desktop-${pos._id || pos.id}`}
                      className={
                        positionFilter === "pending"
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
                            <span className="block truncate">
                              {sourceLabel}
                            </span>
                          }
                          content={sourceLabel}
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        {pos.entryPrice?.toFixed(4)}
                      </td>
                      {positionFilter === "open" && (
                        <td className="whitespace-nowrap">
                          {displayCurrentPrice?.toFixed(4) || "-"}
                        </td>
                      )}
                      <td>
                        <span className="badge badge-neutral">
                          {formatMarginMode(displayMarginType)}
                        </span>
                      </td>
                      <td className="font-mono whitespace-nowrap">
                        {formatUsd(estimatedMargin, {
                          estimated:
                            positionFilter === "pending" &&
                            displayPosition.margin == null,
                        })}
                      </td>
                      <td className={`font-mono whitespace-nowrap ${pnlClass}`}>
                        <span className="inline-flex items-center gap-1">
                          {positionFilter === "pending" ||
                          pnlUsdDisplay.value === null
                            ? "-"
                            : `${pnlUsdDisplay.value >= 0 ? "+" : ""}${formatUsd(pnlUsdDisplay.value, { estimated: pnlUsdDisplay.estimated })}`}
                        </span>
                        {positionFilter === "open" && pnlPercent !== null && (
                          <span className="text-[10px] opacity-80 whitespace-nowrap">
                            ({pnlPercent >= 0 ? "+" : ""}
                            {pnlPercent.toFixed(2)}%)
                          </span>
                        )}
                      </td>
                      {positionFilter === "closed" && (
                        <td className="text-xs text-slate-400 min-w-0 max-w-[12rem]">
                          {pos.closeReason ? (
                            <HoverTapTooltip
                              wrapperClassName="block max-w-full w-full"
                              triggerClassName="block w-full text-left"
                              tooltipClassName="left-0 min-w-[220px] max-w-[360px]"
                              trigger={
                                <span className="block w-full truncate text-slate-400">
                                  {pos.closeReason}
                                </span>
                              }
                              content={pos.closeReason}
                            />
                          ) : (
                            "-"
                          )}
                        </td>
                      )}
                      {positionFilter === "pending" && (
                        <td>
                          <span className="inline-flex items-center gap-1 badge badge-warning">
                            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                            Pending
                          </span>
                        </td>
                      )}
                      <td className="text-[10px] text-slate-400 leading-tight whitespace-nowrap">
                        <div>{openedAtParts.date}</div>
                        <div className="text-slate-500">
                          {openedAtParts.time}
                        </div>
                      </td>
                      {positionFilter === "closed" && (
                        <td className="text-[10px] text-slate-400 leading-tight whitespace-nowrap">
                          {pos.closedAt ? (
                            <>
                              <div>{closedAtParts.date}</div>
                              <div className="text-slate-500">
                                {closedAtParts.time}
                              </div>
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                      )}
                      <td className="text-right">
                        <button
                          onClick={() =>
                            handleToggleExpand(pos._id || String(pos.id))
                          }
                          className={`text-[10px] px-2 py-1 rounded transition-colors ${
                            expandedPosId === (pos._id || String(pos.id))
                              ? "bg-slate-700 text-white"
                              : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                          }`}
                        >
                          {expandedPosId === (pos._id || String(pos.id))
                            ? "▼ Hide"
                            : "▶ Logs"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Expanded Logs — rendered outside the table to avoid table-layout constraints */}
            {expandedPosId && (
              <div
                ref={expandedLogsRef}
                className="mt-4 rounded-lg border border-slate-700/70 bg-slate-900/30 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">
                      📋 Process Logs
                    </span>
                    {(() => {
                      const expandedPos = positions.find(
                        (p) => (p._id || String(p.id)) === expandedPosId,
                      );
                      return expandedPos ? (
                        <>
                          <span className="badge badge-neutral">
                            {expandedPos.symbol}
                          </span>
                          <span
                            className={`badge ${expandedPos.side === "LONG" ? "badge-success" : "badge-danger"}`}
                          >
                            {expandedPos.side}
                          </span>
                          {expandedPos.processId && (
                            <span className="truncate rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                              {expandedPos.processId}
                            </span>
                          )}
                        </>
                      ) : null;
                    })()}
                  </div>
                  <button
                    onClick={() => handleToggleExpand(expandedPosId)}
                    className="text-xs text-slate-400 hover:text-white transition px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                  >
                    ✕ Close
                  </button>
                </div>
                <ProcessLogsAccordion
                  processId={
                    positions.find(
                      (p) => (p._id || String(p.id)) === expandedPosId,
                    )?.processId
                  }
                  refreshKey={refreshKey}
                  hideHeader={true}
                  defaultOpen={true}
                />
              </div>
            )}
          </div>
        </>
      )}
      <PaginationBar
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        totalPages={totalPages}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
