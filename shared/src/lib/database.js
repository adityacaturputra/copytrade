"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentTurn = exports.AgentSession = exports.SignalConfig = exports.RiskSettings = exports.Account = exports.DiscordSource = exports.TradingMode = exports.DraftTrade = exports.TradeLog = exports.Position = exports.ProcessedMessage = void 0;
exports.connectDB = connectDB;
exports.disconnectDB = disconnectDB;
exports.resetDBConnectionState = resetDBConnectionState;
exports.getActiveDiscordSources = getActiveDiscordSources;
exports.getAllDiscordSources = getAllDiscordSources;
exports.getTradingMode = getTradingMode;
exports.setTradingMode = setTradingMode;
exports.getStats = getStats;
exports.getOpenPositions = getOpenPositions;
exports.getRecentMessages = getRecentMessages;
exports.getRecentLogs = getRecentLogs;
exports.getAllPositions = getAllPositions;
exports.getPendingDrafts = getPendingDrafts;
exports.getRecentDrafts = getRecentDrafts;
exports.calculateTPPercentages = calculateTPPercentages;
exports.buildTPTargets = buildTPTargets;
exports.recalculateTPAllocation = recalculateTPAllocation;
const mongoose_1 = __importStar(require("mongoose"));
const enums_1 = require("./enums");
const trade_log_store_1 = require("./trade-log-store");
// ─── Connection ────────────────────────────────────────────────────────────────
let isConnected = false;
let processedMessageIndexesEnsured = false;
async function connectDB() {
    if (isConnected && mongoose_1.default.connection.readyState === 1)
        return;
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/copytrade";
    try {
        const conn = await mongoose_1.default.connect(uri);
        isConnected = true;
        console.log(`MongoDB connected: ${conn.connection.host}`);
        await ensureProcessedMessageIndexes();
    }
    catch (error) {
        console.error("MongoDB connection error:", error);
        throw error;
    }
}
async function disconnectDB() {
    try {
        if (mongoose_1.default.connection.readyState !== 0) {
            await mongoose_1.default.disconnect();
        }
    }
    finally {
        resetDBConnectionState();
    }
}
function resetDBConnectionState() {
    isConnected = false;
    processedMessageIndexesEnsured = false;
}
async function ensureProcessedMessageIndexes() {
    if (processedMessageIndexesEnsured)
        return;
    try {
        const db = mongoose_1.default.connection.db;
        if (!db)
            return;
        const collection = db.collection("processedmessages");
        const indexes = await collection.indexes();
        const hasLegacyMessageIdUnique = indexes.some((idx) => idx.name === "messageId_1" && idx.unique);
        if (hasLegacyMessageIdUnique) {
            await collection.dropIndex("messageId_1");
            console.log("🛠️ Dropped legacy unique index messageId_1 on processedmessages");
        }
        await collection.createIndex({ messageId: 1, accountId: 1 }, { name: "messageId_1_accountId_1", unique: true });
        processedMessageIndexesEnsured = true;
    }
    catch (error) {
        console.warn("⚠️ Failed to ensure processedmessages indexes:", error instanceof Error ? error.message : String(error));
    }
}
// ─── Schemas ───────────────────────────────────────────────────────────────────
const ProcessedMessageSchema = new mongoose_1.Schema({
    accountId: { type: String, default: null },
    processId: { type: String, default: null },
    messageId: { type: String, required: true },
    channelId: { type: String, required: true },
    author: { type: String, required: true },
    content: { type: String, required: true },
    signalType: { type: String, default: null },
    parsedSignal: { type: String, default: null },
    status: {
        type: String,
        enum: [
            "pending",
            "processed",
            "executed",
            "failed",
            "ignored",
            "drafted",
        ],
        default: "pending",
    },
    sourceTimestamp: { type: Date, default: null },
    processedAt: { type: Date, default: null },
}, { timestamps: { createdAt: "createdAt", updatedAt: false } });
ProcessedMessageSchema.index({ status: 1 });
ProcessedMessageSchema.index({ processId: 1 });
ProcessedMessageSchema.index({ createdAt: -1 });
ProcessedMessageSchema.index({ sourceTimestamp: -1 });
ProcessedMessageSchema.index({ messageId: 1, accountId: 1 }, { unique: true });
const PositionSchema = new mongoose_1.Schema({
    accountId: { type: String, default: null },
    processId: { type: String, default: null },
    symbol: { type: String, required: true, uppercase: true },
    side: { type: String, enum: ["LONG", "SHORT"], required: true },
    entryPrice: { type: Number, default: 0 },
    currentPrice: { type: Number, default: null },
    quantity: { type: Number, default: 0 },
    leverage: { type: Number, default: 10 },
    takeProfitTargets: [
        {
            price: { type: Number, required: true },
            quantity: { type: Number, required: true },
            percentage: { type: Number, default: 100 },
            status: {
                type: String,
                enum: ["pending", "hit", "cancelled"],
                default: "pending",
            },
            orderId: { type: String, default: null },
            hitAt: { type: Date, default: null },
        },
    ],
    stopLossPrice: { type: Number, default: null },
    orderId: { type: String, default: null },
    pnl: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ["pending", "open", "closed"],
        default: "open",
    },
    tpSlPlaced: { type: Boolean, default: false },
    channelId: { type: String, default: null },
    sourceName: { type: String, default: null },
    messageId: { type: String, default: null },
    signalData: { type: String, default: null },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, default: null },
}, { timestamps: { createdAt: "openedAt", updatedAt: false } });
PositionSchema.index({ status: 1 });
PositionSchema.index({ symbol: 1 });
PositionSchema.index({ symbol: 1, side: 1, channelId: 1, status: 1 });
PositionSchema.index({ processId: 1, openedAt: 1 });
const TradeLogSchema = new mongoose_1.Schema({
    accountId: { type: String, default: null },
    processId: { type: String, default: null },
    type: { type: String, required: true },
    action: { type: String, required: true },
    symbol: { type: String, default: null },
    details: { type: String, default: null },
    level: { type: String, default: null },
    result: { type: String, default: null },
    error: { type: String, default: null },
}, { timestamps: { createdAt: "createdAt", updatedAt: false } });
TradeLogSchema.index({ type: 1 });
TradeLogSchema.index({ level: 1, createdAt: -1 });
TradeLogSchema.index({ processId: 1, createdAt: 1 });
TradeLogSchema.index({ createdAt: -1 });
const DraftTradeSchema = new mongoose_1.Schema({
    accountId: { type: String, default: null },
    processId: { type: String, default: null },
    messageId: { type: String, required: true },
    channelId: { type: String, required: true },
    messageUrl: { type: String, default: null },
    author: { type: String, required: true },
    originalContent: { type: String, required: true },
    imageUrls: [{ type: String, default: [] }],
    signalData: { type: String, required: true },
    action: { type: String, required: true },
    symbol: { type: String, required: true, uppercase: true },
    side: { type: String, enum: ["LONG", "SHORT"], required: true },
    entryPrice: { type: Number, default: null },
    takeProfitTargets: [{ type: Number, default: [] }],
    stopLoss: { type: Number, default: null },
    leverage: { type: Number, default: 10 },
    quantity: { type: Number, default: 0 },
    confidence: { type: Number, default: 0 },
    reasoning: { type: String, default: "" },
    status: {
        type: String,
        enum: ["pending", "accepted", "rejected", "expired"],
        default: "pending",
    },
    positionId: { type: String, default: null },
    sourceTimestamp: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
}, { timestamps: { createdAt: "createdAt", updatedAt: false } });
DraftTradeSchema.index({ status: 1 });
DraftTradeSchema.index({ processId: 1 });
DraftTradeSchema.index({ createdAt: -1 });
const DiscordSourceSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    method: { type: String, enum: ["bot", "user"], required: true },
    token: { type: String, required: true },
    refreshToken: { type: String, default: null },
    channelIds: [{ type: String, required: true }],
    channelNames: { type: Map, of: String, default: {} },
    disabledChannelIds: [{ type: String, default: [] }],
    isActive: { type: Boolean, default: true },
    lastFetchedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    tokenExpiresAt: { type: Date, default: null },
    autoRefresh: { type: Boolean, default: true },
}, { timestamps: true });
DiscordSourceSchema.index({ isActive: 1 });
// ─── Account Schema ─────────────────────────────────────────────────────────
const AccountSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    sourceType: {
        type: String,
        enum: Object.values(enums_1.SourceType),
        required: true,
    },
    sourceData: {
        type: mongoose_1.Schema.Types.Mixed,
        required: true,
        default: {},
    },
    channelIds: [{ type: String, default: [] }],
    channelNames: { type: Map, of: String, default: {} },
    disabledChannelIds: [{ type: String, default: [] }],
    tradingPlatform: { type: String, default: null },
    exchangeData: { type: mongoose_1.Schema.Types.Mixed, default: null },
    riskOverrides: { type: mongoose_1.Schema.Types.Mixed, default: null },
    channelConfigs: { type: mongoose_1.Schema.Types.Mixed, default: {} },
    lastFetchedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
}, { timestamps: true });
AccountSchema.index({ isActive: 1 });
AccountSchema.index({ sourceType: 1 });
const TradingModeSchema = new mongoose_1.Schema({
    mode: { type: String, enum: ["auto", "manual"], default: "manual" },
}, { timestamps: { createdAt: false, updatedAt: true } });
const RiskSettingsSchema = new mongoose_1.Schema({
    riskPerTradePercent: { type: Number, default: 1, min: 0.1, max: 100 },
    maxLeverage: { type: Number, default: 100, min: 1, max: 125 },
    minLeverage: { type: Number, default: 1, min: 1, max: 125 },
    skipNoSL: { type: Boolean, default: true },
    defaultRR: { type: Number, default: 3, min: 0.5, max: 20 },
    defaultPositionSize: { type: Number, default: 50, min: 1 },
    defaultLeverage: { type: Number, default: 10, min: 1, max: 125 },
    maxPositions: { type: Number, default: 5, min: 0 },
}, { timestamps: { createdAt: false, updatedAt: true } });
const SignalConfigSchema = new mongoose_1.Schema({
    fetchLimit: { type: Number, default: 10, min: 1, max: 100 },
    timeWindowHours: { type: Number, default: 24, min: 1, max: 720 },
    batchSize: { type: Number, default: 5, min: 1, max: 50 },
    includeImageUrls: { type: Boolean, default: false },
    visionAIEnabled: { type: Boolean, default: false },
}, { timestamps: { createdAt: false, updatedAt: true } });
const AgentSessionSchema = new mongoose_1.Schema({
    sessionId: { type: String, required: true },
    role: {
        type: String,
        enum: ["viewer", "operator", "admin"],
        required: true,
    },
    status: {
        type: String,
        enum: ["active", "closed"],
        default: "active",
    },
    userAgent: { type: String, default: null },
    ipAddress: { type: String, default: null },
    lastActivityAt: { type: Date, default: Date.now },
}, { timestamps: true });
AgentSessionSchema.index({ sessionId: 1 }, { unique: true });
AgentSessionSchema.index({ updatedAt: -1 });
const AgentTurnSchema = new mongoose_1.Schema({
    sessionId: { type: String, required: true },
    processId: { type: String, required: true },
    role: {
        type: String,
        enum: ["viewer", "operator", "admin"],
        required: true,
    },
    provider: { type: String, required: true },
    status: {
        type: String,
        enum: [
            "running",
            "awaiting_approval",
            "completed",
            "failed",
            "aborted",
        ],
        default: "running",
    },
    userMessage: { type: String, required: true },
    assistantResponse: { type: String, default: null },
    error: { type: String, default: null },
    messages: { type: Array, default: [] },
    history: {
        type: [
            {
                role: {
                    type: String,
                    enum: ["user", "assistant"],
                    required: true,
                },
                content: { type: String, required: true },
            },
        ],
        default: [],
    },
    pendingToolCalls: { type: Array, default: [] },
    pendingApproval: { type: mongoose_1.Schema.Types.Mixed, default: null },
    toolTraces: { type: Array, default: [] },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
}, { timestamps: true });
AgentTurnSchema.index({ sessionId: 1, createdAt: -1 });
AgentTurnSchema.index({ processId: 1 }, { unique: true });
AgentTurnSchema.index({ status: 1, updatedAt: -1 });
// ─── Models ────────────────────────────────────────────────────────────────────
exports.ProcessedMessage = mongoose_1.models.ProcessedMessage ||
    mongoose_1.default.model("ProcessedMessage", ProcessedMessageSchema);
