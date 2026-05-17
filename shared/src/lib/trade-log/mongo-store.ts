import mongoose from "mongoose";
import type { TradeLogRecord } from "./types";
import { shouldReadMongoLegacy } from "./config";
import { normalizeMongoRecord } from "./normalize";
import { TradeLog } from "../database";

export async function loadDatabaseModule(): Promise<{ TradeLog: typeof TradeLog }> {
  return { TradeLog };
}

export function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

export async function writeLogToMongo(record: TradeLogRecord) {
  const payload: Record<string, unknown> = {
    accountId: record.accountId || null,
    processId: record.processId || null,
    type: record.type,
    action: record.action,
    symbol: record.symbol || null,
    details: record.details || null,
    result: record.result || null,
    error: record.error || null,
    createdAt: new Date(record.createdAt),
  };
  if (record.level != null) payload.level = record.level;
  await TradeLog.create(payload);
}

export async function readMongoLogsByProcess(processId: string, limit?: number, order: "asc" | "desc" = "asc"): Promise<TradeLogRecord[]> {
  if (!shouldReadMongoLegacy() || !isMongoReady()) return [];
  try {
    const logs = await TradeLog.find({ processId }).sort({ createdAt: order === "asc" ? 1 : -1 }).limit(limit || 1000).lean().exec();
    return logs.map((item: unknown) => normalizeMongoRecord(item as Record<string, unknown>));
  } catch (error) {
    console.warn(`[TradeLogStore] Failed to read Mongo process logs for ${processId}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export async function readAllMongoLogs(): Promise<TradeLogRecord[]> {
  if (!shouldReadMongoLegacy() || !isMongoReady()) return [];
  try {
    const logs = await TradeLog.find().sort({ createdAt: 1 }).lean().exec();
    return logs.map((item: unknown) => normalizeMongoRecord(item as Record<string, unknown>));
  } catch (error) {
    console.warn(`[TradeLogStore] Failed to read Mongo logs: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export async function readAllMongoLogsWithIds(): Promise<Array<{ rawId: unknown; record: TradeLogRecord }>> {
  if (!shouldReadMongoLegacy() || !isMongoReady()) return [];
  try {
    const logs = await TradeLog.find().sort({ createdAt: 1 }).lean().exec();
    return logs.map((item: unknown) => ({ rawId: (item as Record<string, unknown>)._id, record: normalizeMongoRecord(item as Record<string, unknown>) }));
  } catch (error) {
    console.warn(`[TradeLogStore] Failed to read Mongo logs: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
