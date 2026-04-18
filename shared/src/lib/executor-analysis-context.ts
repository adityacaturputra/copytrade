import { Account, DraftTrade, Position } from "./database";
import {
  ExchangeFactory,
  ExchangeCredentials,
} from "./exchange/ExchangeFactory";
import type {
  AccountInfo as ExchangeAccountInfo,
  AlgoOrderInfo,
  OpenOrderInfo,
  PositionInfo,
} from "./exchange/types";
import {
  logExecutorWarn,
  logProcessStep,
} from "./process-log";
import type { ProcessTrackedMessage } from "./executor-types";

type AnalysisContextSnapshot = {
  builtAt: string;
  accountName: string;
  sourceType: string;
  tradingPlatform: string;
  accountInfo?: ExchangeAccountInfo;
  livePositions: PositionInfo[];
  liveOpenOrders: OpenOrderInfo[];
  liveAlgoOrders: AlgoOrderInfo[];
  trackedPositions: Array<{
    symbol: string;
    side: string;
    status: string;
    entryPrice: number;
    currentPrice?: number | null;
    quantity: number;
    leverage: number;
    pnl?: number | null;
    stopLossPrice?: number | null;
    takeProfitTargets?: Array<{
      price: number;
      quantity: number;
      percentage: number;
      status?: string;
    }>;
    orderId?: string | null;
    openedAt?: Date | null;
  }>;
  pendingDrafts: Array<{
    symbol: string;
    action: string;
    side: string;
    entryPrice?: number | null;
    stopLoss?: number | null;
    takeProfitTargets?: number[];
    leverage: number;
    quantity: number;
    createdAt?: Date | null;
  }>;
  currentPrices: Record<string, number>;
};

type AnalysisAccountRecord = {
  name: string;
  sourceType?: string;
  tradingPlatform?: string;
  exchangeData?: Record<string, unknown> | null;
};

function roundContextNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

function buildExchangeCredentialsFromAccount(
  account: AnalysisAccountRecord,
): ExchangeCredentials {
  const tradingPlatform = String(account.tradingPlatform || "")
    .trim()
    .toLowerCase();

  if (
    tradingPlatform !== "okx" &&
    tradingPlatform !== "binance" &&
    tradingPlatform !== "mexc" &&
    tradingPlatform !== "paper"
  ) {
    throw new Error(
      `Account "${account.name || "unknown"}" has invalid trading platform "${account.tradingPlatform || "unset"}"`,
    );
  }

  const exchangeData = (account.exchangeData || {}) as Record<string, unknown>;

  return {
    provider: tradingPlatform,
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
  } as ExchangeCredentials;
}

