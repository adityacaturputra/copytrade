import { randomUUID } from "crypto";
import type { TradeLogCreateInput, TradeLogRecord } from "./types";

export function normalizeCreatedAt(value?: string | Date) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function normalizeTradeLogRecord(
  input: TradeLogCreateInput & { _id?: string },
): TradeLogRecord {
  return {
    _id: input._id || `tlog_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    accountId: input.accountId || null,
    processId: input.processId || null,
    type: input.type,
    action: input.action,
    symbol: input.symbol || null,
    details: input.details || null,
    level: input.level || null,
    result: input.result || null,
    error: input.error || null,
    createdAt: normalizeCreatedAt(input.createdAt),
  };
}

export function parseJsonLines(content: string): TradeLogRecord[] {
  if (!content.trim()) return [];
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as TradeLogRecord;
      } catch {
        return null;
      }
    })
    .filter((item): item is TradeLogRecord => Boolean(item));
}

export function normalizeMongoRecord(record: Record<string, unknown>): TradeLogRecord {
  const rawId = record._id;
  const mongoId =
    typeof rawId === "string"
      ? rawId
      : rawId && typeof (rawId as { toString?: () => string }).toString === "function"
        ? (rawId as { toString: () => string }).toString()
        : `mongo_${randomUUID().replace(/-/g, "")}`;

  const createdAt =
    record.createdAt instanceof Date
      ? record.createdAt.toISOString()
      : record.createdAt
        ? new Date(String(record.createdAt)).toISOString()
        : new Date().toISOString();

  return {
    _id: mongoId,
    accountId: record.accountId == null ? null : String(record.accountId),
    processId: record.processId == null ? null : String(record.processId),
    type: String(record.type || ""),
    action: String(record.action || ""),
    symbol: record.symbol == null ? null : String(record.symbol),
    details: record.details == null ? null : String(record.details),
    level: record.level == null ? null : String(record.level),
    result: record.result == null ? null : String(record.result),
    error: record.error == null ? null : String(record.error),
    createdAt,
  };
}
