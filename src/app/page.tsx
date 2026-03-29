"use client";

import { useState, useEffect, useCallback } from "react";

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
  takeProfitPrice?: number;
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

interface DashboardData {
  stats: Stats;
  account: AccountInfo | null;
  exchangeProvider: string | null;
  exchangeError: string | null;
  openPositions: Position[];
  recentMessages: Message[];
  recentLogs: Log[];
  allPositions: Position[];
  pendingDrafts: DraftTrade[];
  recentDrafts: DraftTrade[];
  tradingMode: "auto" | "manual";
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

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const triggerCron = async (type: "signal-check" | "position-monitor") => {
    setTriggeringCron(type);
    try {
      const res = await fetch(`/api/cron/${type}`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        alert(
          `${type} completed successfully!\n${JSON.stringify(json, null, 2)}`,
        );
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
  ) => {
    setActingDraft(draftId);
    try {
      const res = await fetch(`/api/drafts/${draftId}/${action}`, {
        method: "POST",
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

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-700 bg-dark-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-2xl">📈</div>
              <div>
                <h1 className="text-xl font-bold text-white">CopyTrade</h1>
                <p className="text-xs text-slate-400">
                  AI-Powered Discord Signal Copier
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Trading Mode Toggle */}
              <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-400">Mode:</span>
                <button
                  onClick={toggleMode}
                  disabled={switchingMode}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    tradingMode === "auto" ? "bg-green-600" : "bg-slate-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      tradingMode === "auto" ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
                <span
                  className={`text-xs font-semibold ${tradingMode === "auto" ? "text-green-400" : "text-amber-400"}`}
                >
                  {tradingMode === "auto" ? "🤖 AUTO" : "👆 MANUAL"}
                </span>
              </div>

              <button
                onClick={() => triggerCron("signal-check")}
                disabled={triggeringCron === "signal-check"}
                className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                {triggeringCron === "signal-check" ? (
                  <div className="spinner w-4 h-4 border-2" />
                ) : (
                  "🔍"
                )}
                Check Signals
              </button>
              <button
                onClick={() => triggerCron("position-monitor")}
                disabled={triggeringCron === "position-monitor"}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                {triggeringCron === "position-monitor" ? (
                  <div className="spinner w-4 h-4 border-2" />
                ) : (
                  "📊"
                )}
                Monitor
              </button>
              <a
                href="/settings"
                className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm transition"
              >
                ⚙️
              </a>
              <button
                onClick={fetchData}
                className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded-lg text-sm transition"
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
          className={`rounded-lg px-4 py-3 flex items-center gap-3 ${
            data?.account
              ? "bg-slate-800/50 border border-slate-700"
              : "bg-red-900/30 border border-red-700/50"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${data?.account ? "bg-green-500 pulse-dot" : "bg-red-500 animate-pulse"}`}
            />
            <span className="text-sm font-medium">
              Exchange:{" "}
              <span className="text-white uppercase">
                {data?.exchangeProvider || "unknown"}
              </span>
            </span>
          </div>
          {data?.account ? (
            <div className="flex items-center gap-4 ml-4 text-sm">
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
            <div className="ml-4 text-sm">
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
          {data?.exchangeProvider === "okx" && (
            <span className="ml-auto badge badge-warning">DEMO MODE</span>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
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
                        {pos.takeProfitPrice?.toFixed(2) || "-"}
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

        {/* Tabs */}
        <div className="card">
          <div className="flex border-b border-slate-700 mb-4">
            <button
              onClick={() => setActiveTab("drafts")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center gap-1 ${
                activeTab === "drafts"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              📝 Draft Trades
              {data?.pendingDrafts && data.pendingDrafts.length > 0 && (
                <span className="bg-primary-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {data.pendingDrafts.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("positions")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                activeTab === "positions"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              📊 All Positions
            </button>
            <button
              onClick={() => setActiveTab("signals")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                activeTab === "signals"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              📨 Signals
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
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
              drafts={data?.recentDrafts || []}
              actingDraft={actingDraft}
              onAccept={handleDraftAction}
              onReject={handleDraftAction}
            />
          )}
          {activeTab === "positions" && (
            <PositionsTab positions={data?.allPositions || []} />
          )}
          {activeTab === "signals" && (
            <SignalsTab messages={data?.recentMessages || []} />
          )}
          {activeTab === "logs" && <LogsTab logs={data?.recentLogs || []} />}
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
}: {
  drafts: DraftTrade[];
  actingDraft: string | null;
  onAccept: (id: string, action: "accept" | "reject") => void;
  onReject: (id: string, action: "accept" | "reject") => void;
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

  const pending = drafts.filter((d) => d.status === "pending");
  const resolved = drafts.filter((d) => d.status !== "pending");

  return (
    <div className="space-y-6">
      {/* Pending Drafts */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-amber-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-amber-400 rounded-full pulse-dot" />
            Pending Review ({pending.length})
          </h3>
          <div className="space-y-4">
            {pending.map((draft) => (
              <DraftCard
                key={draft._id}
                draft={draft}
                acting={actingDraft === draft._id}
                onAccept={onAccept}
                onReject={onReject}
              />
            ))}
          </div>
        </div>
      )}

      {/* Resolved Drafts */}
      {resolved.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-400 mb-3">
            History ({resolved.length})
          </h3>
          <div className="space-y-3">
            {resolved.map((draft) => (
              <ResolvedDraftCard key={draft._id} draft={draft} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DraftCard({
  draft,
  acting,
  onAccept,
  onReject,
}: {
  draft: DraftTrade;
  acting: boolean;
  onAccept: (id: string, action: "accept" | "reject") => void;
  onReject: (id: string, action: "accept" | "reject") => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="border border-amber-700/50 bg-amber-950/20 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`badge ${draft.side === "LONG" ? "badge-success" : "badge-danger"}`}
              >
                {draft.action}
              </span>
              <span className="text-lg font-bold text-white">
                {draft.symbol}
              </span>
              <span className="badge badge-warning">{draft.leverage}x</span>
              {draft.confidence > 0 && (
                <span className="badge badge-info">
                  {draft.confidence}% conf.
                </span>
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
              {draft.takeProfitTargets?.[0] && (
                <div>
                  <span className="text-slate-500">TP:</span>{" "}
                  <span className="text-success font-mono">
                    {draft.takeProfitTargets[0]}
                  </span>
                </div>
              )}
              {draft.stopLoss && (
                <div>
                  <span className="text-slate-500">SL:</span>{" "}
                  <span className="text-danger font-mono">
                    {draft.stopLoss}
                  </span>
                </div>
              )}
            </div>

            {/* Reasoning */}
            {draft.reasoning && (
              <p className="text-slate-300 text-sm bg-slate-800/50 rounded p-2 mb-3">
                💡 {draft.reasoning}
              </p>
            )}

            {/* Author & Time */}
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>👤 @{draft.author}</span>
              {draft.discordTimestamp ? (
                <span className="text-blue-400">
                  💬 Discord:{" "}
                  {new Date(draft.discordTimestamp).toLocaleString()}
                </span>
              ) : null}
              <span>
                🕐 Drafted: {new Date(draft.createdAt).toLocaleString()}
              </span>
              {draft.messageUrl && (
                <a
                  href={draft.messageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300 underline"
                >
                  🔗 Discord Message
                </a>
              )}
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-slate-400 hover:text-white transition"
              >
                {showDetails ? "▼ Hide" : "▶ Show"} original message
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 min-w-[120px]">
            <button
              onClick={() => onAccept(draft._id, "accept")}
              disabled={acting}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
            >
              {acting ? <div className="spinner w-4 h-4 border-2" /> : "✅"}
              Accept
            </button>
            <button
              onClick={() => onReject(draft._id, "reject")}
              disabled={acting}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
            >
              ❌ Reject
            </button>
          </div>
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
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src={url}
                      alt={`Attachment ${i + 1}`}
                      className="h-24 w-auto rounded-lg border border-slate-600 hover:border-primary-500 transition object-cover"
                    />
                  </a>
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
    </div>
  );
}

function ResolvedDraftCard({ draft }: { draft: DraftTrade }) {
  const statusConfig: Record<string, { icon: string; class: string }> = {
    accepted: { icon: "✅", class: "border-green-900/30 bg-green-950/10" },
    rejected: { icon: "❌", class: "border-red-900/30 bg-red-950/10" },
    expired: { icon: "⏰", class: "border-slate-700/50 bg-slate-800/20" },
  };
  const config = statusConfig[draft.status] || statusConfig.expired;

  return (
    <div className={`border rounded-lg p-3 ${config.class}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{config.icon}</span>
          <span
            className={`badge ${draft.side === "LONG" ? "badge-success" : "badge-danger"}`}
          >
            {draft.action}
          </span>
          <span className="font-medium">{draft.symbol}</span>
          <span className="text-slate-500 text-xs">by @{draft.author}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
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
          <span>
            {draft.discordTimestamp
              ? `💬 ${new Date(draft.discordTimestamp).toLocaleString()}`
              : draft.resolvedAt
                ? new Date(draft.resolvedAt).toLocaleString()
                : new Date(draft.createdAt).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function PositionsTab({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="text-4xl mb-2">📭</div>
        <p>No positions yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Entry</th>
            <th>Current</th>
            <th>Qty</th>
            <th>Leverage</th>
            <th>PnL</th>
            <th>Status</th>
            <th>Close Reason</th>
            <th>Opened</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => (
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
              <td>{pos.currentPrice?.toFixed(4) || "-"}</td>
              <td>{pos.quantity}</td>
              <td>{pos.leverage}x</td>
              <td
                className={`font-mono ${(pos.pnl || 0) >= 0 ? "text-success" : "text-danger"}`}
              >
                {(pos.pnl || 0) >= 0 ? "+" : ""}
                {pos.pnl?.toFixed(2) || "0.00"}
              </td>
              <td>
                <StatusBadge status={pos.status} />
              </td>
              <td className="text-xs text-slate-400">
                {pos.closeReason || "-"}
              </td>
              <td className="text-xs text-slate-400">
                {new Date(pos.openedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

function LogsTab({ logs }: { logs: Log[] }) {
  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <div className="text-4xl mb-2">📝</div>
        <p>No activity logs yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto">
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
