import {
  connectDB,
  Account,
  Position,
} from "@copytrade/shared/lib/database";
import {
  ExchangeFactory,
  type ExchangeProvider,
  type ExchangeCredentials,
  normalizeExchangeProvider as normalizeSharedExchangeProvider,
} from "@copytrade/shared/lib/exchange/ExchangeFactory";
import type { ExchangeClient } from "@copytrade/shared/lib/exchange/types";
import { SourceFactory } from "@copytrade/shared/lib/source/SourceFactory";
import { SourceType } from "@copytrade/shared/lib/enums";
import type {
  BaseSourceConfig,
  BaseSourceMessage,
  ISourceProvider,
} from "@copytrade/shared/lib/source/types";

export type ToolArgs = Record<string, unknown>;
export type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

export type AccountRecord = {
  _id: unknown;
  name: string;
  isActive: boolean;
  sourceType?: string;
  sourceData?: Record<string, unknown> | null;
  channelIds?: string[];
  channelNames?: Map<string, string> | Record<string, string>;
  tradingPlatform?: string | null;
  exchangeData?: Record<string, unknown> | null;
  lastFetchedAt?: Date | null;
  lastError?: string | null;
  createdAt?: Date;
};

export type PositionRecord = {
  _id: { toString(): string };
  accountId?: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice?: number;
  quantity: number;
  leverage: number;
  takeProfitTargets: Array<{
    price: number;
    quantity: number;
    percentage: number;
    status?: string;
  }>;
  stopLossPrice?: number;
  orderId?: string | null;
  pnl?: number;
  status: "pending" | "open" | "closed";
  channelId?: string;
  messageId?: string;
  messageUrl?: string;
  openedAt?: Date;
  closeReason?: string | null;
};

export interface ExchangeContext {
  exchange: ExchangeClient;
  accountId: string;
  accountName: string;
  provider: ExchangeProvider;
}

export interface SourceContext {
  provider: ISourceProvider;
  config: BaseSourceConfig;
  accountId: string;
  accountName: string;
  sourceType: SourceType;
}

export function roundPrice(price: number): number {
  return Math.round(price * 100) / 100;
}

export function getFrontendBaseUrl(): string {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

export function getBackendBaseUrl(): string {
  return (
    process.env.BACKEND_URL ||
    `http://localhost:${process.env.PORT || "3001"}`
  ).replace(/\/+$/, "");
}

export function getErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("error" in data)) {
    return undefined;
  }

  const errorValue = (data as { error?: unknown }).error;
  return typeof errorValue === "string" ? errorValue : undefined;
}

export function getAccountIdFromArgs(args: ToolArgs): string | undefined {
  const accountId = args.accountId;
  if (typeof accountId !== "string") return undefined;
  const trimmed = accountId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeExchangeProvider(value: unknown): ExchangeProvider | null {
  return normalizeSharedExchangeProvider(value);
}

export function normalizeSourceType(value: unknown): SourceType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();

  if (normalized === SourceType.DISCORD || normalized === SourceType.TELEGRAM) {
    return normalized as SourceType;
  }

  return null;
}

export function toExchangeCredentials(account: AccountRecord): ExchangeCredentials {
  const provider = normalizeExchangeProvider(account.tradingPlatform);
  if (!provider) {
    throw new Error(
      `Account "${account.name}" (${String(account._id)}) does not have a valid tradingPlatform`,
    );
  }

  const exchangeData = (account.exchangeData || {}) as Record<string, unknown>;

  return {
    provider,
    apiKey:
      typeof exchangeData.apiKey === "string" ? exchangeData.apiKey : undefined,
    secretKey:
      typeof exchangeData.secretKey === "string"
        ? exchangeData.secretKey
        : undefined,
    passphrase:
      typeof exchangeData.passphrase === "string"
        ? exchangeData.passphrase
        : undefined,
    simulated:
      typeof exchangeData.simulated === "boolean"
        ? exchangeData.simulated
        : undefined,
  };
}

