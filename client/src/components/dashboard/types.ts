import { calculateRisk } from "@copytrade/shared/lib/risk/calc";
import { autoCalculateTPFromRR } from "@copytrade/shared/lib/executor/utils/signal";

// ==================== Types ====================

export interface Stats {
  totalMessages: number;
  executedSignals: number;
  openPositions: number;
  closedPositions: number;
  totalLogs: number;
  pendingDrafts: number;
}

export interface Position {
  _id?: string;
  id?: number;
  accountId?: string;
  channelId?: string;
  sourceName?: string;
  symbol: string;
  side: string;
  entryPrice: number;
  currentPrice?: number;
  quantity: number;
  leverage: number;
  marginType?: "isolated" | "cross";
  margin?: number | null;
  takeProfitTargets?: any[];
  stopLossPrice?: number;
  pnl: number;
  pnlUsd?: number | null;
  status: string;
  openedAt: string;
  closedAt?: string;
  closeReason?: string;
  processId?: string;
}

export interface Message {
  _id?: string;
  id?: number;
  messageId?: string;
  message_id?: string;
  author: string;
  content: string;
  signalType?: string;
  signal_type?: string;
  status: string;
  sourceTimestamp?: string;
  createdAt?: string;
  created_at?: string;
}

export interface Log {
  _id?: string;
  id?: number;
  processId?: string;
  type: string;
  action: string;
  symbol?: string;
  details?: string;
  level?: string;
  result?: string;
  error?: string;
  createdAt?: string;
  created_at?: string;
}

export const LOG_LEVEL_FILTERS = [
  "debug",
  "info",
  "processing",
  "success",
  "warning",
  "error",
  "executed",
  "rejected",
  "partial",
  "started",
  "updated",
  "noop",
];

export function getLogLevelBadgeClass(level: string) {
  if (level === "success" || level === "executed") return "badge-success";
  if (level === "error" || level === "rejected" || level === "fatal") {
    return "badge-danger";
  }
  if (level === "warning" || level === "partial") return "badge-warning";
  if (level === "processing" || level === "started") return "badge-info";
  if (level === "debug") return "badge-neutral";
  return "badge-neutral";
}

