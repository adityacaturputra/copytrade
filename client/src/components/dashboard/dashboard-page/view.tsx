"use client";

import {
  DashboardAccountSummary,
  DashboardCronStatus,
  DashboardFilters,
  DashboardTabs,
} from "./sections";
import { DashboardHeader } from "./header";
import { useDashboardPage } from "./use-dashboard-page";

export function DashboardPageView() {
  const state = useDashboardPage();
  const {
    data,
    loading,
    loadingExchange,
    error,
    activeTab,
    setActiveTab,
    triggeringCron,
    switchingMode,
    actingDraft,
    cronStatus,
    expandedCron,
    setExpandedCron,
    selectedChannelId,
    setSelectedChannelId,
    selectedAccountId,
    setSelectedAccountId,
    refreshKey,
    cronMenuRef,
    showCronMenu,
    setShowCronMenu,
    triggerCron,
    toggleMode,
    handleDraftAction,
    fetchData,
  } = state;

  const accounts = data?.accounts || [];
  const stats = data?.stats || {
    totalMessages: 0,
    executedSignals: 0,
    openPositions: 0,
    closedPositions: 0,
    totalLogs: 0,
    pendingDrafts: 0,
  };
  const selectedAccount =
    selectedAccountId === "all"
      ? null
      : accounts.find((account) => account.accountId === selectedAccountId) || null;
  const visibleAccounts =
    selectedAccountId === "all"
      ? accounts.filter((account) => account.account || account.exchangeError)
      : selectedAccount
        ? [selectedAccount]
        : [];
  const displayAccount = selectedAccount;
  const displayExchangeError =
    displayAccount?.exchangeError ||
    (selectedAccountId === "all" ? data?.exchangeError || null : null);
  const exchangeHeaderLabel =
    selectedAccountId === "all"
      ? visibleAccounts.length > 0
        ? "MULTI ACCOUNT"
        : (data?.exchangeProvider || "unknown").toUpperCase()
      : (displayAccount?.tradingPlatform || data?.exchangeProvider || "unknown").toUpperCase();
  const openPositions = (data?.openPositions || []).filter(
    (position) => selectedAccountId === "all" || position.accountId === selectedAccountId,
  );
  const pendingPositions = (data?.pendingPositions || []).filter(
    (position) => selectedAccountId === "all" || position.accountId === selectedAccountId,
  );
  const connectedExchangeAccounts = visibleAccounts.filter((account) => Boolean(account.account));
  const demoExchangeAccounts = visibleAccounts.filter((account) => account.isDemo);
  const visibleBalanceTotals = connectedExchangeAccounts.reduce((acc, account) => {
    const currency = account.account?.currency || "USDT";
    if (!acc[currency]) acc[currency] = { totalBalance: 0, availableBalance: 0, unrealizedPnl: 0 };
    acc[currency].totalBalance += account.account?.totalBalance || 0;
    acc[currency].availableBalance += account.account?.availableBalance || 0;
    acc[currency].unrealizedPnl += account.account?.unrealizedPnl || 0;
    return acc;
  }, {} as Record<string, { totalBalance: number; availableBalance: number; unrealizedPnl: number }>);
  const visibleBalanceTotalEntries = Object.entries(visibleBalanceTotals);
  const displayAccountInfo =
    displayAccount?.account ||
    (selectedAccountId === "all" && visibleBalanceTotalEntries.length > 0
      ? { ...visibleBalanceTotalEntries[0][1], currency: visibleBalanceTotalEntries[0][0] }
      : data?.account || null);
  const channelNameMap = new Map(Object.entries(data?.channelNames || {}));
  const channelIdArray = Array.from(new Set(accounts.flatMap((account) => account.channelIds || [])));
  const hasVisibleExchangeConnection = visibleAccounts.some((account) => Boolean(account.account));
  const tradingMode = data?.tradingMode || "manual";

  return (
    <div className="min-h-screen bg-dark-100 text-slate-200">
      <DashboardHeader
        loading={loading}
        cronMenuRef={cronMenuRef}
        showCronMenu={showCronMenu}
        setShowCronMenu={setShowCronMenu}
        tradingMode={tradingMode}
        toggleMode={toggleMode}
        switchingMode={switchingMode}
        triggeringCron={triggeringCron}
        triggerCron={triggerCron}
        fetchData={fetchData}
        isUnlocked={state.isUnlocked}
        isVerifying={state.isVerifying}
        unlock={state.unlock}
        lock={state.lock}
        menuPassword={state.menuPassword}
        setMenuPassword={state.setMenuPassword}
        authError={state.authError}
      />

      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6">
        {error && !data ? (
          <div className="card border border-rose-900/40 bg-rose-950/20 text-rose-300">
            ⚠️ {error}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <DashboardAccountSummary
              exchangeHeaderLabel={exchangeHeaderLabel}
              selectedAccountId={selectedAccountId}
              displayAccount={displayAccount}
              displayAccountInfo={displayAccountInfo}
              displayExchangeError={displayExchangeError}
              loadingExchange={loadingExchange}
              hasVisibleExchangeConnection={hasVisibleExchangeConnection}
              visibleExchangeAccounts={visibleAccounts}
              connectedExchangeAccounts={connectedExchangeAccounts}
              demoExchangeAccounts={demoExchangeAccounts}
              visibleBalanceTotalEntries={visibleBalanceTotalEntries}
            />

            <DashboardCronStatus
              cronStatus={cronStatus}
              expandedCron={expandedCron}
              onToggle={setExpandedCron}
            />

            <div className="card">
              <DashboardFilters
                accounts={accounts}
                selectedAccountId={selectedAccountId}
                setSelectedAccountId={setSelectedAccountId}
                channelIdArray={channelIdArray}
                selectedChannelId={selectedChannelId}
                setSelectedChannelId={setSelectedChannelId}
                channelNameMap={channelNameMap}
              />

              <DashboardTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                pendingDraftCount={data?.pendingDrafts?.length || 0}
                selectedChannelId={selectedChannelId}
                selectedAccountId={selectedAccountId}
                refreshKey={refreshKey}
                actingDraft={actingDraft}
                onDraftAction={handleDraftAction}
                riskConfig={data?.riskConfig || null}
                accountBalance={
                  displayAccountInfo?.availableBalance ||
                  displayAccountInfo?.totalBalance ||
                  0
                }
                openPositions={openPositions}
                pendingPositions={pendingPositions}
                channelNames={data?.channelNames || {}}
                loadingExchange={loadingExchange}
              />
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-700 mt-8 py-4 text-center text-xs text-slate-500">
        <p>CopyTrade — Automated AI Trading Signal Copier • Discord → AI → {exchangeHeaderLabel}</p>
        <p className="mt-1">
          Mode: {tradingMode === "auto" ? "🤖 Auto" : "👆 Manual"} • Exchange: {selectedAccountId === "all" ? exchangeHeaderLabel : displayAccount?.isDemo ? `${exchangeHeaderLabel} Demo` : exchangeHeaderLabel} • Cron: Signal Check every 5 min • Position Monitor every 30 min
        </p>
      </footer>
    </div>
  );
}
