import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PaginationBar } from './PaginationBar';
import { LOG_LEVEL_FILTERS } from './types';
import { Log, Message, formatCompactDateTime, getLogLevelBadgeClass } from './types';
import { InlineLogDetails } from './InlineLogDetails';

export function LogsTab({
  channelIdFilter,
  accountIdFilter,
  refreshKey,
}: {
  channelIdFilter: string;
  accountIdFilter: string;
  refreshKey: number;
}) {
  const [hideCronNoise, setHideCronNoise] = useState(true);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100); // Increase page size for terminal view
  const [logs, setLogs] = useState<Log[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const observerTarget = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchLogs = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const shouldHideRoutineNoise =
        hideCronNoise && !selectedLevels.includes("debug");
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        hideCronNoise: String(shouldHideRoutineNoise),
      });
      if (selectedLevels.length > 0) {
        params.set("levels", selectedLevels.join(","));
      }
      if (channelIdFilter !== "all") params.set("channelId", channelIdFilter);
      if (accountIdFilter !== "all") params.set("accountId", accountIdFilter);
      const res = await fetch(`/api/logs?${params}`, {
        signal: controller.signal,
      });
      const json = await res.json();
      if (json.success && !controller.signal.aborted) {
        setLogs((prev) =>
          page === 1 ? json.data.logs : [...prev, ...json.data.logs],
        );
        setTotalCount(json.data.totalCount);
        setTotalPages(json.data.totalPages);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Fetch logs error:", err);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [
    page,
    pageSize,
    hideCronNoise,
    selectedLevels,
    channelIdFilter,
    accountIdFilter,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Reset to page 1 and clear logs when filter changes
  useEffect(() => {
    setLogs([]);
    setPage(1);
  }, [
    hideCronNoise,
    selectedLevels,
    pageSize,
    channelIdFilter,
    accountIdFilter,
  ]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && page < totalPages) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 },
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) observer.unobserve(currentTarget);
    };
  }, [loading, page, totalPages]);

  const getTerminalColor = (level: string) => {
    switch (level.toLowerCase()) {
      case "info":
      case "executed":
      case "started":
        return "text-blue-400";
      case "success":
      case "updated":
        return "text-emerald-400";
      case "warning":
      case "partial":
        return "text-yellow-400";
      case "error":
      case "rejected":
        return "text-red-400";
      case "debug":
      case "processing":
        return "text-slate-500";
      default:
        return "text-slate-300";
    }
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setPage(1);
              fetchLogs();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 transition"
          >
            🔄 Refresh
          </button>
          <button
            onClick={() => setHideCronNoise(!hideCronNoise)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
              hideCronNoise
                ? "bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
                : "bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700"
            }`}
            title={
              hideCronNoise
                ? "Hiding routine system logs like idle fetch cycles, pending-order heartbeats, and stream-start events."
                : "Showing all logs including routine system noise."
            }
          >
            <span>{hideCronNoise ? "🙈" : "👁️"}</span>
            <span>Routine noise</span>
          </button>
        </div>
        <span className="text-xs text-slate-500">{totalCount} logs</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setSelectedLevels([])}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
            selectedLevels.length === 0
              ? "bg-primary-600/20 border-primary-500/40 text-primary-200"
              : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
          }`}
        >
          All levels
        </button>
        {LOG_LEVEL_FILTERS.map((level: string) => {
          const active = selectedLevels.includes(level);
          return (
            <button
              key={level}
              onClick={() =>
                setSelectedLevels((current) =>
                  current.includes(level)
                    ? current.filter((item) => item !== level)
                    : [...current, level],
                )
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                active
                  ? "bg-slate-700 border-slate-600 text-slate-200"
                  : "bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700"
              }`}
            >
              {level.toUpperCase()}
            </button>
          );
        })}
      </div>

      {/* Terminal Log View */}
      <div className="flex flex-col-reverse h-[600px] overflow-y-auto bg-[#0D1117] rounded-lg border border-slate-800 p-3 font-mono text-[11px] leading-relaxed relative">
        {loading && logs.length === 0 ? (
          <div className="flex-1 flex flex-col justify-start gap-2 py-2">
            {Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                className="grid grid-cols-[120px_50px_120px_1fr] gap-3 items-center rounded px-2 py-1.5 animate-pulse"
              >
                <div className="h-3 rounded bg-slate-800/80" />
                <div className="h-3 rounded bg-slate-800/70" />
                <div className="h-3 rounded bg-slate-800/70" />
                <div className="h-3 rounded bg-slate-800/60" />
              </div>
            ))}
          </div>
        ) : !loading && totalCount === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-8">
            <p>No activity logs yet.</p>
          </div>
        ) : (
          <>
            {logs.map((log) => {
              const dateStr = new Date(
                log.createdAt || log.created_at || "",
              ).toLocaleString();
              const levelText = (log.level || log.result || "").toUpperCase();
              return (
                <div
                  key={log._id || log.id}
                  className="hover:bg-slate-800/30 p-2 sm:px-1 sm:py-0 -mx-1 rounded transition-colors flex flex-col gap-1 sm:grid sm:grid-cols-[140px_10px_60px_10px_140px_10px_180px_20px_1fr] sm:items-start border-b border-slate-800/50 sm:border-none"
                >
                  {/* Mobile Header */}
                  <div className="flex items-center gap-2 sm:hidden text-xs">
                    <span className="text-slate-500">{dateStr}</span>
                    <span className="text-slate-700">|</span>
                    <span
                      className={`${getTerminalColor(levelText)} font-bold`}
                    >
                      {levelText || "INFO"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 sm:hidden text-[11px]">
                    <span className="text-fuchsia-400 truncate">
                      {log.type}
                    </span>
                    <span className="text-slate-700">|</span>
                    <span className="text-slate-300 truncate">
                      {log.action}
                    </span>
                  </div>

                  {/* Desktop Columns */}
                  <span className="hidden sm:inline text-slate-500 truncate">
                    {dateStr}
                  </span>
                  <span className="hidden sm:inline text-slate-700 text-center">
                    |
                  </span>
                  <span
                    className={`hidden sm:inline ${getTerminalColor(levelText)} font-bold truncate`}
                  >
                    {levelText || "INFO"}
                  </span>
                  <span className="hidden sm:inline text-slate-700 text-center">
                    |
                  </span>
                  <span
                    className="hidden sm:inline text-fuchsia-400 truncate"
                    title={log.type}
                  >
                    {log.type}
                  </span>
                  <span className="hidden sm:inline text-slate-700 text-center">
                    |
                  </span>
                  <span
                    className="hidden sm:inline text-slate-300 truncate"
                    title={log.action}
                  >
                    {log.action}
                  </span>
                  <span className="hidden sm:inline text-slate-700 text-center">
                    ---
                  </span>

                  {/* Detail Body */}
                  <span className="text-slate-400 mt-1 sm:mt-0 leading-relaxed">
                    <InlineLogDetails text={log.details} />
                    {log.error && (
                      <span className="text-red-400 ml-1 block sm:inline mt-1 sm:mt-0">
                        Error: {log.error}
                      </span>
                    )}
                    {log.symbol && (
                      <span className="text-primary-400 ml-1 block sm:inline mt-1 sm:mt-0">
                        [{log.symbol}]
                      </span>
                    )}
                  </span>
                </div>
              );
            })}

            {/* Infinite Scroll Sentinel */}
            {page < totalPages && (
              <div
                ref={observerTarget}
                className="py-3 flex justify-center shrink-0"
              >
                {loading ? (
                  <div className="spinner w-4 h-4 border-2" />
                ) : (
                  <span className="text-slate-600">Loading older logs...</span>
                )}
              </div>
            )}

            {page >= totalPages && logs.length > 0 && (
              <div className="py-3 text-center text-slate-600 shrink-0 border-b border-slate-800/50 mb-2">
                --- End of logs ---
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
