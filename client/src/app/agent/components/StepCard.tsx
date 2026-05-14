import { formatToolResult } from '../utils';
import React from 'react';
import { AgentStep, AgentApproval } from '../types';

export function StepCard({ step }: { step: AgentStep }) {
  if (step.type === "tool_call") {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-primary-400">
            {step.toolName}
          </span>
          {step.toolArgs ? (
            <span className="truncate text-xs text-slate-500">
              {Object.entries(step.toolArgs)
                .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                .join(", ")}
            </span>
          ) : null}
          {step.duration ? (
            <span className="ml-auto text-xs text-slate-600">
              {step.duration}ms
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  const isError = step.content.includes('"error"');
  return (
    <div
      className={`rounded-lg p-2.5 text-xs font-mono ${
        isError
          ? "border border-red-700/30 bg-red-900/20 text-red-300"
          : "border border-green-700/20 bg-green-900/10 text-slate-300"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span>{isError ? "❌" : "✅"}</span>
        <span className="text-slate-500">{step.toolName} result</span>
      </div>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
        {formatToolResult(step.content)}
      </pre>
    </div>
  );
}