export function getSourceConfigForAccount(account: AccountRecord): BaseSourceConfig {
  const sourceType = normalizeSourceType(account.sourceType);
  if (!sourceType) {
    throw new Error(
      `Account "${account.name}" (${String(account._id)}) does not have a valid sourceType`,
    );
  }

  return {
    _id: String(account._id),
    name: account.name,
    type: sourceType,
    channelIds: Array.isArray(account.channelIds) ? account.channelIds : [],
    ...((account.sourceData as Record<string, unknown>) || {}),
  };
}

export function buildSourceSummary(account: AccountRecord) {
  const sourceType = normalizeSourceType(account.sourceType);
  const sourceData = (account.sourceData || {}) as Record<string, unknown>;

  return {
    accountId: String(account._id),
    name: account.name,
    sourceType,
    providerName: sourceType || "unknown",
    channelIds: Array.isArray(account.channelIds) ? account.channelIds : [],
    isActive: account.isActive,
    hasCredentials: Boolean(
      typeof sourceData.token === "string" && sourceData.token.trim().length > 0,
    ),
    lastFetchedAt: account.lastFetchedAt || null,
    lastError: account.lastError || null,
  };
}

export function normalizePositiveNumber(
  value: unknown,
  fallback: number,
  max?: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return fallback;
  }

  if (typeof max === "number") {
    return Math.min(value, max);
  }

  return value;
}

export function normalizeSortOrder(value: unknown): "asc" | "desc" {
  return value === "asc" ? "asc" : "desc";
}

