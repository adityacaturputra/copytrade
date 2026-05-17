import path from "path";
import type { LogStorageMode } from "./types";

export function isBackendRuntime() {
  return process.env.COPYTRADE_RUNTIME === "backend";
}

export function resolveRemoteBackendBaseUrl() {
  const rawUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
  const trimmed = String(rawUrl || "").trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

export function shouldUseRemoteBackendApi() {
  if (isBackendRuntime()) return false;
  if (!resolveRemoteBackendBaseUrl()) return false;
  return Boolean(process.env.NEXT_RUNTIME || process.env.VERCEL);
}

export function resolveStorageMode(): LogStorageMode {
  const rawMode = String(process.env.PROCESS_LOG_STORAGE || "file").trim().toLowerCase();
  if (rawMode === "mongo" || rawMode === "dual" || rawMode === "file") {
    return rawMode;
  }
  return "file";
}

export function shouldWriteFile() {
  const mode = resolveStorageMode();
  return mode === "file" || mode === "dual";
}

export function shouldWriteMongo() {
  const mode = resolveStorageMode();
  return mode === "mongo" || mode === "dual";
}

export function shouldReadMongoLegacy() {
  return String(process.env.PROCESS_LOG_INCLUDE_MONGO_LEGACY ?? "true")
    .trim()
    .toLowerCase() !== "false";
}

export function getLogBaseDir() {
  return process.env.PROCESS_LOG_DIR?.trim()
    ? path.resolve(process.env.PROCESS_LOG_DIR)
    : path.join(process.cwd(), "data", "process-logs");
}

export function getAllLogsFilePath() {
  return path.join(getLogBaseDir(), "all.jsonl");
}

export function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getProcessLogFilePath(processId: string) {
  return path.join(getLogBaseDir(), "processes", `${sanitizeFileName(processId)}.jsonl`);
}