exports.Position = mongoose_1.models.Position || mongoose_1.default.model("Position", PositionSchema);
exports.TradeLog = mongoose_1.models.TradeLog || mongoose_1.default.model("TradeLog", TradeLogSchema);
exports.DraftTrade = mongoose_1.models.DraftTrade ||
    mongoose_1.default.model("DraftTrade", DraftTradeSchema);
exports.TradingMode = mongoose_1.models.TradingMode ||
    mongoose_1.default.model("TradingMode", TradingModeSchema);
exports.DiscordSource = mongoose_1.models.DiscordSource ||
    mongoose_1.default.model("DiscordSource", DiscordSourceSchema);
exports.Account = mongoose_1.models.Account || mongoose_1.default.model("Account", AccountSchema);
exports.RiskSettings = mongoose_1.models.RiskSettings ||
    mongoose_1.default.model("RiskSettings", RiskSettingsSchema);
exports.SignalConfig = mongoose_1.models.SignalConfig ||
    mongoose_1.default.model("SignalConfig", SignalConfigSchema);
exports.AgentSession = mongoose_1.models.AgentSession ||
    mongoose_1.default.model("AgentSession", AgentSessionSchema);
exports.AgentTurn = mongoose_1.models.AgentTurn || mongoose_1.default.model("AgentTurn", AgentTurnSchema);
// ─── Helper Functions ──────────────────────────────────────────────────────────
async function getActiveDiscordSources() {
    return exports.DiscordSource.find({ isActive: true }).sort({ createdAt: 1 }).lean();
}
async function getAllDiscordSources() {
    return exports.DiscordSource.find().sort({ createdAt: 1 }).lean();
}
async function getTradingMode() {
    const doc = await exports.TradingMode.findOne().sort({ updatedAt: -1 }).lean();
    return doc?.mode || "manual";
}
async function setTradingMode(mode) {
    await exports.TradingMode.findOneAndUpdate({}, { mode }, { upsert: true, new: true });
}
async function getStats() {
    const [totalMessages, executedSignals, openPositions, closedPositions, totalLogs, pendingDrafts,] = await Promise.all([
        exports.ProcessedMessage.countDocuments(),
        exports.ProcessedMessage.countDocuments({ status: "executed" }),
        exports.Position.countDocuments({ status: "open" }),
        exports.Position.countDocuments({ status: "closed" }),
        (0, trade_log_store_1.countTradeLogs)(),
        exports.DraftTrade.countDocuments({ status: "pending" }),
    ]);
    return {
        totalMessages,
        executedSignals,
        openPositions,
        closedPositions,
        totalLogs,
        pendingDrafts,
    };
}
function getOpenPositions() {
    return exports.Position.find({ status: "open" }).sort({ openedAt: -1 }).lean();
}
function getRecentMessages(limit = 20) {
    return exports.ProcessedMessage.find().sort({ createdAt: -1 }).limit(limit).lean();
}
function getRecentLogs(limit = 50) {
    return (0, trade_log_store_1.getRecentTradeLogs)(limit);
}
function getAllPositions(limit = 50) {
    return exports.Position.find().sort({ openedAt: -1 }).limit(limit).lean();
}
function getPendingDrafts() {
    return exports.DraftTrade.find({ status: "pending" })
        .sort({ sourceTimestamp: -1 })
        .lean();
}
function getRecentDrafts(limit = 50) {
    return exports.DraftTrade.find().sort({ sourceTimestamp: -1 }).limit(limit).lean();
}
// ─── TP Percentage Helper ──────────────────────────────────────────────────
/**
 * Calculate percentage allocation for TP targets.
 * 1 TP → 100%
 * 2 TPs → 50% / 50%
 * 3 TPs → 33.33% / 33.33% / 33.34%
 */
