import { createReadStream } from "fs";
import { applyLogFilters, dedupeLogs, isHiddenByDefaultTradeLog, isNoisyTradeLog, sortLogs, shouldHideCronNoise } from "./filters";
import { getAllLogsFilePath, getProcessLogFilePath, resolveRemoteBackendBaseUrl, resolveStorageMode, shouldReadMongoLegacy, shouldUseRemoteBackendApi, shouldWriteFile, shouldWriteMongo } from "./config";
import { ensureLogDirs, fileExists, readGlobalFileLogs, readJsonLinesFile, readProcessFileLogs, rewriteAllFileLogs, writeLogToFiles } from "./file-store";
import { normalizeTradeLogRecord } from "./normalize";
import { isMongoReady, loadDatabaseModule, readAllMongoLogs, readAllMongoLogsWithIds, readMongoLogsByProcess, writeLogToMongo } from "./mongo-store";
import { createInterface } from "readline";
import type { LogStorageMode, TradeLogCleanupOptions, TradeLogCleanupResult, TradeLogCreateInput, TradeLogListOptions, TradeLogListResult, TradeLogRecord } from "./types";

async function readFilteredGlobalFileLogsStreaming(options: TradeLogListOptions, maxScanLogs: number): Promise<{ logs: TradeLogRecord[]; truncated: boolean }> {
  if (process.env.VITEST === "true") {
    const normalizedOptions = options.accountId === "all" ? { ...options, accountId: undefined } : options;
    const allLogs = await readGlobalFileLogs();
    const filtered = applyLogFilters(allLogs, normalizedOptions);
    const truncated = filtered.length > maxScanLogs;
    return {
      logs: truncated ? filtered.slice(0, maxScanLogs) : filtered,
      truncated,
    };
  }

  const filePath = getAllLogsFilePath();
  const normalizedOptions = options.accountId === "all" ? { ...options, accountId: undefined } : options;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  const logs: TradeLogRecord[] = [];
  let truncated = false;

  try {
    for await (const line of reader) {
      if (!line) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const normalized = normalizeTradeLogRecord(parsed as TradeLogCreateInput & { _id?: string });
      const filtered = applyLogFilters([normalized], normalizedOptions);
      if (filtered.length === 0) continue;

      logs.push(filtered[0] as TradeLogRecord);
      if (logs.length > maxScanLogs) {
        truncated = true;
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return {
    logs: truncated ? logs.slice(0, maxScanLogs) : logs,
    truncated,
  };
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
  if (record.level == null) { delete (record as { level?: string | null }).level; }
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

  const processFilePath = getProcessLogFilePath(options.processId);
  let fileLogs: TradeLogRecord[] = [];
  try {
    const exists = await fileExists(processFilePath);
    fileLogs = exists ? await readJsonLinesFile(processFilePath) : [];
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== "ENOENT") throw error;
  }
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

    if (options.accountId && options.accountId !== "all") params.set("accountId", options.accountId);
    if (options.processId) params.set("processId", options.processId);
    if (options.symbol) params.set("symbol", options.symbol);
    if (options.levels?.length) params.set("levels", options.levels.join(","));

    return fetchRemoteLogs<TradeLogListResult>(`/api/logs?${params.toString()}`);
  }

  const page = Math.max(1, options.page || 1);
  const limit = Math.max(1, Math.min(500, options.limit || 50));
  const order = options.order || "desc";
  const maxScanLogs = Math.max(
    limit,
    Number.parseInt(process.env.PROCESS_LOG_MAX_SCAN || "20000", 10) || 20000,
  );
  const offset = (page - 1) * limit;
  const needed = offset + limit + 1;

  let fileLogs: TradeLogRecord[] = [];
  let truncated = false;
  try {
    const streamingResult = await readFilteredGlobalFileLogsStreaming(options, maxScanLogs);
    fileLogs = streamingResult.logs;
    truncated = streamingResult.truncated;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== "ENOENT") throw error;
  }
  const mongoLogs =
    shouldWriteMongo() || shouldReadMongoLegacy() ? await readAllMongoLogs() : [];
  const normalizedOptions = options.accountId === "all" ? { ...options, accountId: undefined } : options;
  const merged = dedupeLogs([...fileLogs, ...mongoLogs]);
  const filtered = applyLogFilters(merged, normalizedOptions);
  const sorted = sortLogs(filtered, order);

  const pageWindow = sorted.slice(offset, offset + limit);
  const hasMore = sorted.length > offset + limit || truncated;
  const totalCount = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return {
    logs: pageWindow,
    totalCount,
    page,
    limit,
    totalPages,
    hasMore,
    truncated,
  };
}

export async function countTradeLogs() {
  const result = await listTradeLogs({
    page: 1,
    limit: 1,
    hideCronNoise: false,
  });
  return result.totalCount;
}

export async function getRecentTradeLogs(limit: number = 50) {
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

  let fileLogs: TradeLogRecord[] = [];
  try {
    fileLogs = await readGlobalFileLogs();
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== "ENOENT") throw error;
  }
  const mongoLogsWithIds =
    shouldWriteMongo() || shouldReadMongoLegacy()
      ? await readAllMongoLogsWithIds()
      : [];
  const allLogs = dedupeLogs([
    ...fileLogs,
    ...mongoLogsWithIds.map(({ record }: { record: TradeLogRecord }) => record),
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
        .filter(({ record }: { record: TradeLogRecord }) => !shouldKeepLog(record))
        .map(({ rawId }: { rawId: unknown }) => rawId);

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

export { isHiddenByDefaultTradeLog, isNoisyTradeLog };
