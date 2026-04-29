import mongoose, { Document, Model } from "mongoose";
import { SourceType } from "./enums";
import type { ExchangeCredentialValues } from "./exchange/exchange-credentials";
export declare function connectDB(): Promise<void>;
export declare function disconnectDB(): Promise<void>;
export declare function resetDBConnectionState(): void;
export interface IProcessedMessage extends Document {
    accountId?: string;
    processId?: string;
    messageId: string;
    channelId: string;
    author: string;
    content: string;
    signalType: string;
    parsedSignal: string;
    status: "pending" | "processed" | "executed" | "failed" | "ignored" | "drafted";
    sourceTimestamp?: Date;
    createdAt: Date;
    processedAt?: Date;
}
export interface ITPTarget {
    price: number;
    quantity: number;
    percentage: number;
    status: "pending" | "hit" | "cancelled";
    orderId?: string;
    hitAt?: Date;
}
export interface IPosition extends Document {
    accountId?: string;
    processId?: string;
    symbol: string;
    side: "LONG" | "SHORT";
    entryPrice: number;
    currentPrice?: number;
    quantity: number;
    leverage: number;
    takeProfitTargets: ITPTarget[];
    stopLossPrice?: number;
    orderId?: string;
    pnl: number;
    status: "pending" | "open" | "closed";
    tpSlPlaced?: boolean;
    channelId?: string;
    sourceName?: string;
    messageId?: string;
    signalData?: string;
    openedAt: Date;
    closedAt?: Date;
    closeReason?: string;
}
export interface ITradeLog extends Document {
    accountId?: string;
    processId?: string;
    type: string;
    action: string;
    symbol?: string;
    details?: string;
    level?: string;
    result?: string;
    error?: string;
    createdAt: Date;
}
export interface IDraftTrade extends Document {
    accountId?: string;
    processId?: string;
    messageId: string;
    channelId: string;
    messageUrl: string;
    author: string;
    originalContent: string;
    imageUrls: string[];
    signalData: string;
    action: string;
    symbol: string;
    side: "LONG" | "SHORT";
    entryPrice?: number;
    takeProfitTargets: number[];
    stopLoss?: number;
    leverage: number;
    quantity: number;
    confidence: number;
    reasoning: string;
    status: "pending" | "accepted" | "rejected" | "expired";
    positionId?: string;
    sourceTimestamp?: Date;
    createdAt: Date;
    resolvedAt?: Date;
}
export interface IDiscordSource extends Document {
    name: string;
    method: "bot" | "user";
    token: string;
    refreshToken?: string;
    channelIds: string[];
    channelNames?: Map<string, string>;
    disabledChannelIds?: string[];
    isActive: boolean;
    lastFetchedAt?: Date;
    lastError?: string;
    tokenExpiresAt?: Date;
    autoRefresh: boolean;
    createdAt: Date;
    updatedAt: Date;
}
/**
 * Account — unified configuration that ties together:
 *   - Source type (discord/telegram) + credentials
 *   - Channel IDs (specific to source type)
 *   - Trading platform (okx/mexc/metatrader/etc.)
 *
 * This is the target model for the future. For now, existing DiscordSource
 * data can coexist — the executor can use either Account or DiscordSource.
 */
