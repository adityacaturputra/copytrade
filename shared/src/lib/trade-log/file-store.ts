import { appendFile, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { getAllLogsFilePath, getLogBaseDir, getProcessLogFilePath } from "./config";
import { parseJsonLines } from "./normalize";
import type { TradeLogRecord } from "./types";

export async function ensureLogDirs() {
  const baseDir = getLogBaseDir();
  await mkdir(baseDir, { recursive: true });
  await mkdir(path.join(baseDir, "processes"), { recursive: true });
}

export async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

export async function readJsonLinesFile(filePath: string): Promise<TradeLogRecord[]> {
  if (!(await fileExists(filePath))) return [];
  const content = await readFile(filePath, "utf8");
  return parseJsonLines(content);
}

export async function writeLogToFiles(record: TradeLogRecord) {
  await ensureLogDirs();
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(getAllLogsFilePath(), line, "utf8");
  if (record.processId) await appendFile(getProcessLogFilePath(record.processId), line, "utf8");
}

export async function readGlobalFileLogs() { return readJsonLinesFile(getAllLogsFilePath()); }
export async function readProcessFileLogs(processId: string) { return readJsonLinesFile(getProcessLogFilePath(processId)); }

export async function rewriteAllFileLogs(records: TradeLogRecord[]) {
  await ensureLogDirs();
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(getAllLogsFilePath(), content ? `${content}\n` : "", "utf8");

  const grouped = new Map<string, TradeLogRecord[]>();
  for (const record of records) {
    if (!record.processId) continue;
    const current = grouped.get(record.processId) || [];
    current.push(record);
    grouped.set(record.processId, current);
  }

  const processDir = path.join(getLogBaseDir(), "processes");
  await rm(processDir, { recursive: true, force: true });
  await mkdir(processDir, { recursive: true });

  for (const [processId, processRecords] of grouped.entries()) {
    const filePath = getProcessLogFilePath(processId);
    const lines = processRecords.map((record) => JSON.stringify(record)).join("\n");
    await writeFile(filePath, lines ? `${lines}\n` : "", "utf8");
  }
}
