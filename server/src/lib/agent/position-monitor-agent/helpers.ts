import {
  buildAIProviderChain,
  getAIProviderConfig,
  getDefaultAIProvider,
  isKnownAIProvider,
  normalizeAIProvider,
} from "@copytrade/shared/lib/ai/core/provider-registry";
import type { IPosition } from "@copytrade/shared/lib/database/index";

const MAX_VISION_IMAGES_PER_TOOL = 3;

export const MONITOR_TOOL_NAMES = new Set([
  "get_ticker_price",
  "get_open_positions",
  "get_exchange_positions",
  "get_open_orders",
  "get_algo_orders",
  "get_order_history",
  "analyze_position_context",
  "get_position_protection",
  "review_signal_thread",
  "sync_position_with_exchange",
  "manage_position",
  "adjust_position_protection",
  "cleanup_orphan_protection_orders",
]);

export function extractImageUrlsFromToolResult(
  toolName: string,
  result: string,
): string[] {
  if (toolName !== "review_signal_thread") return [];
  try {
    const parsed = JSON.parse(result) as {
      sourceContextMessages?: Array<{ imageUrls?: string[] }>;
    };
    const urls: string[] = [];
    for (const msg of parsed.sourceContextMessages || []) {
      for (const url of msg.imageUrls || []) {
        if (typeof url === "string" && url.startsWith("http")) {
          urls.push(url);
          if (urls.length >= MAX_VISION_IMAGES_PER_TOOL) return urls;
        }
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getAccountPositionKey(
  accountId: string | undefined,
  symbol: string,
  side?: string,
): string {
  return `${accountId || "__global__"}::${symbol}::${side || "__any__"}`;
}

export function resolveProviderConfig(provider?: string) {
  const normalized = normalizeAIProvider(
    provider || process.env.AI_PROVIDER || getDefaultAIProvider(),
  );
  const providerConfig = getAIProviderConfig(normalized);

  return {
    selectedProvider: normalized,
    baseURL: providerConfig.getBaseURL(),
    model: providerConfig.getModel(),
    providerHeaders: providerConfig.getHeaders?.(),
    apiKeys: providerConfig.getApiKeys(),
  };
}

export function parseAgentFallbackProviders(primary: string): string[] {
  return buildAIProviderChain(primary).slice(1);
}

export function buildAgentProviderChain(): string[] {
  return buildAIProviderChain();
}

export function buildPositionMonitorSystemPrompt(): string {
  return `You are an autonomous position-monitoring trading assistant operating against live exchange data and Discord trading signal context.

You must think step-by-step, use tools when needed, and take safe corrective actions when justified. You may take multiple actions in one run.

Your priorities, in order:
1. Keep the tracked position synced with the live exchange.
2. Ensure live TP/SL protection is correct and up to date on the exchange.
3. For PENDING limit orders: verify the limit order is still live on the exchange. If the Discord signal author has explicitly cancelled the trade, cancel the limit order on the exchange and close the tracked position.
4. Protect capital without prematurely killing valid trades.
5. Remove stale orphan TP/SL orders that can interfere with future entries.

Hard rules:
- Start with sync_position_with_exchange for the tracked position.
- Then inspect get_position_protection.
- Use analyze_position_context and review_signal_thread before discretionary close / TP / SL changes unless the exchange already shows the position is gone or clearly unprotected.
- NEVER close a position merely because price is near the stop loss or because a wick briefly touched the SL area. Price approaching or wicking near SL is NORMAL market behavior and NOT a reason to close.
- ONLY close a position when you have CONCRETE EVIDENCE such as:
  * The exchange no longer shows the position (it was already liquidated or closed externally).
  * The Discord signal author explicitly posted an exit/cancel update for this trade.
  * The position's stop loss or take profit was hit on the exchange (confirmed via exchange data).
  * The signal's original thesis is invalidated by clear, confirmed exchange data (not just price proximity to SL).
- For PENDING positions (limit orders that haven't filled yet):
  * Check get_open_orders to verify the limit order is still on the exchange.
  * If the Discord context shows a clear cancel request from the signal author, use manage_position with action "close" to cancel the limit order and mark the position as closed.
  * If the limit order has already been cancelled or expired on the exchange, sync the position status accordingly.
- If TP/SL protection is missing, stale, mismatched, or obviously leftover from an old setup, prefer repairing it with adjust_position_protection before discretionary closing.
- If stale orphan protection may exist on the same account, call cleanup_orphan_protection_orders with dryRun=true first; if orphan candidates are confirmed, you may call it again with dryRun=false.
- When calling manage_position with action "close" or "partial_close", you MUST provide a "reason" parameter with a specific, factual explanation referencing concrete evidence.
- Keep behavior consistent with the account's other open positions.

When review_signal_thread returns Discord messages with chart images, those images will be attached for your visual analysis. Use them to:
- Assess whether the chart pattern still supports the original trade thesis
- Identify key support/resistance levels visible in the charts
- Spot any obvious trend reversals or pattern breaks visible in the images
Do NOT base close decisions solely on image content — always cross-reference with live exchange data.

Your final answer must be a compact raw JSON object with this shape:
{
  "status": "ok|closed|synced|warning|max_iterations",
  "decisionSummary": "string",
  "actionsTaken": ["string"],
  "followUp": ["string"]
}`;
}

export function buildPositionMonitorUserPrompt(
  position: IPosition,
  processId: string,
): string {
  return `CURRENT TIME: ${new Date().toISOString()}
PROCESS ID: ${processId}
TRACKED POSITION:
- positionId: ${String(position._id)}
- accountId: ${position.accountId || "none"}
- symbol: ${position.symbol}
- side: ${position.side}
- status: ${position.status}
- entryPrice: ${position.entryPrice}
- quantity: ${position.quantity}
- leverage: ${position.leverage}
- trackedStopLoss: ${position.stopLossPrice || "none"}
- trackedTakeProfits: ${
    position.takeProfitTargets.length > 0
      ? position.takeProfitTargets
          .map(
            (target) =>
              `${target.price} qty=${target.quantity} status=${target.status}`,
          )
          .join("; ")
      : "none"
  }

Execute the full monitoring workflow for this tracked position. You may take multiple actions in one run. Repair stale or missing TP/SL when needed, and only close the trade when the live evidence or Discord context clearly supports that action.`;
}
