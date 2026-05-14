import React from 'react';
import { CronRunStatus } from './types';

export function CronStatusPanel({
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
    "orphan-cleanup": "🧹 Orphan Cleanup",
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
