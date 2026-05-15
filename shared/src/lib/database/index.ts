import mongoose, { models, Model } from "mongoose";
import { countTradeLogs, getRecentTradeLogs } from "../trade-log/store";
import {
  IProcessedMessage, IPosition, ITradeLog, IDraftTrade, ITradingMode,
  IDiscordSource, IAccount, IRiskSettings, ISignalConfig, IAgentSession, IAgentTurn, ITPTarget
} from "./parts/interfaces";
import {
  ProcessedMessageSchema, PositionSchema, TradeLogSchema, DraftTradeSchema, TradingModeSchema,
  DiscordSourceSchema, AccountSchema, RiskSettingsSchema, SignalConfigSchema, AgentSessionSchema, AgentTurnSchema
} from "./parts/schemas";

export * from "./parts/interfaces";

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
  } catch (error) { console.error("MongoDB connection error:", error); throw error; }
}

export async function disconnectDB(): Promise<void> {
  try { if (mongoose.connection.readyState !== 0) await mongoose.disconnect(); }
  finally { isConnected = false; processedMessageIndexesEnsured = false; }
}

async function ensureProcessedMessageIndexes(): Promise<void> {
  if (processedMessageIndexesEnsured) return;
  try {
    const db = mongoose.connection.db;
    if (!db) return;
    const collection = db.collection("processedmessages");
    const indexes = await collection.indexes();
    if (indexes.some(idx => idx.name === "messageId_1" && idx.unique)) {
      await collection.dropIndex("messageId_1");
      console.log("🛠️ Dropped legacy unique index messageId_1 on processedmessages");
    }
    await collection.createIndex({ messageId: 1, accountId: 1 }, { name: "messageId_1_accountId_1", unique: true });
    processedMessageIndexesEnsured = true;
  } catch (error) { console.warn("⚠️ Failed to ensure processedmessages indexes:", error instanceof Error ? error.message : String(error)); }
}

export const ProcessedMessage: Model<IProcessedMessage> = models.ProcessedMessage || mongoose.model<IProcessedMessage>("ProcessedMessage", ProcessedMessageSchema);
export const Position: Model<IPosition> = models.Position || mongoose.model<IPosition>("Position", PositionSchema);
export const TradeLog: Model<ITradeLog> = models.TradeLog || mongoose.model<ITradeLog>("TradeLog", TradeLogSchema);
export const DraftTrade: Model<IDraftTrade> = models.DraftTrade || mongoose.model<IDraftTrade>("DraftTrade", DraftTradeSchema);
export const TradingMode: Model<ITradingMode> = models.TradingMode || mongoose.model<ITradingMode>("TradingMode", TradingModeSchema);
export const DiscordSource: Model<IDiscordSource> = models.DiscordSource || mongoose.model<IDiscordSource>("DiscordSource", DiscordSourceSchema);
export const Account: Model<IAccount> = models.Account || mongoose.model<IAccount>("Account", AccountSchema);
export const RiskSettings: Model<IRiskSettings> = models.RiskSettings || mongoose.model<IRiskSettings>("RiskSettings", RiskSettingsSchema);
export const SignalConfig: Model<ISignalConfig> = models.SignalConfig || mongoose.model<ISignalConfig>("SignalConfig", SignalConfigSchema);
export const AgentSession: Model<IAgentSession> = models.AgentSession || mongoose.model<IAgentSession>("AgentSession", AgentSessionSchema);
export const AgentTurn: Model<IAgentTurn> = models.AgentTurn || mongoose.model<IAgentTurn>("AgentTurn", AgentTurnSchema);

export async function getActiveDiscordSources() { return DiscordSource.find({ isActive: true }).sort({ createdAt: 1 }).lean(); }
export async function getAllDiscordSources() { return DiscordSource.find().sort({ createdAt: 1 }).lean(); }
export async function getTradingMode(): Promise<"auto" | "manual"> {
  const doc = await TradingMode.findOne().sort({ updatedAt: -1 }).lean(); return doc?.mode || "manual";
}
export async function setTradingMode(mode: "auto" | "manual"): Promise<void> { await TradingMode.findOneAndUpdate({}, { mode }, { upsert: true, new: true }); }
export async function getStats() {
  const [totalMessages, executedSignals, openPositions, closedPositions, totalLogs, pendingDrafts] = await Promise.all([
    ProcessedMessage.countDocuments(), ProcessedMessage.countDocuments({ status: "executed" }),
    Position.countDocuments({ status: "open" }), Position.countDocuments({ status: "closed" }),
    countTradeLogs(), DraftTrade.countDocuments({ status: "pending" }),
  ]);
  return { totalMessages, executedSignals, openPositions, closedPositions, totalLogs, pendingDrafts };
}
export function getOpenPositions() { return Position.find({ status: "open" }).sort({ openedAt: -1 }).lean(); }
export function getRecentMessages(limit = 20) { return ProcessedMessage.find().sort({ createdAt: -1 }).limit(limit).lean(); }
export function getRecentLogs(limit = 50) { return getRecentTradeLogs(limit); }
export function getAllPositions(limit = 50) { return Position.find().sort({ openedAt: -1 }).limit(limit).lean(); }
export function getPendingDrafts() { return DraftTrade.find({ status: "pending" }).sort({ sourceTimestamp: -1 }).lean(); }
export function getRecentDrafts(limit = 50) { return DraftTrade.find().sort({ sourceTimestamp: -1 }).limit(limit).lean(); }

export function calculateTPPercentages(count: number): number[] {
  if (count <= 0) return []; if (count === 1) return [100];
  const base = Math.floor((100 / count) * 100) / 100;
  const percentages: number[] = []; let allocated = 0;
  for (let i = 0; i < count - 1; i++) { percentages.push(base); allocated = Math.round((allocated + base) * 100) / 100; }
  percentages.push(Math.round((100 - allocated) * 100) / 100); return percentages;
}
export function buildTPTargets(prices: number[], totalQuantity: number): ITPTarget[] {
  const percentages = calculateTPPercentages(prices.length);
  return prices.map((price, idx) => ({ price, quantity: Math.round(((totalQuantity * percentages[idx]) / 100) * 10000) / 10000, percentage: percentages[idx], status: "pending" }));
}
export function recalculateTPAllocation(targets: ITPTarget[], totalQuantity: number): ITPTarget[] {
  const percentages = calculateTPPercentages(targets.length);
  return targets.map((t, idx) => ({ ...t, quantity: Math.round(((totalQuantity * percentages[idx]) / 100) * 10000) / 10000, percentage: percentages[idx] }));
}
