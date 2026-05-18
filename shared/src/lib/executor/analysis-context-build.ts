import { Account, DraftTrade, Position } from "../database/index";
import {
  ExchangeFactory,
  ExchangeCredentials,
  buildExchangeCredentials,
} from "../exchange/ExchangeFactory";
import { logExecutorWarn, logProcessStep } from "../process/log";
import type { ProcessTrackedMessage } from "./types";
import type { AnalysisContextSnapshot } from "./analysis-context-format";
import { roundContextNumber } from "./analysis-context-format";

type AnalysisAccountRecord = {
  proxyAffinityKey?: string;
  name: string;
  sourceType?: string;
  tradingPlatform?: string;
  exchangeData?: Record<string, unknown> | null;
};

export async function buildAnalysisContextSnapshot(msg: ProcessTrackedMessage): Promise<AnalysisContextSnapshot> {
  const account = await Account.findById(msg.sourceId).lean();
  if (!account) throw new Error(`Account not found for sourceId=${msg.sourceId || "unknown"}`);

  const trackedPositions = await Position.find({ accountId: msg.sourceId }).sort({ openedAt: -1 }).lean();
  const pendingDrafts = await DraftTrade.find({ accountId: msg.sourceId, status: "pending" }).sort({ createdAt: -1 }).limit(10).lean();

  const exchange = ExchangeFactory.getClientForAccount(
    buildExchangeCredentialsFromAccount({
      proxyAffinityKey: String(msg.sourceId || ""),
      name: account.name,
      sourceType: String(account.sourceType || ""),
      tradingPlatform: account.tradingPlatform || undefined,
      exchangeData: (account.exchangeData as Record<string, unknown> | null) || null,
    }),
  );

  const accountInfo = await exchange.getAccountInfo();
  const livePositions = await exchange.getOpenPositions();
  const liveOpenOrders = await exchange.getOpenOrders();
  const liveAlgoOrders = await exchange.getAlgoOrders();
  const currentPrices = await loadCurrentPrices({ exchange, livePositions, liveOpenOrders, liveAlgoOrders, trackedPositions, msg });

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
        symbols: Object.keys(currentPrices),
      },
      result: "context_ready",
    });
  }

  return snapshot;
}

function buildExchangeCredentialsFromAccount(account: AnalysisAccountRecord): ExchangeCredentials {
  const credentials = buildExchangeCredentials(
    account.tradingPlatform,
    account.exchangeData || {},
    { proxyAffinityKey: account.proxyAffinityKey },
  );
  if (!credentials) {
    throw new Error(`Account "${account.name || "unknown"}" has invalid trading platform "${account.tradingPlatform || "unset"}"`);
  }
  return credentials;
}

async function loadCurrentPrices({ exchange, livePositions, liveOpenOrders, liveAlgoOrders, trackedPositions, msg }: any) {
  const symbols = Array.from(new Set([
    ...livePositions.map((item: any) => item.symbol),
    ...liveOpenOrders.map((item: any) => item.symbol),
    ...liveAlgoOrders.map((item: any) => item.symbol),
    ...trackedPositions.map((item: any) => item.symbol),
  ].filter(Boolean)));
  const currentPrices: Record<string, number> = {};
  for (const symbol of symbols) {
    try {
      currentPrices[symbol] = await exchange.getTickerPrice(symbol);
    } catch (error) {
      await logExecutorWarn(
        `⚠️ Failed to fetch live price for ${symbol} while building analysis context: ${error instanceof Error ? error.message : String(error)}`,
        { accountId: msg.sourceId, processId: msg.processId, symbol, action: "console_analysis_context_price_failed" },
      );
    }
  }
  return currentPrices;
}
