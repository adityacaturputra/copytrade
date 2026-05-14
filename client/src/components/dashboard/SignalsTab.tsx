import React, { useState, useEffect, useCallback } from 'react';
import { PaginationBar } from './PaginationBar';
import { StatusBadge } from './StatusBadge';
import { Log, Message, formatCompactDateTime, getLogLevelBadgeClass } from './types';

export function SignalsTab({
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