export function formatUsd(value?: number | null, { estimated = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${estimated ? "~" : ""}$${value.toFixed(value >= 100 ? 2 : 3)}`;
}

export function estimatePositionMargin(position: Position): number | null {
  if (
    !Number.isFinite(position.entryPrice) ||
    !Number.isFinite(position.quantity) ||
    !Number.isFinite(position.leverage) ||
    position.entryPrice <= 0 ||
    position.quantity <= 0 ||
    position.leverage <= 0
  ) {
    return null;
  }

  return (position.entryPrice * position.quantity) / position.leverage;
}

export function calculatePositionPnlUsd(
  position: Pick<Position, "entryPrice" | "quantity" | "side">,
  currentPrice: number,
): number | null {
  if (
    !Number.isFinite(position.entryPrice) ||
    !Number.isFinite(position.quantity) ||
    !Number.isFinite(currentPrice) ||
    position.entryPrice <= 0 ||
    position.quantity <= 0
  ) {
    return null;
  }

  const gross =
    position.side === "LONG"
      ? (currentPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - currentPrice) * position.quantity;
  return Number(gross.toFixed(4));
}

export function resolvePositionPnlUsd(position: Position): {
  value: number | null;
  estimated: boolean;
} {
  if (Number.isFinite(position.pnlUsd)) {
    return { value: position.pnlUsd ?? null, estimated: false };
  }

  if (Number.isFinite(position.currentPrice)) {
    return {
      value: calculatePositionPnlUsd(position, position.currentPrice as number),
      estimated: true,
    };
  }

  return { value: null, estimated: false };
}

export function resolvePositionPnlPercent(position: Position): number | null {
  if (Number.isFinite(position.pnl)) return position.pnl;

  if (
    !Number.isFinite(position.currentPrice) ||
    !Number.isFinite(position.entryPrice) ||
    !Number.isFinite(position.leverage) ||
    position.entryPrice <= 0
  ) {
    return null;
  }

  const priceDiff =
    position.side === "LONG"
      ? (position.currentPrice as number) - position.entryPrice
      : position.entryPrice - (position.currentPrice as number);
  return (priceDiff / position.entryPrice) * 100 * position.leverage;
}

export function formatCompactDateTime(value?: string | Date | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getCompactDateTimeParts(value?: string | Date | null) {
  if (!value) return { date: "-", time: "" };
  const date = new Date(value);
  return {
    date: date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    }),
    time: date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export function formatMarginMode(mode?: "isolated" | "cross" | null) {
  return mode === "cross" ? "Cross" : "Iso";
}

export function getPositionSourceLabel(
  position: Pick<Position, "sourceName" | "channelId">,
  channelNames: Record<string, string>,
) {
  if (position.sourceName?.trim()) return position.sourceName.trim();
  if (position.channelId && channelNames[position.channelId]) {
    return channelNames[position.channelId];
  }
  if (position.channelId) {
    return position.channelId.length > 12
      ? `...${position.channelId.slice(-10)}`
      : position.channelId;
  }
  return "-";
}

export function getPositionKey(position: Position) {
  return (
    position._id ||
    String(position.id) ||
    `${position.symbol}-${position.status}-${position.openedAt}`
  );
}

export function formatPositionTakeProfitTargets(
  position: Position,
  { includePercent = false, separator = ", " } = {},
) {
  const pendingTargets =
    position.takeProfitTargets?.filter(
      (target: any) => target.status === "pending",
    ) || [];

  if (pendingTargets.length === 0) return "-";

  return pendingTargets
    .map((target: any, index: number, allTargets: any[]) => {
      const priceLabel = `TP${index + 1}: ${target.price.toFixed(2)}`;
      if (!includePercent) return priceLabel;

      const rawPercentage =
        typeof target.percentage === "number"
          ? target.percentage
          : 100 / allTargets.length;
      const decimals = rawPercentage % 1 === 0 ? 0 : 2;
      return `${priceLabel} (${rawPercentage.toFixed(decimals)}%)`;
    })
    .join(separator);
}

export interface DraftTrade {
  _id: string;
  processId?: string;
  accountId?: string;
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
  sourceTimestamp?: string;
  createdAt: string;
  resolvedAt?: string;
  instrumentLotSize?: number | null;
  minOrderQty?: number | null;
  minOrderMarginUsdt?: number | null;
}

export type DraftAction = "accept" | "reject" | "redraft" | "reanalyze";

export interface AccountInfo {
  totalBalance: number;
  availableBalance: number;
  unrealizedPnl: number;
  currency: string;
}

export interface RiskConfig {
  riskPerTradePercent: number;
  maxLeverage: number;
  minLeverage: number;
  skipNoSL: boolean;
  tpCloseMode?: "equal" | "halving";
}

export interface CronStep {
  message: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "error";
}

export interface CronRunStatus {
  running: boolean;
  startedAt: string | null;
  progress: string;
  steps: CronStep[];
  result: "success" | "error" | null;
  error: string | null;
  completedAt: string | null;
}

export interface SignalConfig {
  fetchLimit: number;
  timeWindowHours: number;
}

export interface AccountExchangeInfo {
  accountId: string;
  accountName: string;
  sourceType: string;
  tradingPlatform: string;
  isDemo: boolean;
  channelIds: string[];
  account: AccountInfo | null;
  exchangeError: string | null;
}

export interface DashboardData {
  stats: Stats;
  accounts: AccountExchangeInfo[];
  account: AccountInfo | null;
  exchangeProvider: string | null;
  exchangeError: string | null;
  openPositions: Position[];
  pendingPositions: Position[];
  tradingMode: "auto" | "manual";
  riskConfig: RiskConfig | null;
  signalConfig: SignalConfig | null;
  channelNames: Record<string, string>;
}
