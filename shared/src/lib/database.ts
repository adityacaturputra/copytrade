import mongoose, { Schema, Document, models, Model } from "mongoose";
import { SourceType } from "./enums";

// ─── Connection ────────────────────────────────────────────────────────────────

let isConnected = false;
let processedMessageIndexesEnsured = false;

export async function connectDB(): Promise<void> {
  if (isConnected && mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/copytrade";

  try {
    const conn = await mongoose.connect(uri);
    isConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}`);
    await ensureProcessedMessageIndexes();
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

async function ensureProcessedMessageIndexes(): Promise<void> {
  if (processedMessageIndexesEnsured) return;

  try {
    const db = mongoose.connection.db;
    if (!db) return;

    const collection = db.collection("processedmessages");
    const indexes = await collection.indexes();

    const hasLegacyMessageIdUnique = indexes.some(
      (idx) => idx.name === "messageId_1" && idx.unique,
    );

    if (hasLegacyMessageIdUnique) {
      await collection.dropIndex("messageId_1");
      console.log(
        "🛠️ Dropped legacy unique index messageId_1 on processedmessages",
      );
    }

    await collection.createIndex(
      { messageId: 1, accountId: 1 },
      { name: "messageId_1_accountId_1", unique: true },
    );

    processedMessageIndexesEnsured = true;
  } catch (error) {
    console.warn(
      "⚠️ Failed to ensure processedmessages indexes:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface IProcessedMessage extends Document {
  accountId?: string;
  processId?: string;
  messageId: string;
  channelId: string;
  author: string;
  content: string;
  signalType: string;
  parsedSignal: string;
  status:
    | "pending"
    | "processed"
    | "executed"
    | "failed"
    | "ignored"
    | "drafted";
  sourceTimestamp?: Date;
  createdAt: Date;
  processedAt?: Date;
}

export interface ITPTarget {
  price: number;
  quantity: number;
  percentage: number; // allocation percentage (e.g. 50 means 50% of position)
  status: "pending" | "hit" | "cancelled";
  orderId?: string;
  hitAt?: Date;
}

export interface IPosition extends Document {
  accountId?: string;
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
  channelNames?: Map<string, string>; // channelId → display name
  disabledChannelIds?: string[]; // channel IDs that are temporarily disabled
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

  // ─── Source Configuration ──────────────────────────────────────
  /** Source type: discord, telegram, etc. */
  sourceType: SourceType;
  /** Source-specific credentials (token, method, etc.) stored as flexible object */
  sourceData: {
    // Discord-specific
    method?: "bot" | "user";
    token?: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    autoRefresh?: boolean;
    // Telegram-specific (future)
    phoneNumber?: string;
    apiId?: string;
    apiHash?: string;
    // Generic
    [key: string]: unknown;
  };
  /** Channel/group/chat IDs to monitor (specific to source type) */
  channelIds: string[];
  /** Display names for channels (channelId → display name) */
  channelNames?: Map<string, string>;
  /** Channel IDs that are temporarily disabled */
  disabledChannelIds?: string[];

  // ─── Exchange Configuration ────────────────────────────────────
  /** Trading platform: okx, mexc, paper, etc. */
  tradingPlatform?: string;
  /** Exchange-specific credentials (API key, secret, etc.) */
  exchangeData?: {
    apiKey?: string;
    secretKey?: string;
    passphrase?: string;
    simulated?: boolean;
    [key: string]: unknown;
  };

  // ─── Health Status ─────────────────────────────────────────────
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
  riskPerTradePercent: number; // default 1 (1% of balance as margin per trade)
  maxLeverage: number; // default 100
  minLeverage: number; // default 1
  skipNoSL: boolean; // default true — skip trades without SL
  defaultRR: number; // default 3 — auto-calculate TP from RR when no TP provided
  defaultPositionSize: number; // default 50 (USDT) — fallback position size when signal has no size
  defaultLeverage: number; // default 10 — fallback leverage when signal has no leverage
  maxPositions: number; // default 5 — max concurrent open positions (0 = unlimited)
  updatedAt: Date;
}

export interface ISignalConfig extends Document {
  fetchLimit: number; // default 10 — how many messages to fetch per channel
  timeWindowHours: number; // default 24 — only process messages within this many hours
  batchSize: number; // default 5 — how many messages to send to AI per bulk request
  includeImageUrls: boolean; // default false — whether to include images in AI prompts
  visionAIEnabled: boolean; // default false — enable Gemini Vision pre-layer for image analysis
  updatedAt: Date;
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const ProcessedMessageSchema = new Schema<IProcessedMessage>(
  {
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
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

ProcessedMessageSchema.index({ status: 1 });
ProcessedMessageSchema.index({ processId: 1 });
ProcessedMessageSchema.index({ createdAt: -1 });
ProcessedMessageSchema.index({ sourceTimestamp: -1 });
ProcessedMessageSchema.index({ messageId: 1, accountId: 1 }, { unique: true });

const PositionSchema = new Schema<IPosition>(
  {
    accountId: { type: String, default: null },
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
  },
  { timestamps: { createdAt: "openedAt", updatedAt: false } },
);

PositionSchema.index({ status: 1 });
PositionSchema.index({ symbol: 1 });
PositionSchema.index({ symbol: 1, side: 1, channelId: 1, status: 1 });

const TradeLogSchema = new Schema<ITradeLog>(
  {
    accountId: { type: String, default: null },
    processId: { type: String, default: null },
    type: { type: String, required: true },
    action: { type: String, required: true },
    symbol: { type: String, default: null },
    details: { type: String, default: null },
    result: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

TradeLogSchema.index({ type: 1 });
TradeLogSchema.index({ processId: 1, createdAt: 1 });
TradeLogSchema.index({ createdAt: -1 });

const DraftTradeSchema = new Schema<IDraftTrade>(
  {
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
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

DraftTradeSchema.index({ status: 1 });
DraftTradeSchema.index({ processId: 1 });
DraftTradeSchema.index({ createdAt: -1 });

const DiscordSourceSchema = new Schema<IDiscordSource>(
  {
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
  },
  { timestamps: true },
);

DiscordSourceSchema.index({ isActive: 1 });

// ─── Account Schema ─────────────────────────────────────────────────────────

const AccountSchema = new Schema<IAccount>(
  {
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    sourceType: {
      type: String,
      enum: Object.values(SourceType),
      required: true,
    },
    sourceData: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    channelIds: [{ type: String, default: [] }],
    channelNames: { type: Map, of: String, default: {} },
    disabledChannelIds: [{ type: String, default: [] }],
    tradingPlatform: { type: String, default: null },
    exchangeData: { type: Schema.Types.Mixed, default: null },
    lastFetchedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

AccountSchema.index({ isActive: 1 });
AccountSchema.index({ sourceType: 1 });

const TradingModeSchema = new Schema<ITradingMode>(
  {
    mode: { type: String, enum: ["auto", "manual"], default: "manual" },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

const RiskSettingsSchema = new Schema<IRiskSettings>(
  {
    riskPerTradePercent: { type: Number, default: 1, min: 0.1, max: 100 },
    maxLeverage: { type: Number, default: 100, min: 1, max: 125 },
    minLeverage: { type: Number, default: 1, min: 1, max: 125 },
    skipNoSL: { type: Boolean, default: true },
    defaultRR: { type: Number, default: 3, min: 1, max: 20 },
    defaultPositionSize: { type: Number, default: 50, min: 1 },
    defaultLeverage: { type: Number, default: 10, min: 1, max: 125 },
    maxPositions: { type: Number, default: 5, min: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

const SignalConfigSchema = new Schema<ISignalConfig>(
  {
    fetchLimit: { type: Number, default: 10, min: 1, max: 100 },
    timeWindowHours: { type: Number, default: 24, min: 1, max: 720 },
    batchSize: { type: Number, default: 5, min: 1, max: 50 },
    includeImageUrls: { type: Boolean, default: false },
    visionAIEnabled: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

// ─── Models ────────────────────────────────────────────────────────────────────

export const ProcessedMessage: Model<IProcessedMessage> =
  models.ProcessedMessage ||
  mongoose.model<IProcessedMessage>("ProcessedMessage", ProcessedMessageSchema);

export const Position: Model<IPosition> =
  models.Position || mongoose.model<IPosition>("Position", PositionSchema);

export const TradeLog: Model<ITradeLog> =
  models.TradeLog || mongoose.model<ITradeLog>("TradeLog", TradeLogSchema);

export const DraftTrade: Model<IDraftTrade> =
  models.DraftTrade ||
  mongoose.model<IDraftTrade>("DraftTrade", DraftTradeSchema);

export const TradingMode: Model<ITradingMode> =
  models.TradingMode ||
  mongoose.model<ITradingMode>("TradingMode", TradingModeSchema);

export const DiscordSource: Model<IDiscordSource> =
  models.DiscordSource ||
  mongoose.model<IDiscordSource>("DiscordSource", DiscordSourceSchema);

export const Account: Model<IAccount> =
  models.Account || mongoose.model<IAccount>("Account", AccountSchema);

export const RiskSettings: Model<IRiskSettings> =
  models.RiskSettings ||
  mongoose.model<IRiskSettings>("RiskSettings", RiskSettingsSchema);

export const SignalConfig: Model<ISignalConfig> =
  models.SignalConfig ||
  mongoose.model<ISignalConfig>("SignalConfig", SignalConfigSchema);

// ─── Helper Functions ──────────────────────────────────────────────────────────

export async function getActiveDiscordSources() {
  return DiscordSource.find({ isActive: true }).sort({ createdAt: 1 }).lean();
}

export async function getAllDiscordSources() {
  return DiscordSource.find().sort({ createdAt: 1 }).lean();
}

export async function getTradingMode(): Promise<"auto" | "manual"> {
  const doc = await TradingMode.findOne().sort({ updatedAt: -1 }).lean();
  return doc?.mode || "manual";
}

export async function setTradingMode(mode: "auto" | "manual"): Promise<void> {
  await TradingMode.findOneAndUpdate({}, { mode }, { upsert: true, new: true });
}

export function getStats() {
  return Promise.all([
    ProcessedMessage.countDocuments(),
    ProcessedMessage.countDocuments({ status: "executed" }),
    Position.countDocuments({ status: "open" }),
    Position.countDocuments({ status: "closed" }),
    TradeLog.countDocuments(),
    DraftTrade.countDocuments({ status: "pending" }),
  ]).then(
    ([
      totalMessages,
      executedSignals,
      openPositions,
      closedPositions,
      totalLogs,
      pendingDrafts,
    ]) => ({
      totalMessages,
      executedSignals,
      openPositions,
      closedPositions,
      totalLogs,
      pendingDrafts,
    }),
  );
}

export function getOpenPositions() {
  return Position.find({ status: "open" }).sort({ openedAt: -1 }).lean();
}

export function getRecentMessages(limit: number = 20) {
  return ProcessedMessage.find().sort({ createdAt: -1 }).limit(limit).lean();
}

export function getRecentLogs(limit: number = 50) {
  return TradeLog.find().sort({ createdAt: -1 }).limit(limit).lean();
}

export function getAllPositions(limit: number = 50) {
  return Position.find().sort({ openedAt: -1 }).limit(limit).lean();
}

export function getPendingDrafts() {
  return DraftTrade.find({ status: "pending" })
    .sort({ sourceTimestamp: -1 })
    .lean();
}

export function getRecentDrafts(limit: number = 50) {
  return DraftTrade.find().sort({ sourceTimestamp: -1 }).limit(limit).lean();
}

// ─── TP Percentage Helper ──────────────────────────────────────────────────

/**
 * Calculate percentage allocation for TP targets.
 * 1 TP → 100%
 * 2 TPs → 50% / 50%
 * 3 TPs → 33.33% / 33.33% / 33.34%
 */
export function calculateTPPercentages(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [100];

  const base = Math.floor((100 / count) * 100) / 100; // e.g. 33.33 for 3
  const percentages: number[] = [];
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
export function buildTPTargets(
  prices: number[],
  totalQuantity: number,
): ITPTarget[] {
  const percentages = calculateTPPercentages(prices.length);
  return prices.map((price, idx) => ({
    price,
    quantity:
      Math.round(((totalQuantity * percentages[idx]) / 100) * 10000) / 10000,
    percentage: percentages[idx],
    status: "pending" as const,
  }));
}

/**
 * Recalculate percentages and quantities when TP count changes.
 */
export function recalculateTPAllocation(
  targets: ITPTarget[],
  totalQuantity: number,
): ITPTarget[] {
  const percentages = calculateTPPercentages(targets.length);
  return targets.map((t, idx) => ({
    ...t,
    quantity:
      Math.round(((totalQuantity * percentages[idx]) / 100) * 10000) / 10000,
    percentage: percentages[idx],
  }));
}