function formatAnalysisContextBlock(snapshot: AnalysisContextSnapshot): string {
  const livePositionsLines =
    snapshot.livePositions.length > 0
      ? snapshot.livePositions.map((position) => {
          const currentPrice =
            roundContextNumber(snapshot.currentPrices[position.symbol]) ??
            roundContextNumber(position.markPrice);
          const algoOrders = snapshot.liveAlgoOrders.filter(
            (order) => order.symbol === position.symbol,
          );
          const tpOrders = algoOrders.filter((order) =>
            order.type.toLowerCase().includes("tp"),
          );
          const slOrders = algoOrders.filter((order) =>
            order.type.toLowerCase().includes("sl"),
          );
          const tracked = snapshot.trackedPositions.filter(
            (item) => item.symbol === position.symbol,
          );

          return [
            `- ${position.symbol} ${position.side}`,
            `entry=${roundContextNumber(position.entryPrice)}`,
            `mark=${currentPrice}`,
            `qty=${roundContextNumber(position.quantity)}`,
            `lev=${roundContextNumber(position.leverage)}`,
            `margin=${roundContextNumber(position.margin)}`,
            `upl=${roundContextNumber(position.unrealizedPnl)}`,
            `liq=${roundContextNumber(position.liquidationPrice)}`,
            `tpOrders=${tpOrders.length > 0 ? tpOrders.map((order) => roundContextNumber(order.triggerPrice)).join("/") : "none"}`,
            `slOrders=${slOrders.length > 0 ? slOrders.map((order) => roundContextNumber(order.triggerPrice)).join("/") : "none"}`,
            tracked.length > 0
              ? `trackedSL=${tracked
                  .map((item) => roundContextNumber(item.stopLossPrice))
                  .filter(Boolean)
                  .join("/") || "none"}`
              : "trackedSL=none",
            tracked.length > 0
              ? `trackedTP=${tracked
                  .flatMap((item) => item.takeProfitTargets || [])
                  .map(
                    (target) =>
                      `${roundContextNumber(target.price)}(${target.status || "pending"})`,
                  )
                  .join("/") || "none"}`
              : "trackedTP=none",
          ].join(" | ");
        })
      : ["- none"];

  const liveOpenOrdersLines =
    snapshot.liveOpenOrders.length > 0
      ? snapshot.liveOpenOrders.map((order) => {
          const currentPrice = roundContextNumber(
            snapshot.currentPrices[order.symbol],
          );
          return `- ${order.symbol} ${order.side} ${order.type} | orderPrice=${roundContextNumber(order.price)} | current=${currentPrice} | qty=${roundContextNumber(order.quantity)} | filled=${roundContextNumber(order.filledQuantity)} | status=${order.status}`;
        })
      : ["- none"];

  const liveAlgoOrdersLines =
    snapshot.liveAlgoOrders.length > 0
      ? snapshot.liveAlgoOrders.map((order) => {
          const currentPrice = roundContextNumber(
            snapshot.currentPrices[order.symbol],
          );
          return `- ${order.symbol} ${order.side} ${order.type} | trigger=${roundContextNumber(order.triggerPrice)} | execute=${roundContextNumber(order.executePrice)} | current=${currentPrice} | qty=${roundContextNumber(order.quantity)} | status=${order.status}`;
        })
      : ["- none"];

  const trackedPositionsLines =
    snapshot.trackedPositions.length > 0
      ? snapshot.trackedPositions.map((position) => {
          return `- ${position.symbol} ${position.side} ${position.status} | entry=${roundContextNumber(position.entryPrice)} | current=${roundContextNumber(position.currentPrice)} | qty=${roundContextNumber(position.quantity)} | lev=${roundContextNumber(position.leverage)} | pnl=${roundContextNumber(position.pnl)} | sl=${roundContextNumber(position.stopLossPrice)} | tp=${(position.takeProfitTargets || []).map((target) => `${roundContextNumber(target.price)}(${target.status || "pending"})`).join("/") || "none"}`;
        })
      : ["- none"];

  const pendingDraftLines =
    snapshot.pendingDrafts.length > 0
      ? snapshot.pendingDrafts.map((draft) => {
          return `- ${draft.symbol} ${draft.action}/${draft.side} | entry=${roundContextNumber(draft.entryPrice)} | sl=${roundContextNumber(draft.stopLoss)} | tp=${(draft.takeProfitTargets || []).map((value) => roundContextNumber(value)).join("/") || "none"} | lev=${roundContextNumber(draft.leverage)} | qty=${roundContextNumber(draft.quantity)}`;
        })
      : ["- none"];

  return [
    "[LIVE ACCOUNT CONTEXT]",
    `Current time: ${snapshot.builtAt}`,
    `Account: ${snapshot.accountName}`,
    `Source type: ${snapshot.sourceType}`,
    `Trading platform: ${snapshot.tradingPlatform}`,
    `Balance: total=${roundContextNumber(snapshot.accountInfo?.totalBalance)} | available=${roundContextNumber(snapshot.accountInfo?.availableBalance)} | unrealizedPnl=${roundContextNumber(snapshot.accountInfo?.unrealizedPnl)} | currency=${snapshot.accountInfo?.currency || "unknown"}`,
    "Live exchange positions:",
    ...livePositionsLines,
    "Live open orders (includes pending limit orders):",
    ...liveOpenOrdersLines,
    "Live algo orders (TP/SL on exchange):",
    ...liveAlgoOrdersLines,
    "Tracked DB positions for this account:",
    ...trackedPositionsLines,
    "Pending drafts for this account:",
    ...pendingDraftLines,
    "[END LIVE ACCOUNT CONTEXT]",
  ].join("\n");
}

