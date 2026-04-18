import { randomUUID } from "crypto";
import { createTradeLog } from "./trade-log-store";

export interface ProcessLogInput {
  accountId?: string | null;
  processId?: string | null;
  type: string;
  action: string;
  symbol?: string | null;
  details?: unknown;
  result?: string | null;
  error?: string | null;
}

export interface ExecutorLogContext {
  accountId?: string | null;
  processId?: string | null;
  symbol?: string | null;
  action?: string;
  type?: string;
  result?: string | null;
}

export function createTradeProcessId(prefix: string = "process"): string {
  return `${prefix}_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function serializeProcessLogDetails(
  details: unknown,
): string | undefined {
  if (details === null || details === undefined) return undefined;
  if (typeof details === "string") return details;

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export async function logProcessStep({
  accountId,
  processId,
  type,
  action,
  symbol,
  details,
  result,
  error,
}: ProcessLogInput) {
  return createTradeLog({
    accountId: accountId || null,
    processId: processId || null,
    type,
    action,
    symbol: symbol || null,
    details: serializeProcessLogDetails(details) || null,
    result: result || null,
    error: error || null,
  });
}

async function logExecutorConsole(
  level: "info" | "warn" | "error",
  message: string,
  context: ExecutorLogContext = {},
) {
  if (level === "error") {
    console.error(message);
  } else if (level === "warn") {
    console.warn(message);
  } else {
    console.log(message);
  }

  await logProcessStep({
    accountId: context.accountId || undefined,
    processId: context.processId || undefined,
    type: context.type || (context.processId ? "draft_process" : "executor_console"),
    action:
      context.action ||
      (level === "error"
        ? "console_error"
        : level === "warn"
          ? "console_warn"
          : "console_info"),
    symbol: context.symbol || undefined,
    details: message,
    result:
      context.result ||
      (level === "error"
        ? "error"
        : level === "warn"
          ? "warning"
          : "info"),
    error: level === "error" ? message : undefined,
  });
}

export async function logExecutorInfo(
  message: string,
  context: ExecutorLogContext = {},
) {
  await logExecutorConsole("info", message, context);
}

export async function logExecutorWarn(
  message: string,
  context: ExecutorLogContext = {},
) {
  await logExecutorConsole("warn", message, context);
}

export async function logExecutorError(
  message: string,
  context: ExecutorLogContext = {},
) {
  await logExecutorConsole("error", message, context);
}
