import mongoose, { Schema, Document, models, Model } from "mongoose";

// ─── Connection ────────────────────────────────────────────────────────────────

let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected && mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/copytrade";

  try {
    const conn = await mongoose.connect(uri);
    isConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface IProcessedMessage extends Document {
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
  createdAt: Date;
  processedAt?: Date;
}

export interface IPosition extends Document {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice?: number;
  quantity: number;
  leverage: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  orderId?: string;
  pnl: number;
  status: "open" | "closed";
  messageId?: string;
  signalData?: string;
  openedAt: Date;
  closedAt?: Date;
  closeReason?: string;
}

export interface ITradeLog extends Document {
  type: string;
  action: string;
  symbol?: string;
  details?: string;
  result?: string;
  error?: string;
  createdAt: Date;
}

export interface IDraftTrade extends Document {
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
  discordTimestamp?: Date;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface IDiscordSource extends Document {
  name: string;
  method: "bot" | "user";
  token: string;
  refreshToken?: string;
  channelIds: string[];
  isActive: boolean;
  lastFetchedAt?: Date;
  lastError?: string;
  tokenExpiresAt?: Date;
  autoRefresh: boolean;
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
  updatedAt: Date;
}

export interface ISignalConfig extends Document {
  fetchLimit: number; // default 10 — how many messages to fetch per channel
  timeWindowHours: number; // default 24 — only process messages within this many hours
  updatedAt: Date;
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const ProcessedMessageSchema = new Schema<IProcessedMessage>(
  {
    messageId: { type: String, required: true, unique: true },
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
    processedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

ProcessedMessageSchema.index({ status: 1 });
ProcessedMessageSchema.index({ createdAt: -1 });

const PositionSchema = new Schema<IPosition>(
  {
    symbol: { type: String, required: true, uppercase: true },
    side: { type: String, enum: ["LONG", "SHORT"], required: true },
    entryPrice: { type: Number, default: 0 },
    currentPrice: { type: Number, default: null },
    quantity: { type: Number, default: 0 },
    leverage: { type: Number, default: 10 },
    takeProfitPrice: { type: Number, default: null },
    stopLossPrice: { type: Number, default: null },
    orderId: { type: String, default: null },
    pnl: { type: Number, default: 0 },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    messageId: { type: String, default: null },
    signalData: { type: String, default: null },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, default: null },
  },
  { timestamps: { createdAt: "openedAt", updatedAt: false } },
);

PositionSchema.index({ status: 1 });
PositionSchema.index({ symbol: 1 });

const TradeLogSchema = new Schema<ITradeLog>(
  {
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
TradeLogSchema.index({ createdAt: -1 });

const DraftTradeSchema = new Schema<IDraftTrade>(
  {
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
    discordTimestamp: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

DraftTradeSchema.index({ status: 1 });
DraftTradeSchema.index({ createdAt: -1 });

const DiscordSourceSchema = new Schema<IDiscordSource>(
  {
    name: { type: String, required: true },
    method: { type: String, enum: ["bot", "user"], required: true },
    token: { type: String, required: true },
    refreshToken: { type: String, default: null },
    channelIds: [{ type: String, required: true }],
    isActive: { type: Boolean, default: true },
    lastFetchedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    tokenExpiresAt: { type: Date, default: null },
    autoRefresh: { type: Boolean, default: true },
  },
  { timestamps: true },
);

DiscordSourceSchema.index({ isActive: 1 });

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
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

const SignalConfigSchema = new Schema<ISignalConfig>(
  {
    fetchLimit: { type: Number, default: 10, min: 1, max: 100 },
    timeWindowHours: { type: Number, default: 24, min: 1, max: 720 },
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
    .sort({ discordTimestamp: -1 })
    .lean();
}

export function getRecentDrafts(limit: number = 50) {
  return DraftTrade.find().sort({ discordTimestamp: -1 }).limit(limit).lean();
}
