import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LOG_LEVEL_FILTERS } from './types';
import { InlineLogDetails } from './InlineLogDetails';
import { Log, Message, formatCompactDateTime, getLogLevelBadgeClass } from './types';
import { HoverTapTooltip } from './HoverTapTooltip';

export function ProcessLogsAccordion({
  processId,
  accountId,
  symbol,
  refreshKey,
  defaultOpen = false,
  hideHeader = false,
}: {
  processId?: string;
  accountId?: string;
  symbol?: string;
  refreshKey: number;
  defaultOpen?: boolean;
  hideHeader?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New states for terminal UI
  const [hideCronNoise, setHideCronNoise] = useState(true);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(100);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const observerTarget = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchProcessLogs = useCallback(async () => {
    if (!processId && !symbol) return; // Need at least one

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const shouldHideRoutineNoise =
        hideCronNoise && !selectedLevels.includes("debug");
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        hideCronNoise: String(shouldHideRoutineNoise),
        order: "desc", // Latest first, will be flipped by flex-col-reverse
      });

      if (processId) params.set("processId", processId);
      if (accountId) params.set("accountId", accountId);
      if (symbol) params.set("symbol", symbol);
      if (selectedLevels.length > 0) {
        params.set("levels", selectedLevels.join(","));
      }

      const res = await fetch(`/api/logs?${params}`, {
        signal: controller.signal,
      });
      const json = await res.json();

      if (!controller.signal.aborted) {
        if (!json.success) {
          throw new Error(json.error || "Failed to load process logs");
        }
        setLogs((prev) =>
          page === 1 ? json.data.logs : [...prev, ...json.data.logs],
        );
        setTotalCount(json.data.totalCount);
        setTotalPages(json.data.totalPages);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(
          err instanceof Error ? err.message : "Failed to load process logs",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [
    processId,
    accountId,
    symbol,
    page,
    pageSize,
    hideCronNoise,
    selectedLevels,
  ]);

  // Fetch when opened
  useEffect(() => {
    if (!isOpen) return;
    fetchProcessLogs();
  }, [isOpen, fetchProcessLogs]);

  // Reset and fetch when refreshKey changes (if open)
  useEffect(() => {
    if (!isOpen) return;
    setLogs([]);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Reset when filters change
  useEffect(() => {
    if (!isOpen) return;
    setLogs([]);
    setPage(1);
  }, [hideCronNoise, selectedLevels, pageSize, isOpen]);

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

  const renderCompactLog = (log: Log) => {
    const dateStr = new Date(
      log.createdAt || log.created_at || "",
    ).toLocaleString();
    const levelText = (log.level || log.result || "").toUpperCase();

    return (
      <div
        key={log._id || log.id}
        className="hover:bg-slate-800/30 p-2 sm:px-1 sm:py-0 -mx-1 rounded transition-colors flex flex-col gap-1 border-b border-slate-800/50"
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-slate-500">{dateStr}</span>
          <span className="text-slate-700">|</span>
          <span className={`${getTerminalColor(levelText)} font-bold`}>
            {levelText || "INFO"}
          </span>
          <span className="text-slate-700">|</span>
          <span className="text-fuchsia-400 truncate">{log.type}</span>
          <span className="text-slate-700">|</span>
          <span className="text-slate-300 truncate">{log.action}</span>
        </div>
        <div className="min-w-0 text-slate-400 leading-relaxed whitespace-pre-wrap break-words text-[11px]">
          <InlineLogDetails text={log.details} />
          {log.error && (
            <span className="text-red-400 ml-1 block mt-1">
              Error: {log.error}
            </span>
          )}
          {log.symbol && (
            <span className="text-primary-400 ml-1 block mt-1">
              [{log.symbol}]
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={
        hideHeader
          ? "w-full min-w-0"
          : "mt-3 rounded-lg border border-slate-700/70 bg-slate-900/30"
      }
    >
      {!hideHeader && (
        <button
          onClick={() => setIsOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-slate-300">{isOpen ? "▼" : "▶"}</span>
            <span className="font-medium text-slate-200">Process Logs</span>
            {processId ? (
              <span className="truncate rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                {processId}
              </span>
            ) : symbol ? (
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500 font-mono">
                {symbol}
              </span>
            ) : (
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500">
                legacy
              </span>
            )}
          </div>
          <span className="text-xs text-slate-500">{totalCount} logs</span>
        </button>
      )}

      {(isOpen || hideHeader) && (
        <div
          className={
            hideHeader ? "py-2" : "border-t border-slate-700/70 px-3 py-3"
          }
        >
          {!(processId || symbol) ? (
            <p className="text-xs text-slate-500">
              Entitas ini belum memiliki identifier log yang valid, jadi
              timeline proses belum bisa ditampilkan.
            </p>
          ) : (
            <>
              {/* Filter bar */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setLogs([]);
                      setPage(1);
                      fetchProcessLogs();
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
                  >
                    <span>{hideCronNoise ? "🙈" : "👁️"}</span>
                    <span>Routine noise</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  onClick={() => setSelectedLevels([])}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] sm:text-xs font-medium transition border ${
                    selectedLevels.length === 0
                      ? "bg-primary-600/20 border-primary-500/40 text-primary-200"
                      : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  All levels
                </button>
                {LOG_LEVEL_FILTERS.map((level) => {
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
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] sm:text-xs font-medium transition border ${
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

              {!loading && error && (
                <p className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300 mb-3">
                  {error}
                </p>
              )}

              {/* Terminal Log View */}
              <div className="flex flex-col-reverse h-[400px] overflow-y-auto overflow-x-hidden bg-[#0D1117] rounded-lg border border-slate-800 p-3 font-mono text-[11px] leading-relaxed relative">
                {loading && logs.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-8">
                    <div className="spinner mx-auto mb-3" />
                    <p>Loading terminal...</p>
                  </div>
                ) : !loading && totalCount === 0 && !error ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-8">
                    <p>No activity logs yet.</p>
                  </div>
                ) : (
                  <>
                    {logs.map((log) =>
                      hideHeader ? (
                        renderCompactLog(log)
                      ) : (
                        <div
                          key={log._id || log.id}
                          className="hover:bg-slate-800/30 p-2 sm:px-1 sm:py-0 -mx-1 rounded transition-colors flex flex-col gap-1 sm:grid sm:grid-cols-[140px_10px_60px_10px_140px_10px_180px_20px_1fr] sm:items-start border-b border-slate-800/50 sm:border-none"
                        >
                          {/* Mobile Header */}
                          <div className="flex items-center gap-2 sm:hidden text-xs">
                            <span className="text-slate-500">
                              {new Date(
                                log.createdAt || log.created_at || "",
                              ).toLocaleString()}
                            </span>
                            <span className="text-slate-700">|</span>
                            <span
                              className={`${getTerminalColor(
                                (log.level || log.result || "").toUpperCase(),
                              )} font-bold`}
                            >
                              {(log.level || log.result || "").toUpperCase() ||
                                "INFO"}
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
                            {new Date(
                              log.createdAt || log.created_at || "",
                            ).toLocaleString()}
                          </span>
                          <span className="hidden sm:inline text-slate-700 text-center">
                            |
                          </span>
                          <span
                            className={`hidden sm:inline ${getTerminalColor((log.level || log.result || "").toUpperCase())} font-bold truncate`}
                          >
                            {(log.level || log.result || "").toUpperCase() ||
                              "INFO"}
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
                          <span className="min-w-0 text-slate-400 mt-1 sm:mt-0 leading-relaxed whitespace-pre-wrap break-words">
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
                      ),
                    )}

                    {/* Infinite Scroll Sentinel */}
                    {page < totalPages && (
                      <div
                        ref={observerTarget}
                        className="py-3 flex justify-center shrink-0"
                      >
                        {loading ? (
                          <div className="spinner w-4 h-4 border-2" />
                        ) : (
                          <span className="text-slate-600">
                            Loading older logs...
                          </span>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
