import type {
  AccountInfo as ExchangeAccountInfo,
  AlgoOrderInfo,
  OpenOrderInfo,
  PositionInfo,
} from "../exchange/types";

export type AnalysisContextSnapshot = {
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

export function roundContextNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

export function formatAnalysisContextBlock(snapshot: AnalysisContextSnapshot): string {
  return [
    "[LIVE ACCOUNT CONTEXT]",
    `Current time: ${snapshot.builtAt}`,
    `Account: ${snapshot.accountName} | source=${snapshot.sourceType} | exchange=${snapshot.tradingPlatform}`,
    formatBalance(snapshot),
    "Live positions:",
    ...formatLivePositions(snapshot),
    "Open orders:",
    ...formatOpenOrders(snapshot),
    "Algo orders:",
    ...formatAlgoOrders(snapshot),
    "Tracked DB positions:",
    ...formatTrackedPositions(snapshot),
    "Pending drafts:",
    ...formatPendingDrafts(snapshot),
    "[END LIVE ACCOUNT CONTEXT]",
  ].join("\n");
}

export function buildAnalysisContextErrorBlock(errorMessage: string) {
  return [
    "[LIVE ACCOUNT CONTEXT]",
    `Current time: ${new Date().toISOString()}`,
    `Failed to load live account context: ${errorMessage}`,
    "[END LIVE ACCOUNT CONTEXT]",
  ].join("\n");
}

function formatBalance(snapshot: AnalysisContextSnapshot) {
  if (!snapshot.accountInfo) return "Balance: unavailable";
  return `Balance: total=${roundContextNumber(snapshot.accountInfo.totalBalance)} | available=${roundContextNumber(snapshot.accountInfo.availableBalance)} | pnl=${roundContextNumber(snapshot.accountInfo.unrealizedPnl)}`;
}

function formatLivePositions(snapshot: AnalysisContextSnapshot) {
  if (!snapshot.livePositions.length) return ["- none"];
  return snapshot.livePositions.map((position) => {
    const currentPrice = roundContextNumber(snapshot.currentPrices[position.symbol]) ?? roundContextNumber(position.markPrice);
    const algoOrders = snapshot.liveAlgoOrders.filter((order) => order.symbol === position.symbol);
    const tracked = snapshot.trackedPositions.filter((item) => item.symbol === position.symbol);
    return [
      `- ${position.symbol} ${position.side}`,
      `entry=${roundContextNumber(position.entryPrice)}`,
      `mark=${currentPrice}`,
      `qty=${roundContextNumber(position.quantity)}`,
      `lev=${roundContextNumber(position.leverage)}`,
      `tpOrders=${formatTriggerOrders(algoOrders, "tp")}`,
      `slOrders=${formatTriggerOrders(algoOrders, "sl")}`,
      `trackedSL=${tracked.map((item) => roundContextNumber(item.stopLossPrice)).filter(Boolean).join("/") || "none"}`,
      `trackedTP=${tracked.flatMap((item) => item.takeProfitTargets || []).map((target) => `${roundContextNumber(target.price)}(${target.status || "pending"})`).join("/") || "none"}`,
    ].join(" | ");
  });
}

function formatOpenOrders(snapshot: AnalysisContextSnapshot) {
  if (!snapshot.liveOpenOrders.length) return ["- none"];
  return snapshot.liveOpenOrders.map((order) => `- ${order.symbol} ${order.side} ${order.type} | orderPrice=${roundContextNumber(order.price)} | current=${roundContextNumber(snapshot.currentPrices[order.symbol])} | qty=${roundContextNumber(order.quantity)} | filled=${roundContextNumber(order.filledQuantity)} | status=${order.status}`);
}

function formatAlgoOrders(snapshot: AnalysisContextSnapshot) {
  if (!snapshot.liveAlgoOrders.length) return ["- none"];
  return snapshot.liveAlgoOrders.map((order) => `- ${order.symbol} ${order.side} ${order.type} | trigger=${roundContextNumber(order.triggerPrice)} | order=${roundContextNumber(order.executePrice)} | qty=${roundContextNumber(order.quantity)} | status=${order.status}`);
}

function formatTrackedPositions(snapshot: AnalysisContextSnapshot) {
  if (!snapshot.trackedPositions.length) return ["- none"];
  return snapshot.trackedPositions.map((position) => `- ${position.symbol} ${position.side} ${position.status} | entry=${roundContextNumber(position.entryPrice)} | current=${roundContextNumber(position.currentPrice)} | qty=${roundContextNumber(position.quantity)} | lev=${roundContextNumber(position.leverage)} | pnl=${roundContextNumber(position.pnl)} | sl=${roundContextNumber(position.stopLossPrice)} | tp=${(position.takeProfitTargets || []).map((target) => `${roundContextNumber(target.price)}(${target.status || "pending"})`).join("/") || "none"}`);
}

function formatPendingDrafts(snapshot: AnalysisContextSnapshot) {
  if (!snapshot.pendingDrafts.length) return ["- none"];
  return snapshot.pendingDrafts.map((draft) => `- ${draft.symbol} ${draft.action} ${draft.side} | entry=${roundContextNumber(draft.entryPrice)} | sl=${roundContextNumber(draft.stopLoss)} | tp=${(draft.takeProfitTargets || []).map(roundContextNumber).join("/") || "none"} | lev=${roundContextNumber(draft.leverage)} | qty=${roundContextNumber(draft.quantity)}`);
}

function formatTriggerOrders(orders: AlgoOrderInfo[], token: string) {
  return orders
    .filter((order) => order.type.toLowerCase().includes(token))
    .map((order) => roundContextNumber(order.triggerPrice))
    .join("/") || "none";
}
