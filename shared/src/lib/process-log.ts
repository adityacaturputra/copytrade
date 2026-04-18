import { randomUUID } from "crypto";
import { TradeLog } from "./database";

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
  return TradeLog.create({
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
