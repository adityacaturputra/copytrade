import type { TradingSignal } from "../ai/core/types";
import type { IDraftTrade, IPosition } from "../database/index";
import type { BaseSourceMessage } from "../source/types";

export type DraftSourceMessage = Pick<
  BaseSourceMessage,
  | "messageId"
  | "channelId"
  | "author"
  | "content"
  | "messageUrl"
  | "imageUrls"
> & {
  originalContent?: string;
  timestamp?: Date;
  processId?: string;
};

export type ProcessTrackedMessage = Pick<
  BaseSourceMessage,
  | "messageId"
  | "channelId"
  | "author"
  | "content"
  | "messageUrl"
  | "imageUrls"
  | "sourceId"
  | "sourceName"
> & {
  originalContent?: string;
  timestamp?: Date;
  processId?: string;
};

export interface MessageAnalysisResult {
  messageId: string;
  signal: TradingSignal | null;
  parseError?: string;
}

export type SignalExecutionResult =
  | { type: "opened"; position: IPosition }
  | { type: "closed"; closedCount: number }
  | { type: "updated"; code: string; details: string }
  | { type: "noop"; code: string; details: string }
  | { type: "skipped"; code: string; reason: string };

export interface DraftExecutionOutcome {
  status: "accepted" | "rejected";
  result: "executed" | "updated" | "noop" | "rejected";
  positionId?: string;
  message?: string;
  error?: string;
}

export interface ExecuteTradeInput {
  symbol: string;
  action: "BUY" | "SELL";
  entryPrice?: number;
  stopLoss?: number | null;
  takeProfitTargets: number[];
  leverage: number;
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  channelId?: string;
  messageId?: string;
  sourceName?: string;
  signalData: string;
  logPrefix?: string;
  accountId?: string;
  processId?: string;
}

export type DuplicateCheckResult =
  | { type: "new" }
  | { type: "duplicate_exact" }
  | { type: "duplicate_updated"; updates: string[] }
  | { type: "duplicate_no_update" };

export type DraftDocument = IDraftTrade;
