import React from 'react';
import { AgentStep, AgentApproval } from '../types';

export function ApprovalCard({
  approval,
  disabled,
  onApprove,
  onReject,
}: {
  approval: AgentApproval;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-900/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-200">
            Approval required for `{approval.toolName}`
          </p>
          <p className="mt-1 text-xs text-amber-100/80">
            Current role: {approval.role} • minimum role: {approval.minimumRole}
          </p>
        </div>
        <span className="text-xs text-amber-100/70">{approval.processId}</span>
      </div>
      <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950/40 p-3 text-xs text-slate-300">
        {JSON.stringify(approval.toolArgs, null, 2)}
      </pre>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onApprove}
          disabled={disabled}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={disabled}
          className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
