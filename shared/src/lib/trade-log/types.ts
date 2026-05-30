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
  symbol?: string | null;
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
  hasMore?: boolean;
  truncated?: boolean;
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

export type LogStorageMode = "file" | "mongo" | "dual";
