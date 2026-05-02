"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { calculateRisk } from "@copytrade/shared/lib/risk-calc";
import { autoCalculateTPFromRR } from "@copytrade/shared/lib/executor-signal-utils";
import { buildBackendApiUrl } from "../lib/backend-url";
import { getStoredActionPassword } from "@/lib/action-auth";
import { useActionAuth } from "@/lib/action-auth-context";

// ==================== Types ====================

interface Stats {
  totalMessages: number;
  executedSignals: number;
  openPositions: number;
  closedPositions: number;
  totalLogs: number;
  pendingDrafts: number;
}

interface Position {
  _id?: string;
  id?: number;
  accountId?: string;
  channelId?: string;
  symbol: string;
  side: string;
  entryPrice: number;
  currentPrice?: number;
  quantity: number;
  leverage: number;
  takeProfitTargets?: any[];
  stopLossPrice?: number;
  pnl: number;
  status: string;
  openedAt: string;
  closedAt?: string;
  closeReason?: string;
  processId?: string;
}

interface Message {
  _id?: string;
  id?: number;
  messageId?: string;
  message_id?: string;
  author: string;
  content: string;
  signalType?: string;
  signal_type?: string;
  status: string;
  sourceTimestamp?: string;
  createdAt?: string;
  created_at?: string;
}

interface Log {
  _id?: string;
  id?: number;
  processId?: string;
  type: string;
  action: string;
  symbol?: string;
  details?: string;
  level?: string;
  result?: string;
  error?: string;
  createdAt?: string;
  created_at?: string;
}

const LOG_LEVEL_FILTERS = [
  "debug",
  "info",
  "processing",
  "success",
  "warning",
  "error",
  "executed",
  "rejected",
  "partial",
  "started",
  "updated",
  "noop",
];

function getLogLevelBadgeClass(level: string) {
  if (level === "success" || level === "executed") return "badge-success";
  if (level === "error" || level === "rejected" || level === "fatal") {
    return "badge-danger";
  }
  if (level === "warning" || level === "partial") return "badge-warning";
  if (level === "processing" || level === "started") return "badge-info";
  if (level === "debug") return "badge-neutral";
  return "badge-neutral";
}

interface DraftTrade {
  _id: string;
  processId?: string;
  messageId: string;
  channelId: string;
  messageUrl: string;
  author: string;
  originalContent: string;
  imageUrls: string[];
  signalData: string;
  action: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice?: number;
  takeProfitTargets: number[];
  stopLoss?: number;
  leverage: number;
  quantity: number;
  confidence: number;
  reasoning: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  positionId?: string;
  sourceTimestamp?: string;
  createdAt: string;
  resolvedAt?: string;
}

type DraftAction = "accept" | "reject" | "redraft" | "reanalyze";

interface AccountInfo {
  totalBalance: number;
  availableBalance: number;
  unrealizedPnl: number;
  currency: string;
}

interface RiskConfig {
  riskPerTradePercent: number;
  maxLeverage: number;
  minLeverage: number;
  skipNoSL: boolean;
}

interface CronStep {
  message: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "error";
}

interface CronRunStatus {
  running: boolean;
  startedAt: string | null;
  progress: string;
  steps: CronStep[];
  result: "success" | "error" | null;
  error: string | null;
  completedAt: string | null;
}

interface SignalConfig {
  fetchLimit: number;
  timeWindowHours: number;
}

interface AccountExchangeInfo {
  accountId: string;
  accountName: string;
  sourceType: string;
  tradingPlatform: string;
  isDemo: boolean;
  channelIds: string[];
  account: AccountInfo | null;
  exchangeError: string | null;
}

