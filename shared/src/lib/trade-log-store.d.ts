export interface TradeLogRecord {
    _id: string;
    accountId?: string | null;
    processId?: string | null;
    type: string;
    action: string;
    symbol?: string | null;
    details?: string | null;
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
    result?: string | null;
    error?: string | null;
    createdAt?: string | Date;
}
export interface TradeLogListOptions {
    page?: number;
    limit?: number;
    accountId?: string | null;
    processId?: string | null;
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
export declare function isNoisyTradeLog(log: TradeLogRecord): boolean;
export declare function createTradeLog(input: TradeLogCreateInput): Promise<TradeLogRecord>;
export declare function getProcessTradeLogs(options: {
    processId: string;
    limit?: number;
    order?: "asc" | "desc";
}): Promise<TradeLogRecord[]>;
export declare function listTradeLogs(options?: TradeLogListOptions): Promise<TradeLogListResult>;
export declare function countTradeLogs(): Promise<number>;
export declare function getRecentTradeLogs(limit?: number): Promise<TradeLogRecord[]>;
export declare function cleanupTradeLogs(options: TradeLogCleanupOptions): Promise<TradeLogCleanupResult>;
//# sourceMappingURL=trade-log-store.d.ts.map