"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  Fragment,
  type ReactNode,
} from "react";
import {
  Stats, Position, Message, Log, LOG_LEVEL_FILTERS, getLogLevelBadgeClass, formatUsd,
  estimatePositionMargin, calculatePositionPnlUsd, resolvePositionPnlUsd, resolvePositionPnlPercent,
  formatCompactDateTime, getCompactDateTimeParts, formatMarginMode, getPositionSourceLabel,
  getPositionKey, formatPositionTakeProfitTargets, DraftTrade, DraftAction, AccountInfo,
  RiskConfig, CronStep, CronRunStatus, SignalConfig, AccountExchangeInfo, DashboardData
} from "@/components/dashboard/types";
import { calculateRisk } from "@copytrade/shared/lib/risk/calc";
import { autoCalculateTPFromRR } from "@copytrade/shared/lib/executor/utils/signal";
import { buildBackendApiUrl } from "@/lib/backend-url";
import { getStoredActionPassword } from "@/lib/action-auth";
import { useActionAuth } from "@/lib/action-auth-context";
import { CronStatusPanel } from "@/components/dashboard/CronStatusPanel";
import { PaginationBar } from "@/components/dashboard/PaginationBar";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { SignalsTab } from "@/components/dashboard/SignalsTab";
import { LogsTab } from "@/components/dashboard/LogsTab";
import { InlineLogDetails } from "@/components/dashboard/InlineLogDetails";
import { HoverTapTooltip } from "@/components/dashboard/HoverTapTooltip";
import { ProcessLogsAccordion } from "@/components/dashboard/ProcessLogsAccordion";
import { PositionsTab } from "@/components/dashboard/PositionsTab";
import { DraftsTab } from "@/components/dashboard/DraftsTab";
import { DraftCard } from "@/components/dashboard/DraftCard";
import { PositionSummaryPanel } from "@/components/dashboard/PositionSummaryPanel";
import { ImageModal } from "@/components/dashboard/ImageModal";
// ==================== Component ====================

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingExchange, setLoadingExchange] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "positions" | "drafts" | "signals" | "logs"
  >("drafts");
  const [triggeringCron, setTriggeringCron] = useState<string | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [actingDraft, setActingDraft] = useState<string | null>(null);
  const [cronStatus, setCronStatus] = useState<Record<
    string,
    CronRunStatus
  > | null>(null);
  const [expandedCron, setExpandedCron] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("all");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const prevCronRunning = useRef<Record<string, boolean>>({});
  const {
    isUnlocked,
    isVerifying,
    error: authError,
    unlock,
    lock,
    unlockRequested,
    requestShowUnlock,
    consumeUnlockRequest,
  } = useActionAuth();
  const [menuPassword, setMenuPassword] = useState("");

  const fetchExchangeData = useCallback(async () => {
    setLoadingExchange(true);
    try {
      const res = await fetch("/api/dashboard/exchange");
      const json = await res.json();
      if (json.success) {
        setData((prev) => {
          if (!prev) return json.data;
          return {
            ...prev,
            accounts: json.data.accounts,
            openPositions: json.data.openPositions,
            stats: json.data.stats,
            account: json.data.account,
            exchangeProvider: json.data.exchangeProvider,
            exchangeError: json.data.exchangeError,
          };
        });
      }
    } catch (err) {
      console.error("Failed to fetch exchange data", err);
    } finally {
      setLoadingExchange(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setError(null);
        // Kick off the exchange fetch after core data loads
        fetchExchangeData();
      } else {
        setError(json.error || "Failed to load data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [fetchExchangeData]);

  // Poll cron status
  const fetchCronStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cron/status");
      const json = await res.json();
      if (json.success) {
        setCronStatus(json.cronStatus);
      }
    } catch {}
  }, []);

  // Cron setup check removed from dashboard — only checked on settings page
  // to avoid hitting external cron-job.org API and causing 429 rate limits

  useEffect(() => {
    fetchData();
    fetchCronStatus();
  }, [fetchData, fetchCronStatus]);

  const [showCronMenu, setShowCronMenu] = useState(false);
  const cronMenuRef = useRef<HTMLDivElement>(null);
  const [cronWarning, setCronWarning] = useState<{
    allConfigured: boolean;
    missing: string[];
  } | null>(null);

  // Detect cron completion → bump refreshKey to auto-refresh active tab
  useEffect(() => {
    if (!cronStatus) return;
    for (const [name, status] of Object.entries(cronStatus)) {
      const wasRunning = prevCronRunning.current[name];
      if (wasRunning && !status.running && status.result) {
        // Cron just completed
        setRefreshKey((k) => k + 1);
      }
      prevCronRunning.current[name] = status.running;
    }
  }, [cronStatus]);

  // Auto-open menu when unlock is requested (e.g. 403 received)
  useEffect(() => {
    if (unlockRequested) {
      setShowCronMenu(true);
      consumeUnlockRequest();
    }
  }, [unlockRequested, consumeUnlockRequest]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        cronMenuRef.current &&
        !cronMenuRef.current.contains(e.target as Node)
      ) {
        setShowCronMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const triggerCron = async (
    type:
      | "signal-check"
      | "position-monitor"
      | "tp-sl-monitor"
      | "orphan-cleanup",
  ) => {
    setTriggeringCron(type);
    try {
      const actionPassword = getStoredActionPassword();
      const headers: Record<string, string> = {};
      if (actionPassword) headers["x-action-password"] = actionPassword;
      const res = await fetch(`/api/cron/${type}`, { method: "POST", headers });
      if (res.status === 403) {
        requestShowUnlock();
        return;
      }
      const json = await res.json();
      if (json.success) {
        // Fire-and-forget — poll status to see progress
        fetchCronStatus();
      } else {
        alert(`${type} failed: ${json.error}`);
      }
      await fetchData();
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setTriggeringCron(null);
    }
  };

  const toggleMode = async () => {
    if (!data) return;
    const newMode = data.tradingMode === "auto" ? "manual" : "auto";
    setSwitchingMode(true);
    try {
      const actionPassword = getStoredActionPassword();
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(actionPassword ? { "x-action-password": actionPassword } : {}),
        },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.status === 403) {
        requestShowUnlock();
        return;
      }
      const json = await res.json();
      if (json.success) {
        setData({ ...data, tradingMode: newMode });
      }
    } catch {
      alert("Failed to switch mode");
    } finally {
      setSwitchingMode(false);
    }
  };

  const handleDraftAction = async (
    draftId: string,
    action: DraftAction,
    extraBody?: Record<string, unknown>,
  ) => {
    setActingDraft(draftId);
    try {
      const actionPassword = getStoredActionPassword();
      const draftHeaders: Record<string, string> = extraBody
        ? { "Content-Type": "application/json" }
        : {};
      if (actionPassword) draftHeaders["x-action-password"] = actionPassword;
      const res = await fetch(
        buildBackendApiUrl(`/api/drafts/${draftId}/${action}`),
        {
          method: "POST",
          headers: draftHeaders,
          body: extraBody ? JSON.stringify(extraBody) : undefined,
        },
      );
      if (res.status === 403) {
        requestShowUnlock();
        return;
      }
      const json = await res.json();
      if (json.success) {
        const successMessage =
          json.data?.message ||
          (action === "accept"
            ? "Draft accepted successfully!"
            : action === "reject"
              ? "Draft rejected successfully!"
              : action === "redraft"
                ? "Draft created again successfully!"
                : "Draft re-analyzed successfully!");
        alert(successMessage);
        setRefreshKey((k) => k + 1);
        await fetchData();
      } else {
        setRefreshKey((k) => k + 1);
        await fetchData();
        const processSuffix = json.processId
          ? `\nProcess: ${json.processId}`
          : "";
        alert(`Failed: ${json.error}${processSuffix}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setActingDraft(null);
    }
  };

  // We no longer block the entire page on load so the header can render instantly.

  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="card text-center max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold mb-2">Error Loading Dashboard</h2>
          <p className="text-slate-400 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const stats = data?.stats || {
    totalMessages: 0,
    executedSignals: 0,
    openPositions: 0,
    closedPositions: 0,
    totalLogs: 0,
    pendingDrafts: 0,
  };
  const tradingMode = data?.tradingMode || "manual";

  // ─── Collect unique channel IDs from accounts for filter ──────────
  const allChannelIds = new Set<string>();
  // Channel names are already resolved server-side from accounts
  const channelNameMap = new Map<string, string>(
    Object.entries(data?.channelNames || {}),
  );
  for (const [chId] of channelNameMap) {
    allChannelIds.add(chId);
  }
  const channelIdArray = Array.from(allChannelIds).sort();

  // Compute which account info to display based on selected filter
  const displayAccount =
    selectedAccountId !== "all"
      ? data?.accounts?.find((a) => a.accountId === selectedAccountId) || null
      : null;
  const visibleExchangeAccounts =
    selectedAccountId === "all"
      ? data?.accounts || []
      : displayAccount
        ? [displayAccount]
        : [];
  const displayAccountInfo = displayAccount?.account || null;
  const displayExchangeError = displayAccount?.exchangeError || null;
  const hasVisibleExchangeConnection = visibleExchangeAccounts.some(
    (account) => account.account !== null,
  );
  const connectedExchangeAccounts = visibleExchangeAccounts.filter(
    (account) => account.account !== null,
  );
  const demoExchangeAccounts = visibleExchangeAccounts.filter(
    (account) => account.isDemo,
  );
  const visibleBalanceTotals = connectedExchangeAccounts.reduce<
    Record<string, { totalBalance: number; availableBalance: number }>
  >((accumulator, account) => {
    const currency = account.account?.currency || "UNKNOWN";

    if (!accumulator[currency]) {
      accumulator[currency] = {
        totalBalance: 0,
        availableBalance: 0,
      };
    }

    accumulator[currency].totalBalance += account.account?.totalBalance || 0;
    accumulator[currency].availableBalance +=
      account.account?.availableBalance || 0;

    return accumulator;
  }, {});
  const visibleBalanceTotalEntries = Object.entries(visibleBalanceTotals);
  const exchangeHeaderLabel =
    selectedAccountId === "all"
      ? visibleExchangeAccounts.length > 0
        ? "MULTI ACCOUNT"
        : (data?.exchangeProvider || "unknown").toUpperCase()
      : (
          displayAccount?.tradingPlatform ||
          data?.exchangeProvider ||
          "unknown"
        ).toUpperCase();
  const openPositions =
    data?.openPositions?.filter(
      (pos) =>
        selectedAccountId === "all" || pos.accountId === selectedAccountId,
    ) || [];
  const pendingPositions =
    data?.pendingPositions?.filter(
      (pos) =>
        selectedAccountId === "all" || pos.accountId === selectedAccountId,
    ) || [];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-700 bg-dark-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="text-xl sm:text-2xl">📈</div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                  CopyTrade
                  {loading && <div className="spinner w-4 h-4 border-2" />}
                </h1>
                <p className="text-[10px] sm:text-xs text-slate-400 hidden sm:block">
                  AI-Powered Discord Signal Copier
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3">
              <a
                href="/agent"
                className="bg-purple-700 hover:bg-purple-600 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition flex items-center gap-1"
              >
                🤖 <span className="hidden sm:inline">Agent</span>
              </a>
              <div className="relative" ref={cronMenuRef}>
                <button
                  onClick={() => setShowCronMenu(!showCronMenu)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    showCronMenu
                      ? "bg-slate-700 text-white border border-slate-600"
                      : "bg-slate-800 text-slate-400 border border-slate-700"
                  }`}
                  title="Menu"
                >
                  ⋯
                </button>
                {showCronMenu && (
                  <div className="absolute right-0 mt-1 w-64 rounded-xl border border-slate-700 bg-slate-900 shadow-xl z-50 overflow-hidden">
                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700/50">
                      <span className="text-xs text-slate-300">
                        {tradingMode === "auto"
                          ? "🤖 Auto Mode"
                          : "👆 Manual Mode"}
                      </span>
                      <button
                        onClick={toggleMode}
                        disabled={switchingMode}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          tradingMode === "auto"
                            ? "bg-green-600"
                            : "bg-slate-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            tradingMode === "auto"
                              ? "translate-x-4"
                              : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>

                    {/* Cron Actions */}
                    <button
                      onClick={() => {
                        triggerCron("signal-check");
                        setShowCronMenu(false);
                      }}
                      disabled={triggeringCron === "signal-check"}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm"
                    >
                      {triggeringCron === "signal-check" ? (
                        <div className="spinner w-3.5 h-3.5 border-2" />
                      ) : (
                        <span>🔍</span>
                      )}
                      <span className="text-white text-xs">Check Signals</span>
                    </button>
                    <button
                      onClick={() => {
                        triggerCron("position-monitor");
                        setShowCronMenu(false);
                      }}
                      disabled={triggeringCron === "position-monitor"}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm border-t border-slate-700/30"
                    >
                      {triggeringCron === "position-monitor" ? (
                        <div className="spinner w-3.5 h-3.5 border-2" />
                      ) : (
                        <span>📊</span>
                      )}
                      <span className="text-white text-xs">
                        Position Monitor
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        triggerCron("tp-sl-monitor");
                        setShowCronMenu(false);
                      }}
                      disabled={triggeringCron === "tp-sl-monitor"}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm border-t border-slate-700/30"
                    >
                      {triggeringCron === "tp-sl-monitor" ? (
                        <div className="spinner w-3.5 h-3.5 border-2" />
                      ) : (
                        <span>🎯</span>
                      )}
                      <span className="text-white text-xs">TP/SL Monitor</span>
                    </button>
                    <button
                      onClick={() => {
                        triggerCron("orphan-cleanup");
                        setShowCronMenu(false);
                      }}
                      disabled={triggeringCron === "orphan-cleanup"}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm border-t border-slate-700/30"
                    >
                      {triggeringCron === "orphan-cleanup" ? (
                        <div className="spinner w-3.5 h-3.5 border-2" />
                      ) : (
                        <span>🧹</span>
                      )}
                      <span className="text-white text-xs">Orphan Cleanup</span>
                    </button>

                    {/* Divider + Settings/Refresh */}
                    <div className="border-t border-slate-700/50 flex">
                      <a
                        href="/settings"
                        className="flex-1 text-center px-3 py-2.5 hover:bg-slate-800 transition text-xs text-slate-300"
                      >
                        ⚙️ Settings
                      </a>
                      <button
                        onClick={() => {
                          fetchData();
                          setShowCronMenu(false);
                        }}
                        className="flex-1 text-center px-3 py-2.5 hover:bg-slate-800 transition text-xs text-slate-300 border-l border-slate-700/30"
                      >
                        🔄 Refresh
                      </button>
                    </div>

                    {/* Unlock/Lock */}
                    <div className="border-t border-slate-700/50 px-3 py-2.5">
                      {isUnlocked ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-emerald-400">
                            🔓 Actions unlocked
                          </span>
                          <button
                            onClick={() => {
                              lock();
                              setShowCronMenu(false);
                            }}
                            className="text-xs text-slate-400 hover:text-white transition px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                          >
                            Lock
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              value={menuPassword}
                              onChange={(e) => setMenuPassword(e.target.value)}
                              onKeyDown={async (e) => {
                                if (e.key === "Enter") {
                                  const ok = await unlock(menuPassword);
                                  if (ok) {
                                    setMenuPassword("");
                                    setShowCronMenu(false);
                                  }
                                }
                              }}
                              placeholder="🔒 Action password"
                              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-primary-500"
                              autoFocus
                            />
                            <button
                              onClick={async () => {
                                const ok = await unlock(menuPassword);
                                if (ok) {
                                  setMenuPassword("");
                                  setShowCronMenu(false);
                                }
                              }}
                              disabled={isVerifying || !menuPassword}
                              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              {isVerifying ? "..." : "Go"}
                            </button>
                          </div>
                          {authError && (
                            <p className="text-xs text-red-400">{authError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Mode Banner */}
        {tradingMode === "manual" && (
          <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-xl">👆</span>
            <div>
              <p className="text-amber-200 font-medium text-sm">
                Manual Mode Active
              </p>
              <p className="text-amber-300/70 text-xs">
                New signals will be saved as drafts for your review. Accept to
                execute.
              </p>
            </div>
            {data?.pendingDrafts && data.pendingDrafts.length > 0 && (
              <span className="ml-auto bg-amber-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                {data.pendingDrafts.length} pending
              </span>
            )}
          </div>
        )}
        {tradingMode === "auto" && (
          <div className="bg-green-900/30 border border-green-700/50 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-xl">🤖</span>
            <div>
              <p className="text-green-200 font-medium text-sm">
                Auto Mode Active
              </p>
              <p className="text-green-300/70 text-xs">
                Signals will be executed automatically. Switch to manual for
                review.
              </p>
            </div>
          </div>
        )}

        {/* Exchange Connection Status */}
        <div
          className={`rounded-xl px-3 sm:px-4 py-3.5 sm:py-4 ${
            hasVisibleExchangeConnection
              ? "border border-slate-700 bg-slate-800/50"
              : "border border-red-700/50 bg-red-900/30"
          }`}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`mt-1 h-3 w-3 shrink-0 rounded-full ${hasVisibleExchangeConnection ? "bg-green-500 pulse-dot" : "bg-red-500 animate-pulse"}`}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 flex items-center gap-2">
                      Exchange Overview
                      {loadingExchange && (
                        <div
                          className="spinner w-3 h-3 border-2"
                          title="Syncing with exchange..."
                        />
                      )}
                    </span>
                    <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
                      {exchangeHeaderLabel}
                    </span>
                    {displayAccount?.isDemo && (
                      <span className="badge badge-warning">Demo Mode</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-300">
                    {selectedAccountId === "all"
                      ? `${visibleExchangeAccounts.length} trading account${visibleExchangeAccounts.length === 1 ? "" : "s"} visible`
                      : displayAccount
                        ? `${displayAccount.accountName} • ${displayAccount.tradingPlatform.toUpperCase()}`
                        : "No account selected"}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Connected
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {connectedExchangeAccounts.length}/
                    {visibleExchangeAccounts.length}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Demo Accounts
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {demoExchangeAccounts.length}
                  </div>
                </div>
                {visibleBalanceTotalEntries.map(([currency, totals]) => (
                  <div
                    key={currency}
                    className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"
                  >
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      All Accounts ({currency})
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white">
                      {totals.totalBalance.toFixed(2)}
                    </div>
                    <div className="text-xs text-slate-400">
                      Avail. {totals.availableBalance.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedAccountId === "all" &&
            visibleExchangeAccounts.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleExchangeAccounts.map((account) => (
                  <div
                    key={account.accountId}
                    className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-white">
                          {account.accountName}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                            {account.tradingPlatform}
                          </span>
                          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-600">
                            {account.sourceType}
                          </span>
                        </div>
                      </div>
                      {account.isDemo && (
                        <span className="badge badge-warning">Demo Mode</span>
                      )}
                    </div>

                    {loadingExchange && !account.account ? (
                      <div className="mt-4 rounded-lg bg-slate-900/30 border border-slate-800 px-4 py-3 flex items-center gap-3">
                        <div className="spinner w-4 h-4 border-2" />
                        <span className="text-sm text-slate-400">
                          Loading exchange data...
                        </span>
                      </div>
                    ) : account.account ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-slate-900/70 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Balance
                          </div>
                          <div className="mt-1 font-mono text-lg font-semibold text-white">
                            {account.account.totalBalance.toFixed(2)}
                          </div>
                          <div className="text-xs text-slate-400">
                            {account.account.currency}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-900/70 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Available
                          </div>
                          <div className="mt-1 font-mono text-lg font-semibold text-white">
                            {account.account.availableBalance.toFixed(2)}
                          </div>
                          <div className="text-xs text-slate-400">
                            Free margin
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-900/70 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">
                            Unrealized PnL
                          </div>
                          <div
                            className={`mt-1 font-mono text-lg font-semibold ${
                              account.account.unrealizedPnl >= 0
                                ? "text-emerald-400"
                                : "text-rose-400"
                            }`}
                          >
                            {account.account.unrealizedPnl >= 0 ? "+" : ""}
                            {account.account.unrealizedPnl.toFixed(2)}
                          </div>
                          <div className="text-xs text-slate-400">
                            Live exchange
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">
                        ⚠️{" "}
                        {account.exchangeError ||
                          "Failed to load exchange balance."}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : loadingExchange && !displayAccountInfo ? (
              <div className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-6 flex flex-col items-center justify-center gap-3">
                <div className="spinner w-6 h-6 border-2" />
                <span className="text-sm text-slate-400">
                  Loading exchange account...
                </span>
              </div>
            ) : displayAccountInfo ? (
              <div className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-white">
                      {displayAccount?.accountName || "Selected Account"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                        {displayAccount?.tradingPlatform || exchangeHeaderLabel}
                      </span>
                      {displayAccount?.sourceType && (
                        <span className="text-[11px] uppercase tracking-[0.16em] text-slate-600">
                          {displayAccount.sourceType}
                        </span>
                      )}
                    </div>
                  </div>
                  {displayAccount?.isDemo && (
                    <span className="badge badge-warning">Demo Mode</span>
                  )}
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-900/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Balance
                    </div>
                    <div className="mt-1 font-mono text-lg font-semibold text-white">
                      {displayAccountInfo.totalBalance?.toFixed(2)}
                    </div>
                    <div className="text-xs text-slate-400">
                      {displayAccountInfo.currency}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-900/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Available
                    </div>
                    <div className="mt-1 font-mono text-lg font-semibold text-white">
                      {displayAccountInfo.availableBalance?.toFixed(2)}
                    </div>
                    <div className="text-xs text-slate-400">Free margin</div>
                  </div>
                  <div className="rounded-lg bg-slate-900/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">
                      Unrealized PnL
                    </div>
                    <div
                      className={`mt-1 font-mono text-lg font-semibold ${
                        displayAccountInfo.unrealizedPnl >= 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }`}
                    >
                      {displayAccountInfo.unrealizedPnl >= 0 ? "+" : ""}
                      {displayAccountInfo.unrealizedPnl?.toFixed(2)}
                    </div>
                    <div className="text-xs text-slate-400">Live exchange</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">
                ⚠️{" "}
                {displayExchangeError?.toLowerCase().includes("ip whitelist")
                  ? `Your IP is not in the OKX API key whitelist. Go to OKX → Profile → API Management → Edit your key → Add your current IP or disable IP restriction.`
                  : displayExchangeError?.toLowerCase().includes("enotfound") ||
                      displayExchangeError
                        ?.toLowerCase()
                        .includes("econnrefused")
                    ? `OKX servers are unreachable from your network (ISP blocking). Enable VPN to connect.`
                    : displayExchangeError}
              </div>
            )}
          </div>
        </div>

        {/* Cron Status Panel */}
        {cronStatus && (
          <CronStatusPanel
            cronStatus={cronStatus}
            expandedCron={expandedCron}
            onToggle={setExpandedCron}
          />
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-4">
          <StatCard
            label="Total Signals"
            value={stats.totalMessages.toString()}
            icon="📨"
          />
          <StatCard
            label="Executed"
            value={stats.executedSignals.toString()}
            icon="✅"
          />
          <StatCard
            label="Open Positions"
            value={stats.openPositions.toString()}
            icon="🔓"
            highlight={stats.openPositions > 0}
          />
          <StatCard
            label="Closed"
            value={stats.closedPositions.toString()}
            icon="📋"
          />
          <StatCard
            label="Pending Drafts"
            value={stats.pendingDrafts.toString()}
            icon="📝"
            highlight={stats.pendingDrafts > 0}
          />
          <StatCard
            label="Total Logs"
            value={stats.totalLogs.toString()}
            icon="📄"
          />
        </div>

        {/* Open Positions Summary */}
        <PositionSummaryPanel
          positions={openPositions}
          title={<>Active Positions ({openPositions.length})</>}
          dotColor="bg-success"
          type="open"
          channelNames={data?.channelNames || {}}
          loadingExchange={loadingExchange}
        />

        {/* Pending Limit Orders */}
        <PositionSummaryPanel
          positions={pendingPositions}
          title={
            <>
              <span className="text-amber-400">Pending Limit Orders</span>
              <span className="text-sm font-normal text-slate-400">
                ({pendingPositions.length} waiting to fill)
              </span>
            </>
          }
          borderColor="border-amber-700/30"
          dotColor="bg-amber-400"
          dotAnimate
          type="pending"
          channelNames={data?.channelNames || {}}
          footerNote={
            <p className="text-xs text-slate-500">
              ⏳ These limit orders are placed on the exchange and waiting for
              the price to reach the entry level. Margin is shown from the
              planned trade sizing when available, otherwise estimated from
              entry value divided by leverage. SL and TP are already set on the
              exchange.
            </p>
          }
        />

        {/* Tabs */}
        <div className="card">
          {/* Account & Channel Filters */}
          {((data?.accounts && data.accounts.length > 0) ||
            channelIdArray.length > 0) && (
            <div className="flex flex-col gap-3 mb-4 pb-3 border-b border-slate-700/50">
              {/* Account Filter */}
              {data?.accounts && data.accounts.length > 1 && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                    📡 Account:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        setSelectedAccountId("all");
                        setSelectedChannelId("all");
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        selectedAccountId === "all"
                          ? "bg-primary-600 text-white"
                          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      }`}
                    >
                      All Accounts
                    </button>
                    {data.accounts.map((acct) => (
                      <button
                        key={acct.accountId}
                        onClick={() => {
                          setSelectedAccountId(acct.accountId);
                          setSelectedChannelId("all");
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                          selectedAccountId === acct.accountId
                            ? "bg-primary-600 text-white"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        }`}
                      >
                        {acct.sourceType === "telegram" ? "✈️" : "🤖"}
                        <span>{acct.accountName}</span>
                        <span className="text-[10px] opacity-50 uppercase">
                          {acct.tradingPlatform}
                          {acct.isDemo ? " (demo)" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Channel Filter */}
              {channelIdArray.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                    📺 Channel:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedChannelId("all")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        selectedChannelId === "all"
                          ? "bg-primary-600 text-white"
                          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      }`}
                    >
                      All Channels
                    </button>
                    {(selectedAccountId === "all"
                      ? channelIdArray
                      : channelIdArray.filter((chId) =>
                          data?.accounts
                            ?.find((a) => a.accountId === selectedAccountId)
                            ?.channelIds?.includes(chId),
                        )
                    ).map((chId) => {
                      const sourceName = channelNameMap.get(chId);
                      const shortId =
                        chId.length > 8 ? `...${chId.slice(-6)}` : chId;
                      return (
                        <button
                          key={chId}
                          onClick={() => setSelectedChannelId(chId)}
                          title={chId}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                            selectedChannelId === chId
                              ? "bg-primary-600 text-white"
                              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                          }`}
                        >
                          {sourceName ? (
                            <span className="flex items-center gap-1.5">
                              <span>{sourceName}</span>
                              <span className="text-[10px] opacity-50 font-mono">
                                {shortId}
                              </span>
                            </span>
                          ) : (
                            <span className="font-mono">{chId}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-slate-700 mb-4 gap-0 scrollbar-hide">
            <button
              onClick={() => setActiveTab("drafts")}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition flex items-center gap-1 whitespace-nowrap ${
                activeTab === "drafts"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              📝 Drafts
              {data?.pendingDrafts && data.pendingDrafts.length > 0 && (
                <span className="bg-primary-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {data.pendingDrafts.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("positions")}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === "positions"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              📊 Positions
            </button>
            <button
              onClick={() => setActiveTab("signals")}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === "signals"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              📨 Signals
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === "logs"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              📝 Logs
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === "drafts" && (
            <DraftsTab
              channelIdFilter={selectedChannelId}
              accountIdFilter={selectedAccountId}
              refreshKey={refreshKey}
              actingDraft={actingDraft}
              onDraftAction={handleDraftAction}
              riskConfig={data?.riskConfig || null}
              accountBalance={
                displayAccountInfo?.availableBalance ||
                displayAccountInfo?.totalBalance ||
                data?.account?.availableBalance ||
                data?.account?.totalBalance ||
                0
              }
            />
          )}
          {activeTab === "positions" && (
            <PositionsTab
              channelIdFilter={selectedChannelId}
              accountIdFilter={selectedAccountId}
              refreshKey={refreshKey}
              livePositions={data?.openPositions || []}
              channelNames={data?.channelNames || {}}
            />
          )}
          {activeTab === "signals" && (
            <SignalsTab
              channelIdFilter={selectedChannelId}
              accountIdFilter={selectedAccountId}
              refreshKey={refreshKey}
            />
          )}
          {activeTab === "logs" && (
            <LogsTab
              channelIdFilter={selectedChannelId}
              accountIdFilter={selectedAccountId}
              refreshKey={refreshKey}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-700 mt-8 py-4 text-center text-xs text-slate-500">
        <p>
          CopyTrade — Automated AI Trading Signal Copier • Discord → AI →{" "}
          {exchangeHeaderLabel}
        </p>
        <p className="mt-1">
          Mode: {tradingMode === "auto" ? "🤖 Auto" : "👆 Manual"} • Exchange:{" "}
          {selectedAccountId === "all"
            ? exchangeHeaderLabel
            : displayAccount?.isDemo
              ? `${exchangeHeaderLabel} Demo`
              : exchangeHeaderLabel}{" "}
          • Cron: Signal Check every 5 min • Position Monitor every 30 min
        </p>
      </footer>
    </div>
  );
}

// ==================== Sub-Components ====================

function StatCard({
  label,
  value,
  icon,
  highlight,
  danger,
}: {
  label: string;
  value: string;
  icon: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-slate-400 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div
        className={`text-xl font-bold ${danger ? "text-danger" : highlight ? "text-success" : "text-white"}`}
      >
        {value}
      </div>
    </div>
  );
}

function formatProcessActionLabel(action: string) {
  return action
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}







/**
 * Reusable position summary panel — used for both Active Positions and
 * Pending Limit Orders on the dashboard.  Follows the same mobile-card +
 * desktop-table pattern as PositionsTab so the UI is consistent everywhere.
 */





