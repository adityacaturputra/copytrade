"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { calculateRisk } from "@/lib/risk-calc";

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
  createdAt?: string;
  created_at?: string;
}

interface Log {
  _id?: string;
  id?: number;
  type: string;
  action: string;
  symbol?: string;
  details?: string;
  result?: string;
  error?: string;
  createdAt?: string;
  created_at?: string;
}

interface DraftTrade {
  _id: string;
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
  discordTimestamp?: string;
  createdAt: string;
  resolvedAt?: string;
}

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

interface DiscordSourceInfo {
  _id: string;
  name: string;
  channelIds: string[];
  isActive: boolean;
}

interface DashboardData {
  stats: Stats;
  account: AccountInfo | null;
  exchangeProvider: string | null;
  exchangeError: string | null;
  openPositions: Position[];
  pendingPositions: Position[];
  recentMessages: Message[];
  recentLogs: Log[];
  allPositions: Position[];
  pendingDrafts: DraftTrade[];
  recentDrafts: DraftTrade[];
  tradingMode: "auto" | "manual";
  riskConfig: RiskConfig | null;
  signalConfig: SignalConfig | null;
  discordSources: DiscordSourceInfo[];
  channelNames: Record<string, string>;
}

// ==================== Component ====================

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
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

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error || "Failed to load data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

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

  // Check cron setup on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/cron-settings");
        const json = await res.json();
        if (json.success && json.setupCheck && !json.setupCheck.allConfigured) {
          setCronWarning({
            allConfigured: false,
            missing: json.setupCheck.missing,
          });
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    fetchData();
    fetchCronStatus();
    const interval = setInterval(fetchData, 30000);
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
      const res = await fetch(`/api/cron/${type}`, { method: "POST" });
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
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
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
    action: "accept" | "reject",
    extraBody?: Record<string, any>,
  ) => {
    setActingDraft(draftId);
    try {
      const res = await fetch(`/api/drafts/${draftId}/${action}`, {
        method: "POST",
        headers: extraBody ? { "Content-Type": "application/json" } : undefined,
        body: extraBody ? JSON.stringify(extraBody) : undefined,
      });
      const json = await res.json();
      if (json.success) {
        alert(`Draft ${action}ed successfully!`);
        await fetchData();
      } else {
        alert(`Failed: ${json.error}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setActingDraft(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-slate-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

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

  // ─── Collect unique channel IDs for filter ──────────────────────────
  const allChannelIds = new Set<string>();
  for (const d of data?.recentDrafts || []) {
    if (d.channelId) allChannelIds.add(d.channelId);
  }
  for (const p of data?.allPositions || []) {
    if ((p as any).channelId) allChannelIds.add((p as any).channelId);
  }
  for (const m of data?.recentMessages || []) {
    if ((m as any).channelId) allChannelIds.add((m as any).channelId);
  }
  const channelIdArray = Array.from(allChannelIds).sort();

  // ─── Channel name map from Discord API (resolved server-side) ──────
  const channelNameMap = new Map<string, string>(
    Object.entries(data?.channelNames || {}),
  );

  // Filter helper
  const filterByChannel = <T extends Record<string, any>>(
    items: T[],
    channelField: string = "channelId",
  ): T[] => {
    if (selectedChannelId === "all") return items;
    return items.filter((item) => item[channelField] === selectedChannelId);
  };

  // Filtered data for tabs
  const filteredDrafts = filterByChannel(data?.recentDrafts || []);
  const filteredPositions = filterByChannel(data?.allPositions || []);
  const filteredMessages = filterByChannel(
    data?.recentMessages || [],
    "channelId",
  );
  const filteredOpenPositions = filterByChannel(data?.openPositions || []);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-700 bg-dark-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="text-xl sm:text-2xl">📈</div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-white">
                  CopyTrade
                </h1>
                <p className="text-[10px] sm:text-xs text-slate-400 hidden sm:block">
                  AI-Powered Discord Signal Copier
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3">
              {/* Trading Mode Toggle */}
              <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-800 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2">
                <span className="text-[10px] sm:text-xs text-slate-400 hidden sm:inline">
                  Mode:
                </span>
                <button
                  onClick={toggleMode}
                  disabled={switchingMode}
                  className={`relative inline-flex h-5 w-9 sm:h-6 sm:w-11 items-center rounded-full transition-colors ${
                    tradingMode === "auto" ? "bg-green-600" : "bg-slate-600"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 sm:h-4 sm:w-4 transform rounded-full bg-white transition-transform ${
                      tradingMode === "auto"
                        ? "translate-x-4 sm:translate-x-6"
                        : "translate-x-1"
                    }`}
                  />
                </button>
                <span
                  className={`text-[10px] sm:text-xs font-semibold ${tradingMode === "auto" ? "text-green-400" : "text-amber-400"}`}
                >
                  {tradingMode === "auto" ? "🤖" : "👆"}
                </span>
              </div>

              {/* Cron Status Warning */}
              {cronWarning && (
                <a
                  href="/settings"
                  className="bg-amber-600/20 border border-amber-600/40 hover:bg-amber-600/30 px-2 py-1.5 rounded-lg text-xs transition flex items-center gap-1 text-amber-300"
                  title={`${cronWarning.missing.length} cron job(s) not configured. Click to set up.`}
                >
                  ⏰ <span className="hidden sm:inline">Setup Cron</span>
                </a>
              )}

              {/* Cron Actions Dropdown */}
              <div className="relative" ref={cronMenuRef}>
                <button
                  onClick={() => setShowCronMenu(!showCronMenu)}
                  className="bg-primary-600 hover:bg-primary-700 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1 sm:gap-2"
                >
                  ⚡ <span className="hidden sm:inline">Actions</span>
                  <svg
                    className="w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                  </svg>
                </button>
                {showCronMenu && (
                  <div className="absolute right-0 mt-2 w-52 sm:w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 overflow-hidden">
                    <button
                      onClick={() => {
                        triggerCron("signal-check");
                        setShowCronMenu(false);
                      }}
                      disabled={triggeringCron === "signal-check"}
                      className="w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 sm:gap-3 text-sm"
                    >
                      {triggeringCron === "signal-check" ? (
                        <div className="spinner w-4 h-4 border-2" />
                      ) : (
                        <span>🔍</span>
                      )}
                      <div>
                        <div className="text-white font-medium">
                          Check Signals
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Fetch & parse Discord signals
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        triggerCron("position-monitor");
                        setShowCronMenu(false);
                      }}
                      disabled={triggeringCron === "position-monitor"}
                      className="w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 sm:gap-3 text-sm border-t border-slate-700/50"
                    >
                      {triggeringCron === "position-monitor" ? (
                        <div className="spinner w-4 h-4 border-2" />
                      ) : (
                        <span>📊</span>
                      )}
                      <div>
                        <div className="text-white font-medium">
                          Position Monitor
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Sync PnL & detect hits
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        triggerCron("tp-sl-monitor");
                        setShowCronMenu(false);
                      }}
                      disabled={triggeringCron === "tp-sl-monitor"}
                      className="w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 sm:gap-3 text-sm border-t border-slate-700/50"
                    >
                      {triggeringCron === "tp-sl-monitor" ? (
                        <div className="spinner w-4 h-4 border-2" />
                      ) : (
                        <span>🎯</span>
                      )}
                      <div>
                        <div className="text-white font-medium">
                          TP/SL Monitor
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Place TP/SL for filled limits
                        </div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
              <a
                href="/agent"
                className="bg-purple-700 hover:bg-purple-600 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition flex items-center gap-1"
              >
                🤖 <span className="hidden sm:inline">Agent</span>
              </a>
              <a
                href="/settings"
                className="bg-slate-700 hover:bg-slate-600 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition"
              >
                ⚙️
              </a>
              <button
                onClick={fetchData}
                className="bg-slate-700 hover:bg-slate-600 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition"
              >
                🔄
              </button>
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
          className={`rounded-lg px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 ${
            data?.account
              ? "bg-slate-800/50 border border-slate-700"
              : "bg-red-900/30 border border-red-700/50"
          }`}
        >
          <div className="flex items-center justify-between sm:justify-start gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full shrink-0 ${data?.account ? "bg-green-500 pulse-dot" : "bg-red-500 animate-pulse"}`}
              />
              <span className="text-sm font-medium">
                Exchange:{" "}
                <span className="text-white uppercase">
                  {data?.exchangeProvider || "unknown"}
                </span>
              </span>
            </div>
            {data?.exchangeProvider === "okx" && (
              <span className="badge badge-warning sm:ml-0">DEMO MODE</span>
            )}
          </div>
          {data?.account ? (
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 sm:ml-4 text-xs sm:text-sm">
              <span>
                Balance:{" "}
                <span className="text-white font-mono font-bold">
                  {data.account.totalBalance?.toFixed(2)}{" "}
                  {data.account.currency}
                </span>
              </span>
              <span>
                Available:{" "}
                <span className="text-white font-mono">
                  {data.account.availableBalance?.toFixed(2)}
                </span>
              </span>
              {data.account.unrealizedPnl !== 0 && (
                <span
                  className={
                    data.account.unrealizedPnl >= 0
                      ? "text-success"
                      : "text-danger"
                  }
                >
                  PnL: {data.account.unrealizedPnl >= 0 ? "+" : ""}
                  {data.account.unrealizedPnl?.toFixed(2)}
                </span>
              )}
            </div>
          ) : (
            <div className="sm:ml-4 text-xs sm:text-sm">
              <span className="text-red-300">
                ⚠️{" "}
                {data?.exchangeError?.toLowerCase().includes("ip whitelist")
                  ? `Your IP is not in the OKX API key whitelist. Go to OKX → Profile → API Management → Edit your key → Add your current IP or disable IP restriction.`
                  : data?.exchangeError?.toLowerCase().includes("enotfound") ||
                      data?.exchangeError
                        ?.toLowerCase()
                        .includes("econnrefused")
                    ? `OKX servers are unreachable from your network (ISP blocking). Enable VPN to connect.`
                    : data?.exchangeError ||
                      "Check your API keys and network connection."}
              </span>
            </div>
          )}
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
        {data?.openPositions && data.openPositions.length > 0 && (
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-success rounded-full pulse-dot" />
              Active Positions ({data.openPositions.length})
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
                  {data.openPositions.map((pos) => (
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
        {data?.pendingPositions && data.pendingPositions.length > 0 && (
          <div className="card border-amber-700/30">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              <span className="text-amber-400">Pending Limit Orders</span>
              <span className="text-sm font-normal text-slate-400">
                ({data.pendingPositions.length} waiting to fill)
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
                  {data.pendingPositions.map((pos) => (
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

        {/* Channel Filter + Tabs */}
        <div className="card">
          {/* Channel Filter */}
          {channelIdArray.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4 pb-3 border-b border-slate-700/50">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                📺 Channel Filter:
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
                {channelIdArray.map((chId) => {
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
              drafts={filteredDrafts}
              actingDraft={actingDraft}
              onAccept={handleDraftAction}
              onReject={handleDraftAction}
              riskConfig={data?.riskConfig || null}
              accountBalance={
                data?.account?.availableBalance ||
                data?.account?.totalBalance ||
                0
              }
            />
          )}
          {activeTab === "positions" && (
            <PositionsTab positions={filteredPositions} />
          )}
          {activeTab === "signals" && (
            <SignalsTab messages={filteredMessages} />
          )}
          {activeTab === "logs" && <LogsTab />}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-700 mt-8 py-4 text-center text-xs text-slate-500">
        <p>
          CopyTrade — Automated AI Trading Signal Copier • Discord → AI →{" "}
          {(data?.exchangeProvider || "mexc").toUpperCase()}
        </p>
        <p className="mt-1">
          Mode: {tradingMode === "auto" ? "🤖 Auto" : "👆 Manual"} • Exchange:{" "}
          {data?.exchangeProvider === "okx"
            ? "OKX Demo"
            : (data?.exchangeProvider || "mexc").toUpperCase()}{" "}
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

function DraftsTab({
  drafts,
  actingDraft,
  onAccept,
  onReject,
  riskConfig,
  accountBalance,
}: {
  drafts: DraftTrade[];
  actingDraft: string | null;
  onAccept: (
    id: string,
    action: "accept" | "reject",
    extraBody?: Record<string, any>,
  ) => void;
  onReject: (
    id: string,
    action: "accept" | "reject",
    extraBody?: Record<string, any>,
  ) => void;
  riskConfig: RiskConfig | null;
  accountBalance: number;
}) {
  if (drafts.length === 0) {
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
      {pendingCount > 0 && (
        <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
          <span className="w-2 h-2 bg-amber-400 rounded-full pulse-dot" />
          Pending Review ({pendingCount})
        </h3>
      )}
      <div className="space-y-4">
        {drafts.map((draft) => (
          <DraftCard
            key={draft._id}
            draft={draft}
            acting={actingDraft === draft._id}
            onAccept={onAccept}
            onReject={onReject}
            riskConfig={riskConfig}
            accountBalance={accountBalance}
          />
        ))}
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  acting,
  onAccept,
  onReject,
  riskConfig,
  accountBalance,
}: {
  draft: DraftTrade;
  acting: boolean;
  onAccept: (
    id: string,
    action: "accept" | "reject",
    extraBody?: Record<string, any>,
  ) => void;
  onReject: (
    id: string,
    action: "accept" | "reject",
    extraBody?: Record<string, any>,
  ) => void;
  riskConfig: RiskConfig | null;
  accountBalance: number;
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
        const riskDist = Math.abs(draft.entryPrice! - draft.stopLoss!);
        const dir = draft.side === "LONG" ? 1 : -1;
        return Array.from(
          { length: customRR },
          (_, i) => draft.entryPrice! + dir * riskDist * (i + 1),
        );
      })()
    : [];

  // Parse orderType from signalData
  let orderType: string | null = null;
  try {
    const signal = JSON.parse(draft.signalData);
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

            {/* Author & Time */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500">
              <span>👤 @{draft.author}</span>
              {draft.discordTimestamp ? (
                <span className="text-blue-400">
                  💬 {new Date(draft.discordTimestamp).toLocaleString()}
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
          </div>

          {/* Action Buttons — only for pending */}
          {isPending && (
            <div className="flex sm:flex-col gap-2 sm:min-w-[120px]">
              <button
                onClick={() =>
                  onAccept(
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
                onClick={() => onReject(draft._id, "reject")}
                disabled={acting}
                className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                ❌ Reject
              </button>
            </div>
          )}

          {/* Collapse button for resolved */}
          {isResolved && (
            <div className="flex flex-col gap-2 sm:min-w-[120px]">
              <button
                onClick={() => setIsExpanded(false)}
                className="bg-slate-700 hover:bg-slate-600 text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                ▲ Collapse
              </button>
            </div>
          )}
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
              {JSON.stringify(JSON.parse(draft.signalData), null, 2)}
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

function PositionsTab({ positions }: { positions: Position[] }) {
  const [positionFilter, setPositionFilter] = useState<"open" | "closed">("open");

  const openPositions = positions.filter((p) => p.status === "open");
  const closedPositions = positions.filter((p) => p.status === "closed");
  const displayPositions = positionFilter === "open" ? openPositions : closedPositions;

  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="text-4xl mb-2">📭</div>
        <p>No positions yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Open / Closed sub-tabs */}
      <div className="flex gap-0 border-b border-slate-700 mb-4">
        <button
          onClick={() => setPositionFilter("open")}
          className={`px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition flex items-center gap-1.5 whitespace-nowrap ${
            positionFilter === "open"
              ? "border-green-500 text-green-400"
              : "border-transparent text-slate-400 hover:text-slate-300"
          }`}
        >
          🔓 Open
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
            positionFilter === "open"
              ? "bg-green-600/30 text-green-300"
              : "bg-slate-700 text-slate-400"
          }`}>
            {openPositions.length}
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
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
            positionFilter === "closed"
              ? "bg-slate-600/30 text-slate-300"
              : "bg-slate-700 text-slate-400"
          }`}>
            {closedPositions.length}
          </span>
        </button>
      </div>

      {displayPositions.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <div className="text-4xl mb-2">
            {positionFilter === "open" ? "📭" : "📋"}
          </div>
          <p>
            {positionFilter === "open"
              ? "No open positions."
              : "No closed positions yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
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
                <th>Opened</th>
                {positionFilter === "closed" && <th>Closed</th>}
              </tr>
            </thead>
            <tbody>
              {displayPositions.map((pos) => (
                <tr key={pos._id || pos.id}>
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
                    <td>{pos.currentPrice?.toFixed(4) || "-"}</td>
                  )}
                  <td>{pos.quantity}</td>
                  <td>{pos.leverage}x</td>
                  <td
                    className={`font-mono ${(pos.pnl || 0) >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {(pos.pnl || 0) >= 0 ? "+" : ""}
                    {pos.pnl?.toFixed(2) || "0.00"}
                  </td>
                  {positionFilter === "closed" && (
                    <td className="text-xs text-slate-400">
                      {pos.closeReason || "-"}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SignalsTab({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="text-4xl mb-2">📨</div>
        <p>No messages processed yet.</p>
      </div>
    );
  }

  return (
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
            <span className="text-xs text-slate-500">
              {new Date(msg.createdAt || msg.created_at || "").toLocaleString()}
            </span>
          </div>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">
            {msg.content}
          </p>
        </div>
      ))}
    </div>
  );
}

function LogsTab() {
  const [hideCronNoise, setHideCronNoise] = useState(true);
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<Log[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        hideCronNoise: String(hideCronNoise),
      });
      const res = await fetch(`/api/logs?${params}`);
      const json = await res.json();
      if (json.success) {
        setLogs(json.data.logs);
        setTotalCount(json.data.totalCount);
        setTotalPages(json.data.totalPages);
      }
    } catch {}
    setLoading(false);
  }, [page, hideCronNoise]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setPage(1);
  }, [hideCronNoise]);

  if (loading && logs.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="spinner mx-auto mb-3" />
        <p>Loading logs...</p>
      </div>
    );
  }

  if (!loading && totalCount === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="text-4xl mb-2">📝</div>
        <p>No activity logs yet.</p>
      </div>
    );
  }

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, totalCount);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHideCronNoise(!hideCronNoise)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
              hideCronNoise
                ? "bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
                : "bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700"
            }`}
            title={
              hideCronNoise
                ? "Hiding routine cron start/end logs. Click to show all."
                : "Showing all logs including routine cron heartbeats."
            }
          >
            <span>{hideCronNoise ? "🙈" : "👁️"}</span>
            <span>Cron noise</span>
          </button>
        </div>
        <span className="text-xs text-slate-500">
          {from}–{to} of {totalCount} logs
        </span>
      </div>

      {/* Log entries */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-2">
            <div className="spinner w-4 h-4 border-2" />
          </div>
        )}
        {logs.map((log) => (
          <div
            key={log._id || log.id}
            className={`border rounded-lg p-3 text-sm ${log.error ? "border-red-900/50 bg-red-950/20" : "border-slate-700"}`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="badge badge-info">{log.type}</span>
                <span className="text-slate-300">{log.action}</span>
                {log.symbol && (
                  <span className="text-primary-400 font-medium">
                    {log.symbol}
                  </span>
                )}
                {log.result && (
                  <span
                    className={`badge ${log.result === "success" || log.result === "executed" ? "badge-success" : log.result === "error" || log.result === "rejected" ? "badge-danger" : "badge-neutral"}`}
                  >
                    {log.result}
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500">
                {new Date(log.createdAt || log.created_at || "").toLocaleString()}
              </span>
            </div>
            {log.details && (
              <p className="text-slate-400 text-xs mt-1">{log.details}</p>
            )}
            {log.error && (
              <p className="text-red-400 text-xs mt-1">Error: {log.error}</p>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700/50">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Next →
          </button>
        </div>
      )}
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
