import { mkdir, appendFile, readFile, stat, writeFile, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import mongoose from "mongoose";

export interface TradeLogRecord {
  _id: string;
  accountId?: string | null;
  processId?: string | null;
  type: string;
  action: string;
  symbol?: string | null;
  details?: string | null;
  level?: string | null;
  result?: string | null;
  error?: string | null;
  createdAt: string;
}

export interface TradeLogCreateInput {
  accountId?: string | null;
  processId?: string | null;
  type: string;
  action: string;
  symbol?: string | null;
  details?: string | null;
  level?: string | null;
  result?: string | null;
  error?: string | null;
  createdAt?: string | Date;
}

export interface TradeLogListOptions {
  page?: number;
  limit?: number;
  accountId?: string | null;
  processId?: string | null;
  levels?: string[] | null;
  hideCronNoise?: boolean;
  order?: "asc" | "desc";
}

export interface TradeLogListResult {
  logs: TradeLogRecord[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TradeLogCleanupOptions {
  mode: "noisy-json" | "retention";
  keepDays?: number;
}

export interface TradeLogCleanupResult {
  mode: "noisy-json" | "retention";
  keepDays?: number;
  scannedCount: number;
  deletedCount: number;
  remainingCount: number;
  deletedFileCount: number;
  deletedMongoCount: number;
}

type LogStorageMode = "file" | "mongo" | "dual";

function isBackendRuntime() {
  return process.env.COPYTRADE_RUNTIME === "backend";
}

function shouldUseRemoteBackendApi() {
  if (isBackendRuntime()) return false;
  if (!resolveRemoteBackendBaseUrl()) return false;

  return Boolean(process.env.NEXT_RUNTIME || process.env.VERCEL);
}

function resolveRemoteBackendBaseUrl() {
  const rawUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  const trimmed = String(rawUrl || "").trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

async function fetchRemoteLogs<T>(
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = resolveRemoteBackendBaseUrl() as string;

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    success?: boolean;
    error?: string;
    data?: T;
  };

  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Remote log request failed: ${response.status}`);
  }

  return (payload.data as T) ?? (payload as unknown as T);
}

function resolveStorageMode(): LogStorageMode {
  const rawMode = String(process.env.PROCESS_LOG_STORAGE || "file")
    .trim()
    .toLowerCase();

  if (rawMode === "mongo" || rawMode === "dual" || rawMode === "file") {
    return rawMode;
  }

  return "file";
}

function shouldWriteFile() {
  const mode = resolveStorageMode();
  return mode === "file" || mode === "dual";
}

function shouldWriteMongo() {
  const mode = resolveStorageMode();
  return mode === "mongo" || mode === "dual";
}

function shouldReadMongoLegacy() {
  return String(process.env.PROCESS_LOG_INCLUDE_MONGO_LEGACY ?? "true")
    .trim()
    .toLowerCase() !== "false";
}

function getLogBaseDir() {
  return process.env.PROCESS_LOG_DIR?.trim()
    ? path.resolve(process.env.PROCESS_LOG_DIR)
    : path.join(process.cwd(), "data", "process-logs");
}

function getAllLogsFilePath() {
  return path.join(getLogBaseDir(), "all.jsonl");
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getProcessLogFilePath(processId: string) {
  return path.join(
    getLogBaseDir(),
    "processes",
    `${sanitizeFileName(processId)}.jsonl`,
  );
}

async function ensureLogDirs() {
  const baseDir = getLogBaseDir();
  await mkdir(baseDir, { recursive: true });
  await mkdir(path.join(baseDir, "processes"), { recursive: true });
}

function normalizeCreatedAt(value?: string | Date) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeTradeLogRecord(
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
    level: input.level || input.result || null,
    result: input.result || null,
    error: input.error || null,
    createdAt: normalizeCreatedAt(input.createdAt),
  };
}

function parseJsonLines(content: string): TradeLogRecord[] {
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

async function readJsonLinesFile(filePath: string): Promise<TradeLogRecord[]> {
  try {
    const content = await readFile(filePath, "utf8");
    return parseJsonLines(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeLogToFiles(record: TradeLogRecord) {
  await ensureLogDirs();

  const serialized = `${JSON.stringify(record)}\n`;
  await appendFile(getAllLogsFilePath(), serialized, "utf8");

  if (record.processId) {
    await appendFile(getProcessLogFilePath(record.processId), serialized, "utf8");
  }
}

async function writeLogToMongo(record: TradeLogRecord) {
  const { TradeLog } = await loadDatabaseModule();

  await TradeLog.create({
    accountId: record.accountId || null,
    processId: record.processId || null,
    type: record.type,
    action: record.action,
    symbol: record.symbol || null,
    details: record.details || null,
    level: record.level || null,
    result: record.result || null,
    error: record.error || null,
    createdAt: new Date(record.createdAt),
  });
}

function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

async function loadDatabaseModule(): Promise<typeof import("./database")> {
  return require("./database") as typeof import("./database");
}

function normalizeMongoRecord(record: Record<string, unknown>): TradeLogRecord {
  const mongoId =
    typeof record._id === "string"
      ? record._id
      : record._id && typeof (record._id as { toString?: () => string }).toString === "function"
        ? (record._id as { toString: () => string }).toString()
        : `mongo_${randomUUID().replace(/-/g, "")}`;

  const createdAt =
    record.createdAt instanceof Date
      ? record.createdAt.toISOString()
      : record.createdAt
        ? new Date(String(record.createdAt)).toISOString()
        : new Date().toISOString();

  return {
    _id: mongoId,
    accountId:
      typeof record.accountId === "string" ? record.accountId : record.accountId == null ? null : String(record.accountId),
    processId:
      typeof record.processId === "string" ? record.processId : record.processId == null ? null : String(record.processId),
    type: String(record.type || ""),
    action: String(record.action || ""),
    symbol:
      typeof record.symbol === "string" ? record.symbol : record.symbol == null ? null : String(record.symbol),
    details:
      typeof record.details === "string" ? record.details : record.details == null ? null : String(record.details),
    level:
      typeof record.level === "string" ? record.level : record.level == null ? null : String(record.level),
    result:
      typeof record.result === "string" ? record.result : record.result == null ? null : String(record.result),
    error:
      typeof record.error === "string" ? record.error : record.error == null ? null : String(record.error),
    createdAt,
  };
}

async function readMongoLogsByProcess(
  processId: string,
  limit?: number,
  order: "asc" | "desc" = "asc",
): Promise<TradeLogRecord[]> {
  if (!shouldReadMongoLegacy() || !isMongoReady()) return [];

  const { TradeLog } = await loadDatabaseModule();
  try {
    const logs = await TradeLog.find({ processId })
      .sort({ createdAt: order === "asc" ? 1 : -1 })
      .limit(limit || 1000)
      .lean()
      .exec();

    return logs.map((item: unknown) =>
      normalizeMongoRecord(item as Record<string, unknown>),
    );
  } catch (error) {
    console.warn(
      `[TradeLogStore] Failed to read Mongo process logs for ${processId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

async function readAllMongoLogs(): Promise<TradeLogRecord[]> {
  if (!shouldReadMongoLegacy() || !isMongoReady()) return [];

  const { TradeLog } = await loadDatabaseModule();
  try {
    const logs = await TradeLog.find().sort({ createdAt: 1 }).lean().exec();
    return logs.map((item: unknown) =>
      normalizeMongoRecord(item as Record<string, unknown>),
    );
  } catch (error) {
    console.warn(
      `[TradeLogStore] Failed to read Mongo logs: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

function dedupeLogs(logs: TradeLogRecord[]) {
  const seen = new Set<string>();
  const deduped: TradeLogRecord[] = [];

  for (const log of logs) {
    const key = [
      log.accountId || "",
      log.processId || "",
      log.type,
      log.action,
      log.symbol || "",
      log.details || "",
      log.level || "",
      log.result || "",
      log.error || "",
      log.createdAt,
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(log);
  }

  return deduped;
}

function shouldHideCronNoise(log: TradeLogRecord) {
  return log.type === "cron" && /(_start|_end)$/.test(log.action);
}

function looksLikeStructuredJson(value: string | null | undefined) {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (
    !trimmed ||
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

export function isNoisyTradeLog(log: TradeLogRecord) {
  return (
    shouldHideCronNoise(log) ||
    looksLikeStructuredJson(log.details) ||
    looksLikeStructuredJson(log.result) ||
    looksLikeStructuredJson(log.error)
  );
}

export function isHiddenByDefaultTradeLog(log: TradeLogRecord) {
  return log.level === "debug" || shouldHideCronNoise(log);
}

function applyLogFilters(
  logs: TradeLogRecord[],
  options: TradeLogListOptions = {},
) {
  return logs.filter((log) => {
    if (options.accountId && options.accountId !== "all" && log.accountId !== options.accountId) {
      return false;
    }

    if (options.processId && log.processId !== options.processId) {
      return false;
    }

    if (options.levels?.length) {
      const matchLevel = (log.level || log.result || "").toLowerCase();
      if (!options.levels.map(l => l.toLowerCase()).includes(matchLevel)) {
        return false;
      }
    }

    if (options.hideCronNoise && isHiddenByDefaultTradeLog(log)) {
      return false;
    }

    return true;
  });
}

function sortLogs(logs: TradeLogRecord[], order: "asc" | "desc" = "desc") {
  return [...logs].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return order === "asc" ? leftTime - rightTime : rightTime - leftTime;
  });
}

async function readGlobalFileLogs() {
  return readJsonLinesFile(getAllLogsFilePath());
}

async function readProcessFileLogs(processId: string) {
  const filePath = getProcessLogFilePath(processId);
  if (!(await fileExists(filePath))) return [];
  return readJsonLinesFile(filePath);
}

async function rewriteAllFileLogs(records: TradeLogRecord[]) {
  await ensureLogDirs();

  const allLogsContent = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(
    getAllLogsFilePath(),
    allLogsContent ? `${allLogsContent}\n` : "",
    "utf8",
  );

  const processesDir = path.join(getLogBaseDir(), "processes");
  await rm(processesDir, { recursive: true, force: true });
  await mkdir(processesDir, { recursive: true });

  const processLogs = new Map<string, string[]>();
  for (const record of records) {
    if (!record.processId) continue;
    const serialized = JSON.stringify(record);
    const existing = processLogs.get(record.processId) || [];
    existing.push(serialized);
    processLogs.set(record.processId, existing);
  }

  for (const [processId, serializedLogs] of processLogs.entries()) {
    await writeFile(
      getProcessLogFilePath(processId),
      `${serializedLogs.join("\n")}\n`,
      "utf8",
    );
  }
}

async function readAllMongoLogsWithIds(): Promise<
  Array<{ rawId: unknown; record: TradeLogRecord }>
> {
  if (!shouldReadMongoLegacy() || !isMongoReady()) return [];

  const { TradeLog } = await loadDatabaseModule();
  try {
    const logs = await TradeLog.find().sort({ createdAt: 1 }).lean().exec();
    return logs.map((item: unknown) => ({
      rawId: (item as Record<string, unknown>)._id,
      record: normalizeMongoRecord(item as Record<string, unknown>),
    }));
  } catch (error) {
    console.warn(
      `[TradeLogStore] Failed to read Mongo logs: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}

export async function createTradeLog(
  input: TradeLogCreateInput,
): Promise<TradeLogRecord> {
  if (shouldUseRemoteBackendApi()) {
    return fetchRemoteLogs<TradeLogRecord>("/api/logs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  const record = normalizeTradeLogRecord(input);
  let fileWriteError: Error | null = null;
  let mongoWriteError: Error | null = null;

  if (shouldWriteFile()) {
    try {
      await writeLogToFiles(record);
    } catch (error) {
      fileWriteError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  if (shouldWriteMongo()) {
    try {
      if (isMongoReady()) {
        await writeLogToMongo(record);
      } else {
        mongoWriteError = new Error("MongoDB connection is not ready");
      }
    } catch (error) {
      mongoWriteError =
        error instanceof Error ? error : new Error(String(error));
    }
  }

  if (fileWriteError && !shouldWriteMongo()) {
    throw fileWriteError;
  }

  if (mongoWriteError && !shouldWriteFile()) {
    throw mongoWriteError;
  }

  if (fileWriteError && mongoWriteError) {
    throw fileWriteError;
  }

  if (fileWriteError) {
    console.warn(`[TradeLogStore] File log write failed: ${fileWriteError.message}`);
  }

  if (mongoWriteError) {
    console.warn(`[TradeLogStore] Mongo log write failed: ${mongoWriteError.message}`);
  }

  return record;
}

export async function getProcessTradeLogs(options: {
  processId: string;
  limit?: number;
  order?: "asc" | "desc";
}) {
  if (shouldUseRemoteBackendApi()) {
    const params = new URLSearchParams({
      processId: options.processId,
      hideCronNoise: "false",
      order: options.order || "asc",
    });
    if (typeof options.limit === "number") {
      params.set("limit", String(options.limit));
    }

    const response = await fetchRemoteLogs<TradeLogListResult>(
      `/api/logs?${params.toString()}`,
    );
    return response.logs;
  }

  const fileLogs = await readProcessFileLogs(options.processId);
  const mongoLogs =
    shouldWriteMongo() || shouldReadMongoLegacy()
      ? await readMongoLogsByProcess(
          options.processId,
          options.limit,
          options.order || "asc",
        )
      : [];

  const logs = sortLogs(
    dedupeLogs([...fileLogs, ...mongoLogs]),
    options.order || "asc",
  );

  return typeof options.limit === "number" ? logs.slice(0, options.limit) : logs;
}

export async function listTradeLogs(
  options: TradeLogListOptions = {},
): Promise<TradeLogListResult> {
  if (shouldUseRemoteBackendApi()) {
    const params = new URLSearchParams({
      page: String(Math.max(1, options.page || 1)),
      limit: String(Math.max(1, Math.min(500, options.limit || 50))),
      hideCronNoise: String(options.hideCronNoise !== false),
      order: options.order || "desc",
    });

    if (options.accountId) params.set("accountId", options.accountId);
    if (options.processId) params.set("processId", options.processId);
    if (options.levels?.length) params.set("levels", options.levels.join(","));

    return fetchRemoteLogs<TradeLogListResult>(`/api/logs?${params.toString()}`);
  }

  const page = Math.max(1, options.page || 1);
  const limit = Math.max(1, Math.min(500, options.limit || 50));
  const order = options.order || "desc";

  const fileLogs = await readGlobalFileLogs();
  const mongoLogs =
    shouldWriteMongo() || shouldReadMongoLegacy() ? await readAllMongoLogs() : [];
  const filtered = applyLogFilters(
    dedupeLogs([...fileLogs, ...mongoLogs]),
    options,
  );
  const sorted = sortLogs(filtered, order);

  const totalCount = sorted.length;
  const totalPages = Math.ceil(totalCount / limit);
  const pagedLogs = sorted.slice((page - 1) * limit, page * limit);

  return {
    logs: pagedLogs,
    totalCount,
    page,
    limit,
    totalPages,
  };
}

export async function countTradeLogs() {
  if (shouldUseRemoteBackendApi()) {
    const result = await listTradeLogs({
      page: 1,
      limit: 1,
      hideCronNoise: false,
    });
    return result.totalCount;
  }

  const result = await listTradeLogs({
    page: 1,
    limit: 1,
    hideCronNoise: false,
  });
  return result.totalCount;
}

export async function getRecentTradeLogs(limit: number = 50) {
  if (shouldUseRemoteBackendApi()) {
    const result = await listTradeLogs({
      page: 1,
      limit,
      hideCronNoise: false,
      order: "desc",
    });
    return result.logs;
  }

  const result = await listTradeLogs({
    page: 1,
    limit,
    hideCronNoise: false,
    order: "desc",
  });
  return result.logs;
}

export async function cleanupTradeLogs(
  options: TradeLogCleanupOptions,
): Promise<TradeLogCleanupResult> {
  if (options.mode === "retention") {
    const keepDays = Math.floor(options.keepDays || 0);
    if (!Number.isFinite(keepDays) || keepDays < 1) {
      throw new Error("keepDays must be >= 1 for retention cleanup");
    }
  }

  const now = Date.now();
  const retentionCutoff =
    options.mode === "retention"
      ? now - Math.floor((options.keepDays as number) * 24 * 60 * 60 * 1000)
      : null;

  const shouldKeepLog = (log: TradeLogRecord) => {
    if (options.mode === "noisy-json") {
      return !isNoisyTradeLog(log);
    }

    return new Date(log.createdAt).getTime() >= (retentionCutoff as number);
  };

  const fileLogs = await readGlobalFileLogs();
  const mongoLogsWithIds =
    shouldWriteMongo() || shouldReadMongoLegacy()
      ? await readAllMongoLogsWithIds()
      : [];
  const allLogs = dedupeLogs([
    ...fileLogs,
    ...mongoLogsWithIds.map(({ record }) => record),
  ]);
  const scannedCount = allLogs.length;

  const retainedFileLogs = fileLogs.filter(shouldKeepLog);
  const deletedFileCount = shouldWriteFile()
    ? fileLogs.length - retainedFileLogs.length
    : 0;

  if (shouldWriteFile()) {
    await rewriteAllFileLogs(retainedFileLogs);
  }

  let deletedMongoCount = 0;
  if (shouldWriteMongo() || shouldReadMongoLegacy()) {
    if (isMongoReady()) {
      const { TradeLog } = await loadDatabaseModule();
      const mongoIdsToDelete = mongoLogsWithIds
        .filter(({ record }) => !shouldKeepLog(record))
        .map(({ rawId }) => rawId);

      deletedMongoCount = mongoIdsToDelete.length;
      if (mongoIdsToDelete.length > 0) {
        await TradeLog.deleteMany({ _id: { $in: mongoIdsToDelete } });
      }
    } else if (shouldWriteMongo()) {
      throw new Error("MongoDB connection is not ready");
    }
  }

  const deletedCount = deletedFileCount + deletedMongoCount;
  const remainingCount = Math.max(0, scannedCount - deletedCount);

  return {
    mode: options.mode,
    keepDays: options.mode === "retention" ? Math.floor(options.keepDays as number) : undefined,
    scannedCount,
    deletedCount,
    remainingCount,
    deletedFileCount,
    deletedMongoCount,
  };
}
