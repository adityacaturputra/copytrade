import React from 'react';
import { CronRunStatus } from './types';

export function StatusBadge({ status }: { status: string }) {
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
