"use client";

import { CronStatusPanel } from "@/components/dashboard/CronStatusPanel";
import { DraftsTab } from "@/components/dashboard/DraftsTab";
import { LogsTab } from "@/components/dashboard/LogsTab";
import { PositionSummaryPanel } from "@/components/dashboard/PositionSummaryPanel";
import { PositionsTab } from "@/components/dashboard/PositionsTab";
import { SignalsTab } from "@/components/dashboard/SignalsTab";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import type { AccountExchangeInfo, CronRunStatus, DashboardData, DraftAction, RiskConfig } from "@/components/dashboard/types";

export function DashboardTabs(props: {
  activeTab: "positions" | "drafts" | "signals" | "logs";
  setActiveTab: (tab: "positions" | "drafts" | "signals" | "logs") => void;
  pendingDraftCount: number;
  selectedChannelId: string;
  selectedAccountId: string;
  refreshKey: number;
  actingDraft: string | null;
  onDraftAction: (id: string, action: DraftAction, extraBody?: Record<string, unknown>) => void;
  riskConfig: RiskConfig | null;
  accountBalance: number;
  openPositions: DashboardData["openPositions"];
  pendingPositions: DashboardData["pendingPositions"];
  channelNames: Record<string, string>;
  loadingExchange: boolean;
}) {
  const { activeTab, setActiveTab, pendingDraftCount, selectedChannelId, selectedAccountId, refreshKey, actingDraft, onDraftAction, riskConfig, accountBalance, openPositions, pendingPositions, channelNames, loadingExchange } = props;
  return (
    <>
      <PositionSummaryPanel positions={openPositions || []} title={<>Active Positions ({openPositions?.length || 0})</>} dotColor="bg-success" type="open" channelNames={channelNames} loadingExchange={loadingExchange} />
      <PositionSummaryPanel positions={pendingPositions || []} title={<><span className="text-amber-400">Pending Limit Orders</span><span className="text-sm font-normal text-slate-400">({pendingPositions?.length || 0} waiting to fill)</span></>} borderColor="border-amber-700/30" dotColor="bg-amber-400" dotAnimate type="pending" channelNames={channelNames} footerNote={<p className="text-xs text-slate-500">⏳ These limit orders are placed on the exchange and waiting for the price to reach the entry level. Margin is shown from the planned trade sizing when available, otherwise estimated from entry value divided by leverage. SL and TP are already set on the exchange.</p>} />
      <div className="card">
        <div className="flex overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-slate-700 mb-4 gap-0 scrollbar-hide">
          <button onClick={() => setActiveTab("drafts")} className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition flex items-center gap-1 whitespace-nowrap ${activeTab === "drafts" ? "border-primary-500 text-primary-400" : "border-transparent text-slate-400 hover:text-slate-300"}`}>📝 Drafts{pendingDraftCount > 0 ? <span className="bg-primary-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{pendingDraftCount}</span> : null}</button>
          <button onClick={() => setActiveTab("positions")} className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition whitespace-nowrap ${activeTab === "positions" ? "border-primary-500 text-primary-400" : "border-transparent text-slate-400 hover:text-slate-300"}`}>📊 Positions</button>
          <button onClick={() => setActiveTab("signals")} className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition whitespace-nowrap ${activeTab === "signals" ? "border-primary-500 text-primary-400" : "border-transparent text-slate-400 hover:text-slate-300"}`}>📨 Signals</button>
          <button onClick={() => setActiveTab("logs")} className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition whitespace-nowrap ${activeTab === "logs" ? "border-primary-500 text-primary-400" : "border-transparent text-slate-400 hover:text-slate-300"}`}>📝 Logs</button>
        </div>
        {activeTab === "drafts" ? <DraftsTab channelIdFilter={selectedChannelId} accountIdFilter={selectedAccountId} refreshKey={refreshKey} actingDraft={actingDraft} onDraftAction={onDraftAction} riskConfig={riskConfig} accountBalance={accountBalance} /> : null}
        {activeTab === "positions" ? <PositionsTab channelIdFilter={selectedChannelId} accountIdFilter={selectedAccountId} refreshKey={refreshKey} livePositions={openPositions || []} channelNames={channelNames} /> : null}
        {activeTab === "signals" ? <SignalsTab channelIdFilter={selectedChannelId} accountIdFilter={selectedAccountId} refreshKey={refreshKey} /> : null}
        {activeTab === "logs" ? <LogsTab channelIdFilter={selectedChannelId} accountIdFilter={selectedAccountId} refreshKey={refreshKey} /> : null}
      </div>
    </>
  );
}