export async function buildMessageAnalysisContext(
  msg: ProcessTrackedMessage,
): Promise<string> {
  if (!msg.sourceId) {
    return "[LIVE ACCOUNT CONTEXT]\nNo source account is attached to this message.\n[END LIVE ACCOUNT CONTEXT]";
  }

  if (msg.processId) {
    await logProcessStep({
      accountId: msg.sourceId,
      processId: msg.processId,
      type: "draft_process",
      action: "analysis_context_started",
      details: {
        messageId: msg.messageId,
        sourceId: msg.sourceId,
      },
      result: "processing",
    });
  }

  try {
    const account = await Account.findById(msg.sourceId).lean();
    if (!account) {
      throw new Error(`Account not found: ${msg.sourceId}`);
    }

    const trackedPositions = await Position.find({
      accountId: msg.sourceId,
      status: { $in: ["open", "pending"] },
    })
      .sort({ openedAt: -1 })
      .lean();

    const pendingDrafts = await DraftTrade.find({
      accountId: msg.sourceId,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const exchange = ExchangeFactory.getClientForAccount(
      buildExchangeCredentialsFromAccount({
        name: account.name,
        sourceType: String(account.sourceType || ""),
        tradingPlatform: account.tradingPlatform || undefined,
        exchangeData:
          (account.exchangeData as Record<string, unknown> | null) || null,
      }),
    );

    const accountInfo = await exchange.getAccountInfo();
    const livePositions = await exchange.getOpenPositions();
    const liveOpenOrders = await exchange.getOpenOrders();
    const liveAlgoOrders = await exchange.getAlgoOrders();

    const symbols = Array.from(
      new Set(
        [
          ...livePositions.map((item) => item.symbol),
          ...liveOpenOrders.map((item) => item.symbol),
          ...liveAlgoOrders.map((item) => item.symbol),
          ...trackedPositions.map((item) => item.symbol),
        ].filter(Boolean),
      ),
    );

    const currentPrices: Record<string, number> = {};
    for (const symbol of symbols) {
      try {
        currentPrices[symbol] = await exchange.getTickerPrice(symbol);
      } catch (error) {
        await logExecutorWarn(
          `⚠️ Failed to fetch live price for ${symbol} while building analysis context: ${
            error instanceof Error ? error.message : String(error)
          }`,
          {
            accountId: msg.sourceId,
            processId: msg.processId,
            symbol,
            action: "console_analysis_context_price_failed",
          },
        );
      }
    }

    const snapshot: AnalysisContextSnapshot = {
      builtAt: new Date().toISOString(),
      accountName: account.name,
      sourceType: String(account.sourceType || "unknown"),
      tradingPlatform: String(account.tradingPlatform || "unknown"),
      accountInfo,
      livePositions,
      liveOpenOrders,
      liveAlgoOrders,
      trackedPositions: trackedPositions.map((position) => ({
        symbol: position.symbol,
        side: position.side,
        status: position.status,
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        quantity: position.quantity,
        leverage: position.leverage,
        pnl: position.pnl,
        stopLossPrice: position.stopLossPrice,
        takeProfitTargets: position.takeProfitTargets,
        orderId: position.orderId,
        openedAt: position.openedAt,
      })),
      pendingDrafts: pendingDrafts.map((draft) => ({
        symbol: draft.symbol,
        action: draft.action,
        side: draft.side,
        entryPrice: draft.entryPrice,
        stopLoss: draft.stopLoss,
        takeProfitTargets: draft.takeProfitTargets,
        leverage: draft.leverage,
        quantity: draft.quantity,
        createdAt: draft.createdAt,
      })),
      currentPrices,
    };

    if (msg.processId) {
      await logProcessStep({
        accountId: msg.sourceId,
        processId: msg.processId,
        type: "draft_process",
        action: "analysis_context_completed",
        details: {
          messageId: msg.messageId,
          accountName: account.name,
          tradingPlatform: account.tradingPlatform || null,
          balance: {
            total: roundContextNumber(accountInfo.totalBalance),
            available: roundContextNumber(accountInfo.availableBalance),
            unrealizedPnl: roundContextNumber(accountInfo.unrealizedPnl),
          },
          livePositionCount: livePositions.length,
          liveOpenOrderCount: liveOpenOrders.length,
          liveAlgoOrderCount: liveAlgoOrders.length,
          trackedPositionCount: trackedPositions.length,
          pendingDraftCount: pendingDrafts.length,
          symbols,
        },
        result: "context_ready",
      });
    }

    return formatAnalysisContextBlock(snapshot);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error || "Unknown error");

    if (msg.processId) {
      await logProcessStep({
        accountId: msg.sourceId,
        processId: msg.processId,
        type: "draft_process",
        action: "analysis_context_failed",
        details: {
          messageId: msg.messageId,
          sourceId: msg.sourceId,
        },
        result: "failed",
        error: errorMessage,
      });
    }

    await logExecutorWarn(
      `⚠️ Failed to build live account analysis context for ${msg.messageId}: ${errorMessage}`,
      {
        accountId: msg.sourceId,
        processId: msg.processId,
        action: "console_analysis_context_failed",
      },
    );

    return [
      "[LIVE ACCOUNT CONTEXT]",
      `Current time: ${new Date().toISOString()}`,
      `Failed to load live account context: ${errorMessage}`,
      "[END LIVE ACCOUNT CONTEXT]",
    ].join("\n");
  }
}
