"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHiddenByDefaultTradeLog = isHiddenByDefaultTradeLog;
exports.isNoisyTradeLog = isNoisyTradeLog;
exports.createTradeLog = createTradeLog;
exports.getProcessTradeLogs = getProcessTradeLogs;
exports.listTradeLogs = listTradeLogs;
exports.countTradeLogs = countTradeLogs;
exports.getRecentTradeLogs = getRecentTradeLogs;
exports.cleanupTradeLogs = cleanupTradeLogs;
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const mongoose_1 = __importDefault(require("mongoose"));
function isBackendRuntime() {
    return process.env.COPYTRADE_RUNTIME === "backend";
}
function shouldUseRemoteBackendApi() {
    if (isBackendRuntime())
        return false;
    if (!resolveRemoteBackendBaseUrl())
        return false;
    return Boolean(process.env.NEXT_RUNTIME || process.env.VERCEL);
}
function resolveRemoteBackendBaseUrl() {
    const rawUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
    const trimmed = String(rawUrl || "").trim();
    return trimmed ? trimmed.replace(/\/+$/, "") : null;
}
async function fetchRemoteLogs(pathname, init) {
    const baseUrl = resolveRemoteBackendBaseUrl();
    const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
        },
        cache: "no-store",
    });
    const payload = (await response.json());
    if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `Remote log request failed: ${response.status}`);
    }
    return payload.data ?? payload;
}
function resolveStorageMode() {
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
        ? path_1.default.resolve(process.env.PROCESS_LOG_DIR)
        : path_1.default.join(process.cwd(), "data", "process-logs");
}
function getAllLogsFilePath() {
    return path_1.default.join(getLogBaseDir(), "all.jsonl");
}
function sanitizeFileName(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function getProcessLogFilePath(processId) {
    return path_1.default.join(getLogBaseDir(), "processes", `${sanitizeFileName(processId)}.jsonl`);
}
async function ensureLogDirs() {
    const baseDir = getLogBaseDir();
    await (0, promises_1.mkdir)(baseDir, { recursive: true });
    await (0, promises_1.mkdir)(path_1.default.join(baseDir, "processes"), { recursive: true });
}
function normalizeCreatedAt(value) {
    if (!value)
        return new Date().toISOString();
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
function normalizeTradeLogRecord(input) {
    return {
        _id: input._id || `tlog_${Date.now()}_${(0, crypto_1.randomUUID)().replace(/-/g, "").slice(0, 12)}`,
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
function parseJsonLines(content) {
    if (!content.trim())
        return [];
    return content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    })
        .filter((item) => Boolean(item));
}
async function readJsonLinesFile(filePath) {
    try {
        const content = await (0, promises_1.readFile)(filePath, "utf8");
        return parseJsonLines(content);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
async function fileExists(filePath) {
    try {
        await (0, promises_1.stat)(filePath);
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
async function writeLogToFiles(record) {
    await ensureLogDirs();
    const serialized = `${JSON.stringify(record)}\n`;
    await (0, promises_1.appendFile)(getAllLogsFilePath(), serialized, "utf8");
    if (record.processId) {
        await (0, promises_1.appendFile)(getProcessLogFilePath(record.processId), serialized, "utf8");
    }
}
async function writeLogToMongo(record) {
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
    return mongoose_1.default.connection.readyState === 1;
}
async function loadDatabaseModule() {
    return import("./database");
}
function normalizeMongoRecord(record) {
    const mongoId = typeof record._id === "string"
        ? record._id
        : record._id && typeof record._id.toString === "function"
            ? record._id.toString()
            : `mongo_${(0, crypto_1.randomUUID)().replace(/-/g, "")}`;
    const createdAt = record.createdAt instanceof Date
        ? record.createdAt.toISOString()
        : record.createdAt
            ? new Date(String(record.createdAt)).toISOString()
            : new Date().toISOString();
    return {
        _id: mongoId,
        accountId: typeof record.accountId === "string" ? record.accountId : record.accountId == null ? null : String(record.accountId),
        processId: typeof record.processId === "string" ? record.processId : record.processId == null ? null : String(record.processId),
        type: String(record.type || ""),
        action: String(record.action || ""),
        symbol: typeof record.symbol === "string" ? record.symbol : record.symbol == null ? null : String(record.symbol),
        details: typeof record.details === "string" ? record.details : record.details == null ? null : String(record.details),
        level: typeof record.level === "string" ? record.level : record.level == null ? null : String(record.level),
        result: typeof record.result === "string" ? record.result : record.result == null ? null : String(record.result),
        error: typeof record.error === "string" ? record.error : record.error == null ? null : String(record.error),
        createdAt,
    };
}
async function readMongoLogsByProcess(processId, limit, order = "asc") {
    if (!shouldReadMongoLegacy() || !isMongoReady())
        return [];
    const { TradeLog } = await loadDatabaseModule();
    try {
        const logs = await TradeLog.find({ processId })
            .sort({ createdAt: order === "asc" ? 1 : -1 })
            .limit(limit || 1000)
            .lean()
            .exec();
        return logs.map((item) => normalizeMongoRecord(item));
    }
    catch (error) {
        console.warn(`[TradeLogStore] Failed to read Mongo process logs for ${processId}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}
async function readAllMongoLogs() {
    if (!shouldReadMongoLegacy() || !isMongoReady())
        return [];
    const { TradeLog } = await loadDatabaseModule();
    try {
        const logs = await TradeLog.find().sort({ createdAt: 1 }).lean().exec();
        return logs.map((item) => normalizeMongoRecord(item));
    }
    catch (error) {
        console.warn(`[TradeLogStore] Failed to read Mongo logs: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}
function dedupeLogs(logs) {
    const seen = new Set();
    const deduped = [];
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
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push(log);
    }
    return deduped;
}
function shouldHideCronNoise(log) {
    return log.type === "cron" && /(_start|_end)$/.test(log.action);
}
function looksLikeStructuredJson(value) {
    if (typeof value !== "string")
        return false;
    const trimmed = value.trim();
    if (!trimmed ||
        !((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]")))) {
        return false;
    }
    try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === "object" && parsed !== null;
    }
    catch {
        return false;
    }
}
function isNoisyTradeLog(log) {
    return (shouldHideCronNoise(log) ||
        looksLikeStructuredJson(log.details) ||
        looksLikeStructuredJson(log.result) ||
        looksLikeStructuredJson(log.error));
}
function isHiddenByDefaultTradeLog(log) {
    return log.level === "debug" || shouldHideCronNoise(log);
}
function applyLogFilters(logs, options = {}) {
    return logs.filter((log) => {
        if (options.accountId && options.accountId !== "all" && log.accountId !== options.accountId) {
            return false;
        }
        if (options.processId && log.processId !== options.processId) {
            return false;
        }
        if (options.levels?.length && !options.levels.includes(log.level || "")) {
            return false;
        }
        if (options.hideCronNoise && isHiddenByDefaultTradeLog(log)) {
            return false;
        }
        return true;
    });
}
function sortLogs(logs, order = "desc") {
    return [...logs].sort((left, right) => {
        const leftTime = new Date(left.createdAt).getTime();
        const rightTime = new Date(right.createdAt).getTime();
        return order === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
}
async function readGlobalFileLogs() {
    return readJsonLinesFile(getAllLogsFilePath());
}
async function readProcessFileLogs(processId) {
    const filePath = getProcessLogFilePath(processId);
    if (!(await fileExists(filePath)))
        return [];
    return readJsonLinesFile(filePath);
}
async function rewriteAllFileLogs(records) {
    await ensureLogDirs();
    const allLogsContent = records.map((record) => JSON.stringify(record)).join("\n");
    await (0, promises_1.writeFile)(getAllLogsFilePath(), allLogsContent ? `${allLogsContent}\n` : "", "utf8");
    const processesDir = path_1.default.join(getLogBaseDir(), "processes");
    await (0, promises_1.rm)(processesDir, { recursive: true, force: true });
    await (0, promises_1.mkdir)(processesDir, { recursive: true });
    const processLogs = new Map();
    for (const record of records) {
        if (!record.processId)
            continue;
        const serialized = JSON.stringify(record);
        const existing = processLogs.get(record.processId) || [];
        existing.push(serialized);
        processLogs.set(record.processId, existing);
    }
    for (const [processId, serializedLogs] of processLogs.entries()) {
        await (0, promises_1.writeFile)(getProcessLogFilePath(processId), `${serializedLogs.join("\n")}\n`, "utf8");
    }
}
async function readAllMongoLogsWithIds() {
    if (!shouldReadMongoLegacy() || !isMongoReady())
        return [];
    const { TradeLog } = await loadDatabaseModule();
    try {
        const logs = await TradeLog.find().sort({ createdAt: 1 }).lean().exec();
        return logs.map((item) => ({
            rawId: item._id,
            record: normalizeMongoRecord(item),
        }));
    }
    catch (error) {
        console.warn(`[TradeLogStore] Failed to read Mongo logs: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}
async function createTradeLog(input) {
    if (shouldUseRemoteBackendApi()) {
        return fetchRemoteLogs("/api/logs", {
            method: "POST",
            body: JSON.stringify(input),
        });
    }
    const record = normalizeTradeLogRecord(input);
    let fileWriteError = null;
    let mongoWriteError = null;
    if (shouldWriteFile()) {
        try {
            await writeLogToFiles(record);
        }
        catch (error) {
            fileWriteError =
                error instanceof Error ? error : new Error(String(error));
        }
    }
    if (shouldWriteMongo()) {
        try {
            if (isMongoReady()) {
                await writeLogToMongo(record);
            }
            else {
                mongoWriteError = new Error("MongoDB connection is not ready");
            }
        }
        catch (error) {
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
async function getProcessTradeLogs(options) {
    if (shouldUseRemoteBackendApi()) {
        const params = new URLSearchParams({
            processId: options.processId,
            hideCronNoise: "false",
            order: options.order || "asc",
        });
        if (typeof options.limit === "number") {
            params.set("limit", String(options.limit));
        }
        const response = await fetchRemoteLogs(`/api/logs?${params.toString()}`);
        return response.logs;
    }
    const fileLogs = await readProcessFileLogs(options.processId);
    const mongoLogs = shouldWriteMongo() || shouldReadMongoLegacy()
        ? await readMongoLogsByProcess(options.processId, options.limit, options.order || "asc")
        : [];
    const logs = sortLogs(dedupeLogs([...fileLogs, ...mongoLogs]), options.order || "asc");
    return typeof options.limit === "number" ? logs.slice(0, options.limit) : logs;
}
async function listTradeLogs(options = {}) {
    if (shouldUseRemoteBackendApi()) {
        const params = new URLSearchParams({
            page: String(Math.max(1, options.page || 1)),
            limit: String(Math.max(1, Math.min(500, options.limit || 50))),
            hideCronNoise: String(options.hideCronNoise !== false),
            order: options.order || "desc",
        });
        if (options.accountId)
            params.set("accountId", options.accountId);
        if (options.processId)
            params.set("processId", options.processId);
        if (options.levels?.length)
            params.set("levels", options.levels.join(","));
        return fetchRemoteLogs(`/api/logs?${params.toString()}`);
    }
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(500, options.limit || 50));
    const order = options.order || "desc";
    const fileLogs = await readGlobalFileLogs();
    const mongoLogs = shouldWriteMongo() || shouldReadMongoLegacy() ? await readAllMongoLogs() : [];
    const filtered = applyLogFilters(dedupeLogs([...fileLogs, ...mongoLogs]), options);
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
async function countTradeLogs() {
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
async function getRecentTradeLogs(limit = 50) {
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
async function cleanupTradeLogs(options) {
    if (options.mode === "retention") {
        const keepDays = Math.floor(options.keepDays || 0);
        if (!Number.isFinite(keepDays) || keepDays < 1) {
            throw new Error("keepDays must be >= 1 for retention cleanup");
        }
    }
    const now = Date.now();
    const retentionCutoff = options.mode === "retention"
        ? now - Math.floor(options.keepDays * 24 * 60 * 60 * 1000)
        : null;
    const shouldKeepLog = (log) => {
        if (options.mode === "noisy-json") {
            return !isNoisyTradeLog(log);
        }
        return new Date(log.createdAt).getTime() >= retentionCutoff;
    };
    const fileLogs = await readGlobalFileLogs();
    const mongoLogsWithIds = shouldWriteMongo() || shouldReadMongoLegacy()
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
        }
        else if (shouldWriteMongo()) {
            throw new Error("MongoDB connection is not ready");
        }
    }
    const deletedCount = deletedFileCount + deletedMongoCount;
    const remainingCount = Math.max(0, scannedCount - deletedCount);
    return {
        mode: options.mode,
        keepDays: options.mode === "retention" ? Math.floor(options.keepDays) : undefined,
        scannedCount,
        deletedCount,
        remainingCount,
        deletedFileCount,
        deletedMongoCount,
    };
}
//# sourceMappingURL=trade-log-store.js.map
