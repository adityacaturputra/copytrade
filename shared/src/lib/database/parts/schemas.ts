import { Schema } from "mongoose";
import { SourceType } from "../../enums/index";

export const ProcessedMessageSchema = new Schema({
  accountId: String,
  processId: String,
  messageId: { type: String, required: true },
  channelId: { type: String, required: true },
  author: { type: String, required: true },
  content: { type: String, required: true },
  signalType: { type: String, required: true, default: "unknown" },
  parsedSignal: String,
  status: { type: String, required: true, default: "pending" },
  sourceTimestamp: Date,
  createdAt: { type: Date, default: Date.now },
  processedAt: Date
});

export const PositionSchema = new Schema({
  accountId: String,
  processId: String,
  symbol: { type: String, required: true },
  side: { type: String, required: true, enum: ["LONG", "SHORT"] },
  entryPrice: { type: Number, required: true },
  currentPrice: Number,
  quantity: { type: Number, required: true },
  leverage: { type: Number, required: true },
  marginType: String,
  margin: Number,
  takeProfitTargets: [{ price: Number, quantity: Number, percentage: Number, status: { type: String, default: "pending" }, orderId: String, hitAt: Date }],
  stopLossPrice: Number,
  orderId: String,
  pnl: { type: Number, default: 0 },
  pnlUsd: Number,
  status: { type: String, required: true, default: "pending" },
  tpSlPlaced: { type: Boolean, default: false },
  channelId: String,
  sourceName: String,
  messageId: String,
  signalData: String,
  openedAt: { type: Date, default: Date.now },
  closedAt: Date,
  closeReason: String
});

export const TradeLogSchema = new Schema({
  accountId: String,
  processId: String,
  type: String,
  action: String,
  symbol: String,
  details: String,
  level: String,
  result: String,
  error: String,
  createdAt: { type: Date, default: Date.now }
});

export const DraftTradeSchema = new Schema({
  accountId: String,
  processId: String,
  messageId: { type: String, required: true },
  channelId: { type: String, required: true },
  messageUrl: String,
  author: String,
  originalContent: String,
  imageUrls: [String],
  signalData: String,
  action: String,
  symbol: String,
  side: String,
  entryPrice: Number,
  takeProfitTargets: [Number],
  stopLoss: Number,
  leverage: Number,
  quantity: Number,
  confidence: Number,
  reasoning: String,
  status: { type: String, default: "pending" },
  positionId: String,
  sourceTimestamp: Date,
  createdAt: { type: Date, default: Date.now },
  resolvedAt: Date
});

export const TradingModeSchema = new Schema({
  mode: { type: String, default: "manual" }
}, { timestamps: true });

export const DiscordSourceSchema = new Schema({
  name: { type: String, required: true, unique: true },
  method: { type: String, required: true, enum: ["bot", "user"] },
  token: { type: String, required: true },
  refreshToken: String,
  channelIds: { type: [String], default: [] },
  channelNames: { type: Map, of: String },
  disabledChannelIds: [String],
  isActive: { type: Boolean, default: true },
  lastFetchedAt: Date,
  lastErrorAt: Date,
  lastErrorMessage: String,
  consecutiveErrors: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

export const AccountSchema = new Schema({
  id: { type: String, unique: true, sparse: true },
  name: { type: String, required: true },
  exchange: String,
  tradingPlatform: String,
  exchangeData: Schema.Types.Mixed,
  sourceType: String,
  sourceData: Schema.Types.Mixed,
  channelIds: { type: [String], default: [] },
  disabledChannelIds: { type: [String], default: [] },
  channelConfigs: { type: [Schema.Types.Mixed], default: [] },
  riskOverrides: Schema.Types.Mixed,
  credentials: Schema.Types.Mixed,
  simulated: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true }
}, { timestamps: true, strict: false });

export const RiskSettingsSchema = new Schema({
  accountId: String,
  riskPerTradePercent: { type: Number, default: 1 },
  maxRiskPerTradePercent: { type: Number, default: 1 },
  minLeverage: { type: Number, default: 1 },
  maxLeverage: { type: Number, default: 20 },
  defaultLeverage: { type: Number, default: 10 },
  defaultRR: { type: Number, default: 3 },
  defaultPositionSize: { type: Number, default: 50 },
  skipNoSL: { type: Boolean, default: true },
  maxPositions: { type: Number, default: 5 },
  maxOpenPositions: { type: Number, default: 5 },
  maxDailyLossPercent: Number,
  minPositionSizeUsdt: Number,
  maxPositionSizeUsdt: Number,
  allowManualEntry: { type: Boolean, default: false },
  trailingStopMode: { type: Boolean, default: false },
  autoRaiseMinOrderEnabled: { type: Boolean, default: false },
  autoRaiseMinOrderMaxMarginUsdt: { type: Number, default: 0 },
  autoRaiseTpCountEnabled: { type: Boolean, default: false },
  autoRaiseTpCountMaxMarginUsdt: { type: Number, default: 0 },
  tpCloseMode: { type: String, enum: ["equal", "halving"], default: "equal" },
}, { strict: false });

export const SignalConfigSchema = new Schema({
  channelId: { type: String, unique: true, sparse: true },
  sourceName: String,
  allowedSides: [String],
  allowedSymbols: [String],
  autoExecute: { type: Boolean, default: false },
  riskMultiplier: { type: Number, default: 1 },
  fixedLeverage: Number,
  minConfidence: Number,
  fetchLimit: { type: Number, default: 10 },
  timeWindowHours: { type: Number, default: 24 },
  batchSize: { type: Number, default: 5 },
  includeImageUrls: { type: Boolean, default: false },
  monitorVisionImages: { type: Boolean, default: false }
}, { strict: false });

export const AgentSessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  role: String,
  status: { type: String, default: "active" },
  context: String,
  userAgent: String,
  ipAddress: String,
  lastActivityAt: Date,
}, { timestamps: true, strict: false });

export const AgentTurnSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  processId: { type: String, required: true, unique: true },
  role: { type: String, required: true },
  provider: String,
  status: { type: String, default: "running" },
  content: String,
  userMessage: String,
  assistantResponse: String,
  error: String,
  history: { type: [Schema.Types.Mixed], default: [] },
  messages: { type: [Schema.Types.Mixed], default: [] },
  pendingToolCalls: { type: [Schema.Types.Mixed], default: [] },
  pendingApproval: Schema.Types.Mixed,
  toolTraces: { type: [Schema.Types.Mixed], default: [] },
  tokens: Number,
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true, strict: false });