function calculateTPPercentages(count) {
    if (count <= 0)
        return [];
    if (count === 1)
        return [100];
    const base = Math.floor((100 / count) * 100) / 100; // e.g. 33.33 for 3
    const percentages = [];
    let allocated = 0;
    for (let i = 0; i < count - 1; i++) {
        percentages.push(base);
        allocated = Math.round((allocated + base) * 100) / 100;
    }
    // Last one gets the remainder so total = exactly 100
    percentages.push(Math.round((100 - allocated) * 100) / 100);
    return percentages;
}
/**
 * Build TP target objects with percentage-based quantity allocation.
 */
function buildTPTargets(prices, totalQuantity) {
    const percentages = calculateTPPercentages(prices.length);
    return prices.map((price, idx) => ({
        price,
        quantity: Math.round(((totalQuantity * percentages[idx]) / 100) * 10000) / 10000,
        percentage: percentages[idx],
        status: "pending",
    }));
}
/**
 * Recalculate percentages and quantities when TP count changes.
 */
function recalculateTPAllocation(targets, totalQuantity) {
    const percentages = calculateTPPercentages(targets.length);
    return targets.map((t, idx) => ({
        ...t,
        quantity: Math.round(((totalQuantity * percentages[idx]) / 100) * 10000) / 10000,
        percentage: percentages[idx],
    }));
}
//# sourceMappingURL=database.js.map
