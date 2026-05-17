import type { TradeLogListOptions, TradeLogRecord } from "./types";

export function dedupeLogs(logs: TradeLogRecord[]) {
  const byId = new Map<string, TradeLogRecord>();
  for (const log of logs) {
    const existing = byId.get(log._id);
    if (!existing) {
      byId.set(log._id, log);
      continue;
    }
    const existingTime = new Date(existing.createdAt).getTime();
    const nextTime = new Date(log.createdAt).getTime();
    if (nextTime >= existingTime) byId.set(log._id, log);
  }
  return Array.from(byId.values());
}

export function looksLikeStructuredJson(value: string | null | undefined) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function shouldHideCronNoise(log: TradeLogRecord) {
  if (log.type !== "cron") return false;
  const action = String(log.action || "").toLowerCase();
  return action.includes("signal_check_start") || action.includes("heartbeat") || action.includes("noop") || action.includes("healthcheck");
}

export function isNoisyTradeLog(log: TradeLogRecord) {
  return shouldHideCronNoise(log) || looksLikeStructuredJson(log.details) || looksLikeStructuredJson(log.result);
}

export function isHiddenByDefaultTradeLog(log: TradeLogRecord) {
  if (shouldHideCronNoise(log)) return true;
  const type = String(log.type || "").toLowerCase();
  const action = String(log.action || "").toLowerCase();
  const details = String(log.details || "").toLowerCase();

  if (type === "executor_console" && details.includes("no new messages")) return true;
  if (type === "monitor" && action === "monitor_started") return true;
  if (type === "agent_turn" && action === "model_stream_started") return true;
  if ((type === "tpsl-monitor" || type === "monitor") && action === "pending_limit_still_live") return true;
  return false;
}

export function applyLogFilters(logs: TradeLogRecord[], options: TradeLogListOptions) {
  return logs.filter((log) => {
    if (options.accountId && log.accountId !== options.accountId) return false;
    if (options.processId && log.processId !== options.processId) return false;
    if (options.symbol && log.symbol !== options.symbol) return false;
    if (options.levels?.length && !options.levels.includes(String(log.level || ""))) return false;
    if (options.hideCronNoise !== false && (shouldHideCronNoise(log) || isHiddenByDefaultTradeLog(log))) return false;
    return true;
  });
}

export function sortLogs(logs: TradeLogRecord[], order: "asc" | "desc" = "desc") {
  return [...logs].sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return order === "asc" ? aTime - bTime : bTime - aTime;
  });
}