interface DashboardData {
  stats: Stats;
  accounts: AccountExchangeInfo[];
  account: AccountInfo | null;
  exchangeProvider: string | null;
  exchangeError: string | null;
  openPositions: Position[];
  pendingPositions: Position[];
  pendingDrafts: DraftTrade[];
  tradingMode: "auto" | "manual";
  riskConfig: RiskConfig | null;
  signalConfig: SignalConfig | null;
  channelNames: Record<string, string>;
}

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
    const interval = setInterval(() => {
      fetchData();
    }, 30000);
    const cronInterval = setInterval(fetchCronStatus, 2000);
    return () => {
      clearInterval(interval);
      clearInterval(cronInterval);
    };
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
    type: "signal-check" | "position-monitor" | "tp-sl-monitor",
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
        {openPositions.length > 0 && (
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-success rounded-full pulse-dot" />
              Active Positions ({openPositions.length})
              {loadingExchange && (
                <div
                  className="spinner w-3 h-3 border-2 ml-2"
                  title="Syncing PnL..."
                />
              )}
            </h2>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Entry</th>
                    <th>Current</th>
                    <th>Leverage</th>
                    <th>TP</th>
                    <th>SL</th>
                    <th>PnL</th>
                    <th>Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((pos) => (
                    <tr key={pos._id || pos.id}>
                      <td className="font-medium">{pos.symbol}</td>
                      <td>
                        <span
                          className={`badge ${pos.side === "LONG" ? "badge-success" : "badge-danger"}`}
                        >
                          {pos.side}
                        </span>
                      </td>
                      <td>{pos.entryPrice?.toFixed(2)}</td>
                      <td>{pos.currentPrice?.toFixed(2) || "-"}</td>
                      <td>{pos.leverage}x</td>
                      <td className="text-success">
                        {pos.takeProfitTargets
                          ?.filter((t: any) => t.status === "pending")
                          .map(
                            (t: any, i: number, arr: any[]) =>
                              `TP${i + 1}: ${t.price.toFixed(2)} (${t.percentage?.toFixed(t.percentage % 1 === 0 ? 0 : 2) ?? (100 / arr.length).toFixed(0)}%)`,
                          )
                          .join(", ") || "-"}
                      </td>
                      <td className="text-danger">
                        {pos.stopLossPrice?.toFixed(2) || "-"}
                      </td>
                      <td
                        className={`font-mono ${(pos.pnl || 0) >= 0 ? "text-success" : "text-danger"}`}
                      >
                        {(pos.pnl || 0) >= 0 ? "+" : ""}
                        {pos.pnl?.toFixed(2) || "0.00"}
                      </td>
                      <td className="text-slate-400 text-xs">
                        {new Date(pos.openedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pending Limit Orders */}
        {pendingPositions.length > 0 && (
          <div className="card border-amber-700/30">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              <span className="text-amber-400">Pending Limit Orders</span>
              <span className="text-sm font-normal text-slate-400">
                ({pendingPositions.length} waiting to fill)
              </span>
            </h2>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Limit Price</th>
                    <th>Qty</th>
                    <th>Leverage</th>
                    <th>TP</th>
                    <th>SL</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPositions.map((pos) => (
                    <tr key={pos._id || pos.id} className="opacity-80">
                      <td className="font-medium">{pos.symbol}</td>
                      <td>
                        <span
                          className={`badge ${pos.side === "LONG" ? "badge-success" : "badge-danger"}`}
                        >
                          {pos.side}
                        </span>
                      </td>
                      <td className="font-mono">
                        {pos.entryPrice?.toFixed(2)}
                      </td>
                      <td>{pos.quantity}</td>
                      <td>{pos.leverage}x</td>
                      <td className="text-success">
                        {pos.takeProfitTargets
                          ?.filter((t: any) => t.status === "pending")
                          .map(
                            (t: any, i: number) =>
                              `TP${i + 1}: ${t.price.toFixed(2)}`,
                          )
                          .join(", ") || "-"}
                      </td>
                      <td className="text-danger">
                        {pos.stopLossPrice?.toFixed(2) || "-"}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 badge badge-warning">
                          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                          Pending
                        </span>
                      </td>
                      <td className="text-slate-400 text-xs">
                        {new Date(pos.openedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              ⏳ These limit orders are placed on the exchange and waiting for
              the price to reach the entry level. SL and TP are already set on
              the exchange.
            </p>
          </div>
        )}

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

function InlineLogDetails({ text }: { text?: string | null }) {
  if (!text) return null;

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");

  let startIndex = -1;
  let endIndex = -1;

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    startIndex = firstBrace;
    endIndex = lastBrace;
  } else if (
    firstBracket !== -1 &&
    lastBracket !== -1 &&
    lastBracket > firstBracket
  ) {
    startIndex = firstBracket;
    endIndex = lastBracket;
  }

  if (startIndex !== -1 && endIndex !== -1) {
    const possibleJson = text.slice(startIndex, endIndex + 1);
    try {
      const obj = JSON.parse(possibleJson);
      const formatted = JSON.stringify(obj, null, 2);
      const prefix = text.slice(0, startIndex);
      const suffix = text.slice(endIndex + 1);

      return (
        <span className="break-words">
          {prefix}
          <span className="relative group cursor-help inline-flex items-center mx-1 z-10 align-middle">
            <span className="bg-emerald-950/40 text-emerald-400 text-[9px] px-1.5 py-0.5 rounded border border-emerald-900/50 hover:bg-emerald-900/50 transition-colors whitespace-nowrap">
              ...{"{ }"} JSON
            </span>
            <span className="absolute z-[100] hidden group-hover:block bg-[#0D1117] text-slate-300 text-[10px] p-3 rounded-lg border border-slate-600 shadow-2xl min-w-[250px] max-w-[85vw] md:max-w-[600px] bottom-full left-0 sm:left-1/2 sm:-translate-x-1/2 mb-2 pointer-events-none whitespace-pre-wrap leading-relaxed max-h-[40vh] overflow-y-auto text-left">
              {formatted}
            </span>
          </span>
          {suffix}
        </span>
      );
    } catch {
      // not valid json
    }
  }

  return <span className="break-words">{text}</span>;
}

function ProcessLogsAccordion({
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

  return (
    <div
      className={
        hideHeader
          ? ""
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
              <div className="flex flex-col-reverse h-[400px] overflow-y-auto bg-[#0D1117] rounded-lg border border-slate-800 p-3 font-mono text-[11px] leading-relaxed relative">
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
                    {logs.map((log) => {
                      const dateStr = new Date(
                        log.createdAt || log.created_at || "",
                      ).toLocaleString();
                      const levelText = (
                        log.level ||
                        log.result ||
                        ""
                      ).toUpperCase();
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
                          <span className="text-slate-400 mt-1 sm:mt-0 leading-relaxed break-words">
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

function DraftsTab({
  channelIdFilter,
  accountIdFilter,
  refreshKey,
  actingDraft,
  onDraftAction,
  riskConfig,
  accountBalance,
}: {
  channelIdFilter: string;
  accountIdFilter: string;
  refreshKey: number;
  actingDraft: string | null;
  onDraftAction: (
    id: string,
    action: DraftAction,
    extraBody?: Record<string, unknown>,
  ) => void;
  riskConfig: RiskConfig | null;
  accountBalance: number;
}) {
  const [drafts, setDrafts] = useState<DraftTrade[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (channelIdFilter !== "all") params.set("channelId", channelIdFilter);
      if (accountIdFilter !== "all") params.set("accountId", accountIdFilter);
      const res = await fetch(`/api/drafts?${params}`);
      const json = await res.json();
      if (json.success) {
        setDrafts(json.data.drafts);
        setTotalCount(json.data.totalCount);
        setTotalPages(json.data.totalPages);
      }
    } catch {}
    setLoading(false);
  }, [page, pageSize, channelIdFilter, accountIdFilter]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  useEffect(() => {
    fetchDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, channelIdFilter, accountIdFilter]);

  if (loading && drafts.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="spinner mx-auto mb-3" />
        <p>Loading drafts...</p>
      </div>
    );
  }

  if (!loading && totalCount === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="text-4xl mb-2">📝</div>
        <p>No draft trades yet.</p>
        <p className="text-xs mt-1">
          Drafts appear here when a signal is detected in manual mode.
        </p>
      </div>
    );
  }

  const pendingCount = drafts.filter((d) => d.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {pendingCount > 0 ? (
          <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
            <span className="w-2 h-2 bg-amber-400 rounded-full pulse-dot" />
            Pending Review ({pendingCount})
          </h3>
        ) : (
          <span />
        )}
        <button
          onClick={() => fetchDrafts()}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 transition"
        >
          🔄 Refresh
        </button>
      </div>
      <div className="space-y-4">
        {drafts.map((draft) => (
          <DraftCard
            key={draft._id}
            draft={draft}
            acting={actingDraft === draft._id}
            onDraftAction={onDraftAction}
            riskConfig={riskConfig}
            accountBalance={accountBalance}
            refreshKey={refreshKey}
          />
        ))}
      </div>
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

function DraftCard({
  draft,
  acting,
  onDraftAction,
  riskConfig,
  accountBalance,
  refreshKey,
}: {
  draft: DraftTrade;
  acting: boolean;
  onDraftAction: (
    id: string,
    action: DraftAction,
    extraBody?: Record<string, unknown>,
  ) => void;
  riskConfig: RiskConfig | null;
  accountBalance: number;
  refreshKey: number;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const isPending = draft.status === "pending";
  const isResolved = !isPending;

  // For resolved drafts, default to collapsed
  const [isExpanded, setIsExpanded] = useState(isPending);

  // RR editor state — for signals without TP but with entry + SL
  const [customRR, setCustomRR] = useState<number>(3);
  const hasNoTP =
    !draft.takeProfitTargets || draft.takeProfitTargets.length === 0;
  const canCalcTPFromRR =
    hasNoTP && !!draft.entryPrice && draft.entryPrice > 0 && !!draft.stopLoss;

  // Compute auto-calculated TP preview from RR
  const autoTPs = canCalcTPFromRR
    ? (() => {
        return autoCalculateTPFromRR(
          draft.entryPrice!,
          draft.stopLoss!,
          customRR,
          draft.side,
        );
      })()
    : [];

  // Parse orderType from signalData
  let orderType: string | null = null;
  let parsedSignalData: unknown = null;
  try {
    const signal = JSON.parse(draft.signalData);
    parsedSignalData = signal;
    orderType = signal.orderType || null;
  } catch {}

  // Calculate risk preview — single source of truth (risk-calc.ts)
  const hasSL = !!draft.stopLoss && draft.stopLoss > 0;
  const canCalcRisk = hasSL && draft.entryPrice && draft.entryPrice > 0;
  const rpt = riskConfig?.riskPerTradePercent ?? 1;

  const riskResult =
    canCalcRisk && riskConfig
      ? calculateRisk({
          accountBalance,
          riskPerTradePercent: rpt,
          entryPrice: draft.entryPrice!,
          stopLossPrice: draft.stopLoss!,
          minLeverage: riskConfig.minLeverage,
          maxLeverage: riskConfig.maxLeverage,
        })
      : null;

  const maxLossUsdt = accountBalance * (rpt / 100);
  const slDistance = riskResult?.slDistancePercent ?? 0;
  const riskNotional = riskResult?.notionalSize ?? 0;
  const riskLeverage = riskResult?.leverage ?? draft.leverage;

  // Status config for resolved drafts
  const statusConfig: Record<
    string,
    { icon: string; borderColor: string; bgColor: string; headerBg: string }
  > = {
    accepted: {
      icon: "✅",
      borderColor: "border-green-700/40",
      bgColor: "bg-green-950/10",
      headerBg: "bg-green-900/20",
    },
    rejected: {
      icon: "❌",
      borderColor: "border-red-700/40",
      bgColor: "bg-red-950/10",
      headerBg: "bg-red-900/20",
    },
    expired: {
      icon: "⏰",
      borderColor: "border-slate-600/40",
      bgColor: "bg-slate-800/20",
      headerBg: "bg-slate-800/30",
    },
  };
  const resolvedStyle = statusConfig[draft.status] || statusConfig.expired;

  // For resolved drafts: collapsed accordion header
  if (isResolved && !isExpanded) {
    return (
      <div
        className={`border rounded-lg overflow-hidden ${resolvedStyle.borderColor} ${resolvedStyle.bgColor}`}
      >
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full px-3 sm:px-4 py-3 flex items-center justify-between text-left hover:brightness-110 transition gap-2"
        >
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="shrink-0">{resolvedStyle.icon}</span>
            <span
              className={`badge shrink-0 ${draft.side === "LONG" ? "badge-success" : "badge-danger"}`}
            >
              {draft.action}
            </span>
            <span className="font-medium text-white">{draft.symbol}</span>
            <span className="badge badge-warning shrink-0">
              {draft.leverage}x
            </span>
            {draft.entryPrice && (
              <span className="text-xs text-slate-400 hidden sm:inline">
                Entry:{" "}
                <span className="font-mono text-slate-300">
                  {draft.entryPrice}
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="text-xs text-slate-500 hidden sm:inline">
              by @{draft.author}
            </span>
            {draft.resolvedAt && (
              <span className="text-xs text-slate-500 hidden sm:inline">
                {new Date(draft.resolvedAt).toLocaleString()}
              </span>
            )}
            <span className="text-slate-500 text-xs">▼</span>
          </div>
        </button>
      </div>
    );
  }

  // Expanded view (for both pending and resolved)
  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        isPending
          ? "border-amber-700/50 bg-amber-950/20"
          : `${resolvedStyle.borderColor} ${resolvedStyle.bgColor}`
      }`}
    >
      {/* Header */}
      <div className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-2">
              {!isPending && <span>{resolvedStyle.icon}</span>}
              <span
                className={`badge ${draft.side === "LONG" ? "badge-success" : "badge-danger"}`}
              >
                {draft.action}
              </span>
              <span className="text-base sm:text-lg font-bold text-white">
                {draft.symbol}
              </span>
              <span className="badge badge-warning">{draft.leverage}x</span>
              {orderType && (
                <span
                  className={`badge ${orderType === "limit" ? "bg-purple-700/50 text-purple-300" : "bg-blue-700/50 text-blue-300"}`}
                >
                  {orderType === "limit" ? "📌 Limit" : "⚡ Market"}
                </span>
              )}
              {draft.confidence > 0 && (
                <span className="badge badge-info">
                  {draft.confidence}% conf.
                </span>
              )}
              {!isPending && <StatusBadge status={draft.status} />}

              {isResolved && (
                <button
                  onClick={() => setIsExpanded(false)}
                  className="ml-auto bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-md text-xs transition flex items-center gap-1 border border-slate-700"
                  title="Collapse"
                >
                  <span className="hidden sm:inline">Collapse</span>
                  <span>▲</span>
                </button>
              )}
            </div>

            {/* Key info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-3">
              {draft.entryPrice && (
                <div>
                  <span className="text-slate-500">Entry:</span>{" "}
                  <span className="text-white font-mono">
                    {draft.entryPrice}
                  </span>
                </div>
              )}
              <div>
                <span className="text-slate-500">Qty:</span>{" "}
                <span className="text-white font-mono">{draft.quantity}</span>
              </div>
              {draft.stopLoss && (
                <div>
                  <span className="text-slate-500">SL:</span>{" "}
                  <span className="text-danger font-mono">
                    {draft.stopLoss}
                  </span>
                </div>
              )}
            </div>
            {/* Multi-TP targets with percentage allocation */}
            {draft.takeProfitTargets && draft.takeProfitTargets.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {draft.takeProfitTargets.map((tp, idx) => {
                  const total = draft.takeProfitTargets.length;
                  const pct =
                    total === 1
                      ? 100
                      : idx < total - 1
                        ? Math.floor((100 / total) * 100) / 100
                        : Math.round(
                            (100 -
                              (total - 1) *
                                (Math.floor((100 / total) * 100) / 100)) *
                              100,
                          ) / 100;
                  return (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono bg-green-900/30 border border-green-700/40 text-success"
                    >
                      TP{idx + 1}: {tp}
                      <span className="text-green-400/70">
                        ({pct.toFixed(pct % 1 === 0 ? 0 : 2)}%)
                      </span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* RR Editor — shown when no TP but has entry + SL */}
            {canCalcTPFromRR && isPending && (
              <div className="rounded-lg p-3 mb-3 text-xs bg-blue-900/20 border border-blue-700/30">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                  <span className="font-semibold text-blue-300">
                    📐 No TP — Set RR (Risk-Reward)
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rr) => (
                      <button
                        key={rr}
                        onClick={() => setCustomRR(rr)}
                        className={`w-7 h-7 rounded text-xs font-bold transition ${
                          customRR === rr
                            ? "bg-blue-600 text-white ring-2 ring-blue-400"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        }`}
                      >
                        {rr}
                      </button>
                    ))}
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={customRR}
                      onChange={(e) =>
                        setCustomRR(
                          Math.max(0.5, parseFloat(e.target.value) || 0.5),
                        )
                      }
                      className="h-7 w-20 rounded border border-slate-600 bg-slate-800 px-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                {/* Preview auto-calculated TPs */}
                {autoTPs.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    <span className="text-slate-400">Preview:</span>
                    {autoTPs.map((tp, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-green-900/20 border border-green-700/30 text-success"
                      >
                        TP{idx + 1}: {tp.toFixed(2)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Risk Preview */}
            {accountBalance > 0 && riskConfig && (
              <div
                className={`rounded-lg p-3 mb-3 text-xs ${
                  !hasSL
                    ? "bg-red-900/20 border border-red-700/50"
                    : "bg-amber-900/20 border border-amber-700/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-semibold text-slate-300">
                    🛡️ Risk Preview
                  </span>
                  <span className="badge badge-warning">
                    RPT: {rpt}% = ${maxLossUsdt.toFixed(2)}
                  </span>
                  {!hasSL && riskConfig.skipNoSL && (
                    <span className="badge badge-danger">
                      🚫 No SL — will be skipped
                    </span>
                  )}
                  {!hasSL && !riskConfig.skipNoSL && (
                    <span className="badge badge-warning">
                      ⚠️ No SL — original qty used
                    </span>
                  )}
                </div>
                {hasSL && draft.entryPrice ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-slate-400">
                    <div>
                      SL Distance:{" "}
                      <span className="text-white font-mono">
                        {(slDistance * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      Margin:{" "}
                      <span className="text-amber-400 font-mono">
                        ${maxLossUsdt.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      Notional:{" "}
                      <span className="text-emerald-400 font-mono">
                        ${riskNotional.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      Leverage:{" "}
                      <span className="text-emerald-400 font-mono">
                        {riskLeverage}x
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500">
                    Cannot calculate — no stop loss provided.
                  </p>
                )}
              </div>
            )}

            {/* Reasoning */}
            {draft.reasoning && (
              <p className="text-slate-300 text-sm bg-slate-800/50 rounded p-2 mb-3">
                💡 {draft.reasoning}
              </p>
            )}
          </div>

          {/* Action Buttons — only for pending */}
          {isPending && (
            <div className="flex sm:flex-col gap-2 sm:min-w-[120px]">
              <button
                onClick={() =>
                  onDraftAction(
                    draft._id,
                    "accept",
                    canCalcTPFromRR ? { rr: customRR } : undefined,
                  )
                }
                disabled={acting}
                className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                {acting ? <div className="spinner w-4 h-4 border-2" /> : "✅"}
                Accept{canCalcTPFromRR ? ` (${customRR}RR)` : ""}
              </button>
              <button
                onClick={() => onDraftAction(draft._id, "reject")}
                disabled={acting}
                className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                ❌ Reject
              </button>
              <button
                onClick={() => onDraftAction(draft._id, "reanalyze")}
                disabled={acting}
                className="flex-1 sm:flex-none bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                🔄 Re-analyze
              </button>
            </div>
          )}

          {/* Collapse button for resolved */}
          {isResolved && (
            <div className="flex flex-col gap-2 sm:min-w-[120px]">
              <button
                onClick={() => onDraftAction(draft._id, "redraft")}
                disabled={acting}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                {acting ? <div className="spinner w-4 h-4 border-2" /> : "📝"}
                Draft Again
              </button>
              <button
                onClick={() => onDraftAction(draft._id, "reanalyze")}
                disabled={acting}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                🔄 Re-analyze
              </button>
            </div>
          )}
        </div>

        {/* Discord Context & Process Logs */}
        <div className="mt-4 pt-3 border-t border-slate-700/50">
          {/* Author & Time */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500 mb-2">
            <span>👤 @{draft.author}</span>
            {draft.sourceTimestamp ? (
              <span className="text-blue-400">
                💬 {new Date(draft.sourceTimestamp).toLocaleString()}
              </span>
            ) : null}
            <span>🕐 {new Date(draft.createdAt).toLocaleString()}</span>
            {draft.resolvedAt && !isPending && (
              <span>✅ {new Date(draft.resolvedAt).toLocaleString()}</span>
            )}
            {draft.messageUrl && (
              <a
                href={draft.messageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-400 hover:text-primary-300 underline"
              >
                🔗 Discord
              </a>
            )}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-slate-400 hover:text-white transition"
            >
              {showDetails ? "▼ Hide" : "▶ Show"} original
            </button>
          </div>

          <ProcessLogsAccordion
            processId={draft.processId}
            refreshKey={refreshKey}
          />
        </div>
      </div>

      {/* Expandable Details */}
      {showDetails && (
        <div className="border-t border-slate-700 p-4 bg-slate-800/30">
          {/* Discord Images */}
          {draft.imageUrls && draft.imageUrls.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-slate-400 mb-2">📎 Attachments:</p>
              <div className="flex flex-wrap gap-2">
                {draft.imageUrls.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => setModalIndex(i)}
                    className="group relative"
                  >
                    <img
                      src={url}
                      alt={`Attachment ${i + 1}`}
                      className="h-24 w-auto rounded-lg border border-slate-600 group-hover:border-primary-500 transition object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-lg transition flex items-center justify-center">
                      <span className="text-white text-lg opacity-0 group-hover:opacity-100 transition">
                        🔍
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Original Message */}
          <div>
            <p className="text-xs text-slate-400 mb-1">💬 Original Message:</p>
            <p className="text-slate-300 text-sm whitespace-pre-wrap bg-slate-900/50 rounded p-3">
              {draft.originalContent}
            </p>
          </div>

          {/* Raw Signal JSON */}
          <details className="mt-3">
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">
              📋 Raw AI Signal Data
            </summary>
            <pre className="text-xs text-slate-400 mt-2 bg-slate-900/50 rounded p-3 overflow-x-auto">
              {JSON.stringify(parsedSignalData || draft.signalData, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Image/Video Modal */}
      {modalIndex !== null && draft.imageUrls && draft.imageUrls.length > 0 && (
        <ImageModal
          urls={draft.imageUrls}
          initialIndex={modalIndex}
          onClose={() => setModalIndex(null)}
        />
      )}
    </div>
  );
}

function ImageModal({
  urls,
  initialIndex,
  onClose,
}: {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  const currentUrl = urls[index];
  const isVideo = /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(currentUrl);

  const goNext = () => {
    setIndex((i) => (i + 1) % urls.length);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const goPrev = () => {
    setIndex((i) => (i - 1 + urls.length) % urls.length);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setZoom((z) => Math.min(Math.max(z + delta, 0.5), 5));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({
      x: panStart.current.x + dx,
      y: panStart.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.25, 5));
      if (e.key === "-" || e.key === "_")
        setZoom((z) => Math.max(z - 0.25, 0.5));
      if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === modalRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-white text-sm font-medium">
            {index + 1} / {urls.length}
          </span>
          {isVideo && (
            <span className="text-xs bg-purple-700/60 text-purple-200 px-2 py-0.5 rounded">
              🎬 Video
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => Math.min(z + 0.25, 5));
            }}
            className="bg-white/10 hover:bg-white/20 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm transition"
            title="Zoom in (+)"
          >
            +
          </button>
          <span className="text-white/70 text-xs font-mono min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => Math.max(z - 0.25, 0.5));
            }}
            className="bg-white/10 hover:bg-white/20 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm transition"
            title="Zoom out (-)"
          >
            −
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
            className="bg-white/10 hover:bg-white/20 text-white w-8 h-8 rounded-lg flex items-center justify-center text-xs transition"
            title="Reset zoom (0)"
          >
            1:1
          </button>
          <div className="w-px h-5 bg-white/20 mx-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="bg-white/10 hover:bg-red-600/60 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm transition"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Prev button */}
      {urls.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center text-xl transition"
          title="Previous (←)"
        >
          ‹
        </button>
      )}

      {/* Next button */}
      {urls.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center text-xl transition"
          title="Next (→)"
        >
          ›
        </button>
      )}

      {/* Media content */}
      <div
        className="relative z-[5] flex items-center justify-center w-full h-full p-12 pt-16 pb-4"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default",
        }}
      >
        <div
          className="transition-transform duration-150 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
          {isVideo ? (
            <video
              src={currentUrl}
              controls
              autoPlay
              className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={currentUrl}
              alt={`Attachment ${index + 1}`}
              className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-3 left-0 right-0 z-10 text-center">
        <p className="text-white/30 text-xs">
          Scroll to zoom • Drag to pan • Arrow keys to navigate • Esc to close
        </p>
      </div>
    </div>
  );
}

function PositionsTab({
  channelIdFilter,
  accountIdFilter,
  refreshKey,
  livePositions = [],
}: {
  channelIdFilter: string;
  accountIdFilter: string;
  refreshKey: number;
  livePositions?: Position[];
}) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [positionFilter, setPositionFilter] = useState<
    "open" | "closed" | "pending"
  >("open");
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

  const fetchStatusCounts = useCallback(async () => {
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
        const res = await fetch(`/api/positions?${params}`);
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
    } catch {
      // Keep previous counts if count fetch fails.
    }
  }, [channelIdFilter, accountIdFilter]);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        status: positionFilter,
      });
      if (channelIdFilter !== "all") params.set("channelId", channelIdFilter);
      if (accountIdFilter !== "all") params.set("accountId", accountIdFilter);
      const res = await fetch(`/api/positions?${params}`);
      const json = await res.json();
      if (json.success) {
        setPositions(json.data.positions);
        setTotalCount(json.data.totalCount);
        setTotalPages(json.data.totalPages);
      }
    } catch {}
    setLoading(false);
  }, [page, pageSize, positionFilter, channelIdFilter, accountIdFilter]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  useEffect(() => {
    fetchStatusCounts();
  }, [fetchStatusCounts]);

  useEffect(() => {
    fetchPositions();
    fetchStatusCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

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
              let displayPnl = pos.pnl || 0;
              let displayCurrentPrice = pos.currentPrice || pos.entryPrice;

              if (pos.status === "open" && livePositions.length > 0) {
                const livePos = livePositions.find(
                  (lp) => (lp._id || lp.id) === (pos._id || pos.id),
                );
                if (livePos) {
                  displayPnl = livePos.pnl || 0;
                  displayCurrentPrice =
                    livePos.currentPrice || livePos.entryPrice;
                }
              }

              const pnlPercent =
                displayCurrentPrice && pos.entryPrice && pos.entryPrice > 0
                  ? ((displayCurrentPrice - pos.entryPrice) / pos.entryPrice) *
                    100 *
                    pos.leverage *
                    (pos.side === "LONG" ? 1 : -1)
                  : 0;

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
                        Qty
                      </span>
                      <span className="text-xs font-mono text-slate-300">
                        {pos.quantity}
                      </span>
                    </div>
                    <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                      <span className="text-[9px] text-slate-500 uppercase">
                        PNL
                      </span>
                      <div
                        className={`text-xs font-mono font-bold ${
                          displayPnl > 0
                            ? "text-emerald-400"
                            : displayPnl < 0
                              ? "text-red-400"
                              : "text-slate-400"
                        }`}
                      >
                        {displayPnl > 0 ? "+" : ""}
                        {displayPnl.toFixed(2)}
                        <span className="text-[9px] ml-1 opacity-80 font-normal">
                          ({displayPnl > 0 ? "+" : ""}
                          {pnlPercent.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 mb-3 text-[10px] text-slate-500">
                    <div className="flex justify-between">
                      <span>Opened</span>
                      <span>{new Date(pos.openedAt).toLocaleString()}</span>
                    </div>
                    {pos.closedAt && (
                      <div className="flex justify-between">
                        <span>Closed</span>
                        <span>{new Date(pos.closedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {pos.closeReason && (
                      <div className="bg-slate-900/50 p-1.5 rounded mt-1 border border-slate-700/50 relative group">
                        <span className="text-[9px] text-slate-500 uppercase block mb-0.5">
                          Close Reason
                        </span>
                        <span className="text-slate-400 block truncate">
                          {pos.closeReason}
                        </span>
                        <div className="absolute z-[100] hidden active:block sm:group-hover:block bg-slate-800 text-slate-200 text-[10px] p-2 rounded-lg border border-slate-600 shadow-2xl min-w-[200px] bottom-full left-0 mb-1 whitespace-normal leading-relaxed">
                          {pos.closeReason}
                        </div>
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
                    <div className="mt-3 bg-slate-900/80 rounded-lg p-2 border border-slate-700/50 w-full overflow-hidden">
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
          <div className="hidden sm:block overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Entry</th>
                  {positionFilter === "open" && <th>Current</th>}
                  <th>Qty</th>
                  <th>Leverage</th>
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
                  let displayPnl = pos.pnl || 0;
                  let displayCurrentPrice = pos.currentPrice || pos.entryPrice;

                  if (pos.status === "open" && livePositions.length > 0) {
                    const livePos = livePositions.find(
                      (lp) => (lp._id || lp.id) === (pos._id || pos.id),
                    );
                    if (livePos) {
                      displayPnl = livePos.pnl || 0;
                      displayCurrentPrice =
                        livePos.currentPrice || livePos.entryPrice;
                    }
                  }

                  const pnlPercent =
                    displayCurrentPrice && pos.entryPrice && pos.entryPrice > 0
                      ? ((displayCurrentPrice - pos.entryPrice) /
                          pos.entryPrice) *
                        100 *
                        pos.leverage *
                        (pos.side === "LONG" ? 1 : -1)
                      : 0;

                  return (
                    <Fragment key={`desktop-${pos._id || pos.id}`}>
                      <tr
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
                        <td>{pos.entryPrice?.toFixed(4)}</td>
                        {positionFilter === "open" && (
                          <td>{displayCurrentPrice?.toFixed(4) || "-"}</td>
                        )}
                        <td>{pos.quantity}</td>
                        <td>{pos.leverage}x</td>
                        <td
                          className={`font-mono flex items-center gap-1.5 ${displayPnl >= 0 ? "text-success" : "text-danger"}`}
                        >
                          <span>
                            {displayPnl >= 0 ? "+" : ""}
                            {displayPnl.toFixed(2)}
                          </span>
                          {positionFilter === "open" && (
                            <span className="text-[10px] opacity-80">
                              ({displayPnl >= 0 ? "+" : ""}
                              {pnlPercent.toFixed(2)}%)
                            </span>
                          )}
                        </td>
                        {positionFilter === "closed" && (
                          <td className="text-xs text-slate-400 relative group cursor-help">
                            <span className="max-w-[120px] truncate block">
                              {pos.closeReason || "-"}
                            </span>
                            {pos.closeReason && (
                              <div className="absolute z-[100] hidden group-hover:block bg-slate-800 text-slate-200 text-[10px] p-2 rounded-lg border border-slate-600 shadow-2xl min-w-[200px] bottom-full left-0 mb-1 pointer-events-none whitespace-normal leading-relaxed">
                                {pos.closeReason}
                              </div>
                            )}
                          </td>
                        )}
                        {positionFilter === "pending" && (
                          <td>
                            <span className="inline-flex items-center gap-1.5 badge badge-warning">
                              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                              Pending
                            </span>
                          </td>
                        )}
                        <td className="text-xs text-slate-400">
                          {new Date(pos.openedAt).toLocaleString()}
                        </td>
                        {positionFilter === "closed" && (
                          <td className="text-xs text-slate-400">
                            {pos.closedAt
                              ? new Date(pos.closedAt).toLocaleString()
                              : "-"}
                          </td>
                        )}
                        <td className="text-right">
                          <button
                            onClick={() =>
                              setExpandedPosId(
                                expandedPosId === (pos._id || String(pos.id))
                                  ? null
                                  : pos._id || String(pos.id),
                              )
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
                      {expandedPosId === (pos._id || String(pos.id)) && (
                        <tr>
                          <td
                            colSpan={100}
                            className="p-0 border-none bg-slate-900/10"
                          >
                            <div className="px-4 py-2">
                              <ProcessLogsAccordion
                                processId={pos.processId}
                                refreshKey={refreshKey}
                                hideHeader={true}
                                defaultOpen={true}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
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

function SignalsTab({
  channelIdFilter,
  accountIdFilter,
  refreshKey,
}: {
  channelIdFilter: string;
  accountIdFilter: string;
  refreshKey: number;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (channelIdFilter !== "all") params.set("channelId", channelIdFilter);
      if (accountIdFilter !== "all") params.set("accountId", accountIdFilter);
      const res = await fetch(`/api/signals?${params}`);
      const json = await res.json();
      if (json.success) {
        setMessages(json.data.messages);
        setTotalCount(json.data.totalCount);
        setTotalPages(json.data.totalPages);
      }
    } catch {}
    setLoading(false);
  }, [page, pageSize, channelIdFilter, accountIdFilter]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, channelIdFilter, accountIdFilter]);

  if (loading && messages.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="spinner mx-auto mb-3" />
        <p>Loading signals...</p>
      </div>
    );
  }

  if (!loading && totalCount === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="text-4xl mb-2">📨</div>
        <p>No messages processed yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-2">
        <button
          onClick={() => fetchMessages()}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 transition"
        >
          🔄 Refresh
        </button>
      </div>
      <div className="space-y-3">
        {messages.map((msg) => (
          <div
            key={msg._id || msg.id}
            className="border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">@{msg.author}</span>
                {(msg.signalType || msg.signal_type) &&
                  (msg.signalType || msg.signal_type) !== "none" && (
                    <span
                      className={`badge ${(msg.signalType || msg.signal_type) === "LONG" || (msg.signalType || msg.signal_type) === "BUY" ? "badge-success" : "badge-danger"}`}
                    >
                      {msg.signalType || msg.signal_type}
                    </span>
                  )}
                <StatusBadge status={msg.status} />
              </div>
              <div className="flex flex-col items-end">
                {msg.sourceTimestamp ? (
                  <span className="text-xs text-blue-400">
                    💬 {new Date(msg.sourceTimestamp).toLocaleString()}
                  </span>
                ) : null}
                <span className="text-[10px] text-slate-600">
                  Processed:{" "}
                  {new Date(
                    msg.createdAt || msg.created_at || "",
                  ).toLocaleString()}
                </span>
              </div>
            </div>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">
              {msg.content}
            </p>
          </div>
        ))}
      </div>
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

function LogsTab({
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
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-8">
            <div className="spinner mx-auto mb-3" />
            <p>Loading terminal...</p>
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

function CronStatusPanel({
  cronStatus,
  expandedCron,
  onToggle,
}: {
  cronStatus: Record<string, CronRunStatus>;
  expandedCron: string | null;
  onToggle: (name: string | null) => void;
}) {
  const anyRunning = Object.values(cronStatus).some((s) => s.running);
  if (!anyRunning && Object.values(cronStatus).every((s) => !s.result)) {
    return null; // Nothing to show yet
  }

  const labels: Record<string, string> = {
    "signal-check": "🔍 Signal Check",
    "position-monitor": "📊 Position Monitor",
    "tp-sl-monitor": "🎯 TP/SL Monitor",
  };

  return (
    <div className="space-y-2">
      {Object.entries(cronStatus).map(([name, status]) => {
        if (!status.running && !status.result) return null;
        const isExpanded = expandedCron === name;
        return (
          <div
            key={name}
            className={`rounded-lg border overflow-hidden ${
              status.running
                ? "border-blue-700/50 bg-blue-950/20"
                : status.result === "success"
                  ? "border-green-700/50 bg-green-950/20"
                  : "border-red-700/50 bg-red-950/20"
            }`}
          >
            <button
              onClick={() => onToggle(isExpanded ? null : name)}
              className="w-full px-4 py-2 flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                {status.running ? (
                  <div className="spinner w-3 h-3 border-2 border-blue-400" />
                ) : status.result === "success" ? (
                  <span className="text-green-400">✅</span>
                ) : (
                  <span className="text-red-400">❌</span>
                )}
                <span className="font-medium text-white">
                  {labels[name] || name}
                </span>
                <span className="text-slate-400 text-xs">
                  {status.progress}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {status.running && (
                  <span className="text-xs text-blue-400 animate-pulse">
                    Running...
                  </span>
                )}
                {status.startedAt && (
                  <span className="text-xs text-slate-500">
                    {new Date(status.startedAt).toLocaleTimeString()}
                  </span>
                )}
                <span className="text-slate-500 text-xs">
                  {isExpanded ? "▲" : "▼"}
                </span>
              </div>
            </button>
            {isExpanded && status.steps.length > 0 && (
              <div className="border-t border-slate-700/50 px-4 py-2 bg-slate-900/30 max-h-48 overflow-y-auto">
                {status.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs py-1">
                    <span className="text-slate-500 shrink-0">
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        step.type === "error"
                          ? "text-red-400"
                          : step.type === "success"
                            ? "text-green-400"
                            : step.type === "warning"
                              ? "text-amber-400"
                              : "text-slate-300"
                      }
                    >
                      {step.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PaginationBar({
  page,
  pageSize,
  totalCount,
  totalPages,
  loading,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  if (totalPages <= 1 && totalCount <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between mt-3 pt-3 border-t border-slate-700/50 gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          ← Prev
        </button>
        <span className="text-xs text-slate-400">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          Next →
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">
          {from}–{to} of {totalCount}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          disabled={loading}
          className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-primary-500 disabled:opacity-50"
        >
          {[10, 25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { class: string; label: string }> = {
    open: { class: "badge-success", label: "Open" },
    closed: { class: "badge-neutral", label: "Closed" },
    executed: { class: "badge-success", label: "Executed" },
    processing: { class: "badge-warning", label: "Processing" },
    pending: { class: "badge-info", label: "Pending" },
    drafted: { class: "badge-warning", label: "Drafted" },
    skipped: { class: "badge-neutral", label: "Skipped" },
    error: { class: "badge-danger", label: "Error" },
    ignored: { class: "badge-neutral", label: "Ignored" },
    failed: { class: "badge-danger", label: "Failed" },
    accepted: { class: "badge-success", label: "Accepted" },
    rejected: { class: "badge-danger", label: "Rejected" },
    expired: { class: "badge-neutral", label: "Expired" },
  };

  const c = config[status] || { class: "badge-neutral", label: status };

  return <span className={`badge ${c.class}`}>{c.label}</span>;
}