export interface IAccount extends Document {
    /** Human-readable account name (e.g., "VIP Signals → OKX") */
    name: string;
    /** Whether this account is active */
    isActive: boolean;
    /** Source type: discord, telegram, etc. */
    sourceType: SourceType;
    /** Source-specific credentials (token, method, etc.) stored as flexible object */
    sourceData: {
        method?: "bot" | "user";
        token?: string;
        refreshToken?: string;
        tokenExpiresAt?: Date;
        autoRefresh?: boolean;
        phoneNumber?: string;
        apiId?: string;
        apiHash?: string;
        [key: string]: unknown;
    };
    /** Channel/group/chat IDs to monitor (specific to source type) */
    channelIds: string[];
    /** Display names for channels (channelId → display name) */
    channelNames?: Map<string, string>;
    /** Channel IDs that are temporarily disabled */
    disabledChannelIds?: string[];
    /** Trading platform: okx, mexc, paper, etc. */
    tradingPlatform?: string;
    /** Exchange-specific credentials (API key, secret, etc.) */
    exchangeData?: ExchangeCredentialValues;
    /** Account-level risk management overrides */
    riskOverrides?: {
        riskPerTradePercent?: number;
        maxLeverage?: number;
        minLeverage?: number;
        skipNoSL?: boolean;
        defaultRR?: number;
        defaultPositionSize?: number;
        defaultLeverage?: number;
        maxPositions?: number;
        [key: string]: unknown;
    };
    /** Per-channel risk overrides keyed by channelId */
    channelConfigs?: Record<string, {
        riskOverrides?: {
            riskPerTradePercent?: number;
            maxLeverage?: number;
            minLeverage?: number;
            skipNoSL?: boolean;
            defaultRR?: number;
            defaultPositionSize?: number;
            defaultLeverage?: number;
            maxPositions?: number;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    }>;
    lastFetchedAt?: Date;
    lastError?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface ITradingMode extends Document {
    mode: "auto" | "manual";
    updatedAt: Date;
}
export interface IRiskSettings extends Document {
    riskPerTradePercent: number;
    maxLeverage: number;
    minLeverage: number;
    skipNoSL: boolean;
    defaultRR: number;
    defaultPositionSize: number;
    defaultLeverage: number;
    maxPositions: number;
    updatedAt: Date;
}
export interface ISignalConfig extends Document {
    fetchLimit: number;
    timeWindowHours: number;
    batchSize: number;
    includeImageUrls: boolean;
    visionAIEnabled: boolean;
    updatedAt: Date;
}
export interface IAgentSession extends Document {
    sessionId: string;
    role: "viewer" | "operator" | "admin";
    status: "active" | "closed";
    userAgent?: string;
    ipAddress?: string;
    lastActivityAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface IAgentTurn extends Document {
    sessionId: string;
    processId: string;
    role: "viewer" | "operator" | "admin";
    provider: string;
    status: "running" | "awaiting_approval" | "completed" | "failed" | "aborted";
    userMessage: string;
    assistantResponse?: string;
    error?: string;
    messages: unknown[];
    history: Array<{
        role: "user" | "assistant";
        content: string;
    }>;
    pendingToolCalls: unknown[];
    pendingApproval?: {
        toolCallId: string;
        toolName: string;
        toolArgs: Record<string, unknown>;
        minimumRole: "viewer" | "operator" | "admin";
        requiresApproval: boolean;
    } | null;
    toolTraces: unknown[];
    startedAt: Date;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
export declare const ProcessedMessage: Model<IProcessedMessage>;
export declare const Position: Model<IPosition>;
export declare const TradeLog: Model<ITradeLog>;
export declare const DraftTrade: Model<IDraftTrade>;
export declare const TradingMode: Model<ITradingMode>;
export declare const DiscordSource: Model<IDiscordSource>;
export declare const Account: Model<IAccount>;
export declare const RiskSettings: Model<IRiskSettings>;
export declare const SignalConfig: Model<ISignalConfig>;
export declare const AgentSession: Model<IAgentSession>;
export declare const AgentTurn: Model<IAgentTurn>;
export declare function getActiveDiscordSources(): Promise<(mongoose.FlattenMaps<IDiscordSource> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[]>;
export declare function getAllDiscordSources(): Promise<(mongoose.FlattenMaps<IDiscordSource> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[]>;
export declare function getTradingMode(): Promise<"auto" | "manual">;
export declare function setTradingMode(mode: "auto" | "manual"): Promise<void>;
export declare function getStats(): Promise<{
    totalMessages: number;
    executedSignals: number;
    openPositions: number;
    closedPositions: number;
    totalLogs: number;
    pendingDrafts: number;
}>;
export declare function getOpenPositions(): mongoose.Query<(mongoose.FlattenMaps<IPosition> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[], mongoose.Document<unknown, {}, IPosition, {}, {}> & IPosition & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, {}, IPosition, "find", {}>;
export declare function getRecentMessages(limit?: number): mongoose.Query<(mongoose.FlattenMaps<IProcessedMessage> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[], mongoose.Document<unknown, {}, IProcessedMessage, {}, {}> & IProcessedMessage & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, {}, IProcessedMessage, "find", {}>;
export declare function getRecentLogs(limit?: number): Promise<import("./trade-log-store").TradeLogRecord[]>;
export declare function getAllPositions(limit?: number): mongoose.Query<(mongoose.FlattenMaps<IPosition> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[], mongoose.Document<unknown, {}, IPosition, {}, {}> & IPosition & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, {}, IPosition, "find", {}>;
export declare function getPendingDrafts(): mongoose.Query<(mongoose.FlattenMaps<IDraftTrade> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[], mongoose.Document<unknown, {}, IDraftTrade, {}, {}> & IDraftTrade & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, {}, IDraftTrade, "find", {}>;
export declare function getRecentDrafts(limit?: number): mongoose.Query<(mongoose.FlattenMaps<IDraftTrade> & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
})[], mongoose.Document<unknown, {}, IDraftTrade, {}, {}> & IDraftTrade & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, {}, IDraftTrade, "find", {}>;
/**
 * Calculate percentage allocation for TP targets.
 * 1 TP → 100%
 * 2 TPs → 50% / 50%
 * 3 TPs → 33.33% / 33.33% / 33.34%
 */
export declare function calculateTPPercentages(count: number): number[];
/**
 * Build TP target objects with percentage-based quantity allocation.
 */
export declare function buildTPTargets(prices: number[], totalQuantity: number): ITPTarget[];
/**
 * Recalculate percentages and quantities when TP count changes.
 */
export declare function recalculateTPAllocation(targets: ITPTarget[], totalQuantity: number): ITPTarget[];
//# sourceMappingURL=database.d.ts.map