export async function cancelAlgoOrdersByTypes(
  exchange: ExchangeClient,
  symbol: string,
  types: Array<"tp" | "sl" | "conditional">,
): Promise<{ cancelled: string[]; errors: string[] }> {
  const supportsDirectAlgoCancel =
    exchange.name === "bybit" || exchange.name === "binance";

  if (!supportsDirectAlgoCancel) {
    return exchange.cancelAlgoOrders(symbol);
  }

  const cancelled: string[] = [];
  const errors: string[] = [];
  const algoOrders = await exchange.getAlgoOrders(symbol);
  const selectedOrders = algoOrders.filter((order) =>
    types.includes((order.type || "conditional") as "tp" | "sl" | "conditional"),
  );

  for (const order of selectedOrders) {
    try {
      const ok = await exchange.cancelOrder(order.orderId, order.symbol);
      if (ok) {
        cancelled.push(order.orderId);
      } else {
        errors.push(`${order.orderId}: Unknown order`);
      }
    } catch (error) {
      errors.push(
        `${order.orderId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  return { cancelled, errors };
}

export function toClosingSide(positionSide: "LONG" | "SHORT"): "BUY" | "SELL" {
  return positionSide === "LONG" ? "SELL" : "BUY";
}

export function calculatePositionPnlPercent(
  position: PositionRecord,
  currentPrice: number,
): number {
  const priceDiff =
    position.side === "LONG"
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

  return position.entryPrice
    ? (priceDiff / position.entryPrice) * 100 * position.leverage
    : 0;
}

export function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function loadSourceAccounts(
  args: ToolArgs = {},
  options: {
    fallbackSourceType?: SourceType;
    activeOnly?: boolean;
  } = {},
): Promise<AccountRecord[]> {
  await connectDB();

  const requestedAccountId = getAccountIdFromArgs(args);
  const requestedSourceType =
    normalizeSourceType(args.sourceType) || options.fallbackSourceType;

  const filter: Record<string, unknown> = {};
  if (requestedAccountId) filter._id = requestedAccountId;
  if (requestedSourceType) filter.sourceType = requestedSourceType;
  if (options.activeOnly) filter.isActive = true;

  const accounts = (await Account.find(filter)
    .sort({ createdAt: 1 })
    .lean()
    .exec()) as AccountRecord[];

  return accounts.filter((account) => Boolean(normalizeSourceType(account.sourceType)));
}

export async function findPositionRecord(args: ToolArgs): Promise<PositionRecord> {
  await connectDB();

  const positionId = parseOptionalString(args.positionId);
  const accountId = getAccountIdFromArgs(args);
  const symbol = parseOptionalString(args.symbol);
  const status = parseOptionalString(args.status);

  if (positionId) {
    const position = (await Position.findById(positionId).lean().exec()) as
      | PositionRecord
      | null;
    if (!position) {
      throw new Error(`Position not found: ${positionId}`);
    }
    return position;
  }

  if (!symbol) {
    throw new Error("Provide either positionId or symbol");
  }

  const filter: Record<string, unknown> = { symbol };
  if (accountId) filter.accountId = accountId;
  if (status) filter.status = status;

  const matches = (await Position.find(filter)
    .sort({ openedAt: -1 })
    .limit(2)
    .lean()
    .exec()) as PositionRecord[];

  if (matches.length === 0) {
    throw new Error(
      `Position not found for symbol ${symbol}${accountId ? ` on account ${accountId}` : ""}`,
    );
  }

  if (matches.length > 1 && !accountId && !status) {
    throw new Error(
      `Multiple positions found for symbol ${symbol}. Pass positionId or accountId.`,
    );
  }

  return matches[0];
}

export async function getLivePositionSnapshot(position: PositionRecord): Promise<{
  exchange: ExchangeClient;
  currentPrice: number;
  pnlPercent: number;
  exchangePosition: Awaited<ReturnType<ExchangeClient["getOpenPositions"]>>[number] | null;
}> {
  const exchange = await resolveExchangeContext({
    accountId: position.accountId,
  });
  const exchangePositions = await exchange.exchange.getOpenPositions();
  const matchingSide = position.side === "LONG" ? "LONG" : "SHORT";
  const exchangePosition =
    exchangePositions.find(
      (item) => item.symbol === position.symbol && item.side === matchingSide,
    ) ||
    exchangePositions.find((item) => item.symbol === position.symbol) ||
    null;
  const currentPrice =
    exchangePosition?.markPrice ||
    (await exchange.exchange.getTickerPrice(position.symbol));
  const pnlPercent = calculatePositionPnlPercent(position, currentPrice);

  return {
    exchange: exchange.exchange,
    currentPrice,
    pnlPercent,
    exchangePosition,
  };
}

export function getSourceContextForAccount(account: AccountRecord): SourceContext {
  const sourceType = normalizeSourceType(account.sourceType);
  if (!sourceType) {
    throw new Error(
      `Signal source account "${account.name}" (${String(account._id)}) does not have a valid sourceType`,
    );
  }

  return {
    provider: SourceFactory.getProvider(sourceType),
    config: getSourceConfigForAccount(account),
    accountId: String(account._id),
    accountName: account.name,
    sourceType,
  };
}

export function serializeSourceMessages(messages: BaseSourceMessage[]) {
  return messages.map((message) => ({
    messageId: message.messageId,
    channelId: message.channelId,
    author: message.author,
    content: message.content,
    originalContent: message.originalContent,
    timestamp: message.timestamp,
    messageUrl: message.messageUrl,
    imageUrls: message.imageUrls,
    isReply: message.isReply || false,
    sourceId: message.sourceId,
    sourceName: message.sourceName,
  }));
}

export async function resolveExchangeContext(
  args: ToolArgs = {},
): Promise<ExchangeContext> {
  await connectDB();
  const requestedAccountId = getAccountIdFromArgs(args);

  let selectedAccount: AccountRecord | null = null;

  if (requestedAccountId) {
    selectedAccount = (await Account.findById(requestedAccountId)
      .lean()
      .exec()) as AccountRecord | null;

    if (!selectedAccount) {
      throw new Error(`Trading account not found: ${requestedAccountId}`);
    }
  } else {
    const candidates = (await Account.find({ isActive: true })
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as AccountRecord[];
    const tradable = candidates.filter((acc) =>
      Boolean(normalizeExchangeProvider(acc.tradingPlatform)),
    );

    if (tradable.length === 0) {
      throw new Error(
        "No active trading accounts found. Configure an account with tradingPlatform first.",
      );
    }

    if (tradable.length > 1) {
      const accountList = tradable
        .map((acc) => `${acc.name} (${String(acc._id)})`)
        .join(", ");
      throw new Error(
        `Multiple trading accounts are active. Pass accountId in tool args. Available: ${accountList}`,
      );
    }

    selectedAccount = tradable[0];
  }

  const credentials = toExchangeCredentials(selectedAccount);
  const exchange = ExchangeFactory.getClientForAccount(credentials);

  return {
    exchange,
    provider: credentials.provider,
    accountId: String(selectedAccount._id),
    accountName: selectedAccount.name,
  };
}
