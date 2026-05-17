import { RiskConfig } from './types';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Position, DraftTrade, formatUsd, formatCompactDateTime, getPositionSourceLabel, getPositionKey, formatPositionTakeProfitTargets, calculatePositionPnlUsd, estimatePositionMargin, formatMarginMode, resolvePositionPnlUsd, resolvePositionPnlPercent, DraftAction } from './types';
import { PaginationBar } from './PaginationBar';
import { StatusBadge } from './StatusBadge';
import { ProcessLogsAccordion } from './ProcessLogsAccordion';
import { DraftCard } from './DraftCard';

export function DraftsTab({
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
      <div className="space-y-4 min-h-[520px]">
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 rounded bg-slate-800/80 animate-pulse" />
          <div className="h-8 w-24 rounded-lg bg-slate-800/80 animate-pulse" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-slate-700/70 bg-slate-900/40 p-4 animate-pulse">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-slate-800/80" />
              <div className="h-5 w-12 rounded-full bg-slate-800/80" />
              <div className="h-5 w-20 rounded bg-slate-800/80" />
            </div>
            <div className="mt-3 h-4 w-48 rounded bg-slate-800/70" />
            <div className="mt-2 h-20 rounded-lg bg-slate-800/60" />
          </div>
        ))}
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