export function DashboardCronStatus(props: { cronStatus: Record<string, CronRunStatus> | null; expandedCron: string | null; onToggle: (name: string | null) => void; }) {
  const { cronStatus, expandedCron, onToggle } = props;
  return cronStatus ? <CronStatusPanel cronStatus={cronStatus} expandedCron={expandedCron} onToggle={onToggle} /> : null;
}

export function DashboardFilters(props: { accounts: AccountExchangeInfo[]; selectedAccountId: string; setSelectedAccountId: (value: string) => void; channelIdArray: string[]; selectedChannelId: string; setSelectedChannelId: (value: string) => void; channelNameMap: Map<string, string>; }) {
  const { accounts, selectedAccountId, setSelectedAccountId, channelIdArray, selectedChannelId, setSelectedChannelId, channelNameMap } = props;
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">📡 Account:</span><button onClick={() => setSelectedAccountId("all")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${selectedAccountId === "all" ? "bg-primary-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>All Accounts</button>{accounts.map((acct) => <button key={acct.accountId} onClick={() => setSelectedAccountId(acct.accountId)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${selectedAccountId === acct.accountId ? "bg-primary-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>{acct.accountName} <span className="opacity-60">{acct.tradingPlatform.toUpperCase()}{acct.isDemo ? " (DEMO)" : ""}</span></button>)}</div>
      {channelIdArray.length > 0 ? <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">📺 Channel:</span><button onClick={() => setSelectedChannelId("all")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${selectedChannelId === "all" ? "bg-primary-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>All Channels</button>{(selectedAccountId === "all" ? channelIdArray : channelIdArray.filter((chId) => accounts.find((a) => a.accountId === selectedAccountId)?.channelIds?.includes(chId))).map((chId) => { const sourceName = channelNameMap.get(chId); const shortId = chId.length > 8 ? `...${chId.slice(-6)}` : chId; return <button key={chId} onClick={() => setSelectedChannelId(chId)} title={chId} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${selectedChannelId === chId ? "bg-primary-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>{sourceName ? <span className="flex items-center gap-1.5"><span>{sourceName}</span><span className="text-[10px] opacity-50 font-mono">{shortId}</span></span> : <span className="font-mono">{chId}</span>}</button>; })}</div> : null}
    </div>
  );
}

export function DashboardStats(props: { stats: any }) {
  const { stats } = props;
  return <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-4"><StatCard label="Total Signals" value={stats.totalMessages.toString()} icon="📨" /><StatCard label="Executed" value={stats.executedSignals.toString()} icon="✅" /><StatCard label="Open Positions" value={stats.openPositions.toString()} icon="🔓" highlight={stats.openPositions > 0} /><StatCard label="Closed" value={stats.closedPositions.toString()} icon="📋" /><StatCard label="Pending Drafts" value={stats.pendingDrafts.toString()} icon="📝" highlight={stats.pendingDrafts > 0} /><StatCard label="Total Logs" value={stats.totalLogs.toString()} icon="📄" /></div>;
}

function StatCard({ label, value, icon, highlight, danger }: { label: string; value: string; icon: string; highlight?: boolean; danger?: boolean }) {
  return <div className="card"><div className="flex items-center gap-2 mb-2"><span className="text-lg">{icon}</span><span className="text-xs text-slate-400 uppercase tracking-wider">{label}</span></div><div className={`text-xl font-bold ${danger ? "text-danger" : highlight ? "text-success" : "text-white"}`}>{value}</div></div>;
}

export function DashboardAccountSummary(props: {
  exchangeHeaderLabel: string;
  selectedAccountId: string;
  displayAccount: AccountExchangeInfo | null;
  displayAccountInfo: { totalBalance: number; availableBalance: number; unrealizedPnl: number; currency: string } | null;
  displayExchangeError: string | null;
  loadingExchange: boolean;
  hasVisibleExchangeConnection: boolean;
  visibleExchangeAccounts: AccountExchangeInfo[];
  connectedExchangeAccounts: AccountExchangeInfo[];
  demoExchangeAccounts: AccountExchangeInfo[];
  visibleBalanceTotalEntries: Array<[string, { totalBalance: number; availableBalance: number; unrealizedPnl: number }]>;
}) {
  const { exchangeHeaderLabel, selectedAccountId, displayAccount, displayAccountInfo, displayExchangeError, loadingExchange, hasVisibleExchangeConnection, visibleExchangeAccounts, connectedExchangeAccounts, demoExchangeAccounts, visibleBalanceTotalEntries } = props;
  return (
    <div className={`rounded-xl px-3 sm:px-4 py-3.5 sm:py-4 ${hasVisibleExchangeConnection ? "border border-slate-700 bg-slate-800/50" : "border border-red-700/50 bg-red-900/30"}`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${hasVisibleExchangeConnection ? "bg-green-500 pulse-dot" : "bg-red-500 animate-pulse"}`} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 flex items-center gap-2">Exchange Overview{loadingExchange ? <div className="spinner w-3 h-3 border-2" title="Syncing with exchange..." /> : null}</span>
                <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200">{exchangeHeaderLabel}</span>
                {displayAccount?.isDemo ? <span className="badge badge-warning">Demo Mode</span> : null}
              </div>
              <p className="mt-1 text-sm text-slate-300">{selectedAccountId === "all" ? `${visibleExchangeAccounts.length} trading account${visibleExchangeAccounts.length === 1 ? "" : "s"} visible` : displayAccount ? `${displayAccount.accountName} • ${displayAccount.tradingPlatform.toUpperCase()}` : "No account selected"}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">Connected</div><div className="mt-1 text-sm font-semibold text-white">{connectedExchangeAccounts.length}/{visibleExchangeAccounts.length}</div></div>
            <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">Demo Accounts</div><div className="mt-1 text-sm font-semibold text-white">{demoExchangeAccounts.length}</div></div>
            {visibleBalanceTotalEntries.map(([currency, totals]) => <div key={currency} className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">All Accounts ({currency})</div><div className="mt-1 text-sm font-semibold text-white">{totals.totalBalance.toFixed(2)}</div><div className="text-xs text-slate-400">Avail. {totals.availableBalance.toFixed(2)} • PnL {totals.unrealizedPnl >= 0 ? "+" : ""}{totals.unrealizedPnl.toFixed(2)}</div></div>)}
          </div>
        </div>

        {selectedAccountId === "all" && visibleExchangeAccounts.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleExchangeAccounts.map((account) => (
              <div key={account.accountId} className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-white">{account.accountName}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{account.tradingPlatform}</span>
                      <span className="text-[11px] uppercase tracking-[0.16em] text-slate-600">{account.sourceType}</span>
                    </div>
                  </div>
                  {account.isDemo ? <span className="badge badge-warning">Demo Mode</span> : null}
                </div>
                {account.account ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-900/70 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">Balance</div><div className="mt-1 font-mono text-lg font-semibold text-white">{account.account.totalBalance?.toFixed(2)}</div><div className="text-xs text-slate-400">{account.account.currency}</div></div>
                    <div className="rounded-lg bg-slate-900/70 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">Available</div><div className="mt-1 font-mono text-lg font-semibold text-white">{account.account.availableBalance?.toFixed(2)}</div><div className="text-xs text-slate-400">Free margin</div></div>
                    <div className="rounded-lg bg-slate-900/70 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">Unrealized PnL</div><div className={`mt-1 font-mono text-lg font-semibold ${account.account.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{account.account.unrealizedPnl >= 0 ? "+" : ""}{account.account.unrealizedPnl?.toFixed(2)}</div><div className="text-xs text-slate-400">Live exchange</div></div>
                  </div>
                ) : account.exchangeError ? <div className="mt-4 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">⚠️ {account.exchangeError || "Failed to load exchange balance."}</div> : null}
              </div>
            ))}
          </div>
        ) : loadingExchange && !displayAccountInfo ? (
          <div className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-6 flex flex-col items-center justify-center gap-3"><div className="spinner w-6 h-6 border-2" /><span className="text-sm text-slate-400">Loading exchange account...</span></div>
        ) : displayAccountInfo ? (
          <div className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">{displayAccount?.accountName || "Selected Account"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{displayAccount?.tradingPlatform || exchangeHeaderLabel}</span>{displayAccount?.sourceType ? <span className="text-[11px] uppercase tracking-[0.16em] text-slate-600">{displayAccount.sourceType}</span> : null}</div>
              </div>
              {displayAccount?.isDemo ? <span className="badge badge-warning">Demo Mode</span> : null}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-900/70 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">Balance</div><div className="mt-1 font-mono text-lg font-semibold text-white">{displayAccountInfo.totalBalance?.toFixed(2)}</div><div className="text-xs text-slate-400">{displayAccountInfo.currency}</div></div>
              <div className="rounded-lg bg-slate-900/70 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">Available</div><div className="mt-1 font-mono text-lg font-semibold text-white">{displayAccountInfo.availableBalance?.toFixed(2)}</div><div className="text-xs text-slate-400">Free margin</div></div>
              <div className="rounded-lg bg-slate-900/70 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">Unrealized PnL</div><div className={`mt-1 font-mono text-lg font-semibold ${displayAccountInfo.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{displayAccountInfo.unrealizedPnl >= 0 ? "+" : ""}{displayAccountInfo.unrealizedPnl?.toFixed(2)}</div><div className="text-xs text-slate-400">Live exchange</div></div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">⚠️ {displayExchangeError || (visibleExchangeAccounts.length === 0 ? "No connected exchange accounts found." : "No account data available.")}</div>
        )}
      </div>
    </div>
  );
}
