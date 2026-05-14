import { calculateRisk } from "@copytrade/shared/lib/risk-calc";
import { autoCalculateTPFromRR } from "@copytrade/shared/lib/executor-signal-utils";
import { RiskConfig } from './types';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Position, DraftTrade, formatUsd, formatCompactDateTime, getPositionSourceLabel, getPositionKey, formatPositionTakeProfitTargets, calculatePositionPnlUsd, estimatePositionMargin, formatMarginMode, resolvePositionPnlUsd, resolvePositionPnlPercent, DraftAction } from './types';
import { PaginationBar } from './PaginationBar';
import { StatusBadge } from './StatusBadge';
import { ProcessLogsAccordion } from './ProcessLogsAccordion';
import { ImageModal } from './ImageModal';

export function DraftCard({
  draft,
  acting,
  onDraftAction,
  riskConfig,
  accountBalance,
  refreshKey,
}: {
  draft: DraftTrade;
  acting: boolean;
  onDraftAction: (
    id: string,
    action: DraftAction,
    extraBody?: Record<string, unknown>,
  ) => void;
  riskConfig: RiskConfig | null;
  accountBalance: number;
  refreshKey: number;
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
        return autoCalculateTPFromRR(
          draft.entryPrice!,
          draft.stopLoss!,
          customRR,
          draft.side,
        );
      })()
    : [];

  // Parse orderType from signalData
  let orderType: string | null = null;
  let parsedSignalData: unknown = null;
  try {
    const signal = JSON.parse(draft.signalData);
    parsedSignalData = signal;
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

              {isResolved && (
                <button
                  onClick={() => setIsExpanded(false)}
                  className="ml-auto bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-md text-xs transition flex items-center gap-1 border border-slate-700"
                  title="Collapse"
                >
                  <span className="hidden sm:inline">Collapse</span>
                  <span>▲</span>
                </button>
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
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={customRR}
                      onChange={(e) =>
                        setCustomRR(
                          Math.max(0.5, parseFloat(e.target.value) || 0.5),
                        )
                      }
                      className="h-7 w-20 rounded border border-slate-600 bg-slate-800 px-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                {/* Preview auto-calculated TPs */}
                {autoTPs.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    <span className="text-slate-400">Preview:</span>
                    {autoTPs.map((tp: number, idx: number) => (
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
          </div>

          {/* Action Buttons — only for pending */}
          {isPending && (
            <div className="flex sm:flex-col gap-2 sm:min-w-[120px]">
              <button
                onClick={() =>
                  onDraftAction(
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
                onClick={() => onDraftAction(draft._id, "reject")}
                disabled={acting}
                className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                ❌ Reject
              </button>
              <button
                onClick={() => onDraftAction(draft._id, "reanalyze")}
                disabled={acting}
                className="flex-1 sm:flex-none bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                🔄 Re-analyze
              </button>
            </div>
          )}

          {/* Collapse button for resolved */}
          {isResolved && (
            <div className="flex flex-col gap-2 sm:min-w-[120px]">
              <button
                onClick={() => onDraftAction(draft._id, "redraft")}
                disabled={acting}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                {acting ? <div className="spinner w-4 h-4 border-2" /> : "📝"}
                Draft Again
              </button>
              <button
                onClick={() => onDraftAction(draft._id, "reanalyze")}
                disabled={acting}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center justify-center gap-1"
              >
                🔄 Re-analyze
              </button>
            </div>
          )}
        </div>

        {/* Discord Context & Process Logs */}
        <div className="mt-4 pt-3 border-t border-slate-700/50">
          {/* Author & Time */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500 mb-2">
            <span>👤 @{draft.author}</span>
            {draft.sourceTimestamp ? (
              <span className="text-blue-400">
                💬 {new Date(draft.sourceTimestamp).toLocaleString()}
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

          <ProcessLogsAccordion
            processId={draft.processId}
            refreshKey={refreshKey}
          />
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
              {JSON.stringify(parsedSignalData || draft.signalData, null, 2)}
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
