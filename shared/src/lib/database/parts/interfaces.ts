import { Document } from "mongoose";

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
  marginType?: "isolated" | "cross";
  margin?: number;
  takeProfitTargets: ITPTarget[];
  stopLossPrice?: number;
  orderId?: string;
  pnl: number;
  pnlUsd?: number | null;
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
  channelNames?: Map<string, string> | Record<string, string>;
  disabledChannelIds?: string[];
  autoRefresh?: boolean;
  lastError?: string | null;
  isActive: boolean;
  lastFetchedAt?: Date;
  lastErrorAt?: Date;
  lastErrorMessage?: string;
  consecutiveErrors?: number;
  createdAt: Date;
}

export interface IAccount extends Document {
  id?: string;
  name: string;
  exchange?: string;
  tradingPlatform?: string | null;
  exchangeData?: Record<string, unknown> | null;
  sourceType?: string | null;
  sourceData?: Record<string, unknown> | null;
  channelIds?: string[];
  channelNames?: Map<string, string> | Record<string, string>;
  lastError?: string | null;
  disabledChannelIds?: string[];
  channelConfigs?: unknown;
  riskOverrides?: Record<string, unknown> | null;
  credentials?: unknown;
  simulated: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRiskSettings extends Document {
  accountId?: string;
  riskPerTradePercent?: number;
  maxRiskPerTradePercent?: number;
  minLeverage?: number;
  maxLeverage: number;
  defaultLeverage?: number;
  defaultRR?: number;
  defaultPositionSize?: number;
  skipNoSL?: boolean;
  maxPositions?: number;
  maxOpenPositions?: number;
  maxDailyLossPercent?: number;
  minPositionSizeUsdt?: number;
  maxPositionSizeUsdt?: number;
  allowManualEntry?: boolean;
  trailingStopMode?: boolean;
  autoRaiseMinOrderEnabled?: boolean;
  autoRaiseMinOrderMaxMarginUsdt?: number;
  autoRaiseTpCountEnabled?: boolean;
  autoRaiseTpCountMaxMarginUsdt?: number;
  tpCloseMode?: "equal" | "halving";
}

export interface ISignalConfig extends Document {
  channelId?: string;
  sourceName?: string;
  allowedSides?: Array<"LONG" | "SHORT">;
  allowedSymbols?: string[];
  autoExecute?: boolean;
  riskMultiplier?: number;
  fixedLeverage?: number;
  minConfidence?: number;
  fetchLimit?: number;
  timeWindowHours?: number;
  batchSize?: number;
  includeImageUrls?: boolean;
  monitorVisionImages?: boolean;
  orphanCleanupLookbackHours?: number;
}

export interface IAgentSession extends Document {
  sessionId: string;
  role?: string;
  status: "active" | "completed" | "failed" | "aborted";
  context?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  lastActivityAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentTurn extends Document {
  sessionId: string;
  processId: string;
  role: string;
  provider?: string;
  status?: "running" | "awaiting_approval" | "completed" | "failed" | "aborted";
  content?: string;
  userMessage?: string;
  assistantResponse?: string | null;
  error?: string | null;
  history?: Array<{ role: string; content: string }>;
  messages?: unknown[];
  pendingToolCalls?: unknown[];
  pendingApproval?: unknown;
  toolTraces?: Array<Record<string, unknown>>;
  tokens?: number;
  startedAt?: Date;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface ITradingMode extends Document {
  mode: "auto" | "manual";
  updatedAt: Date;
}
