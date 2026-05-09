import OpenAI from "openai";
import { getCodexPatunginConfig } from "@copytrade/shared/lib/ai/CodexPatunginConfig";
import {
  Account,
  Position,
  AgentTurn,
  connectDB,
  type IPosition,
} from "@copytrade/shared/lib/database";
import {
  ExchangeFactory,
  buildExchangeCredentials,
} from "@copytrade/shared/lib/exchange/ExchangeFactory";
import type { ExchangeClient } from "@copytrade/shared/lib/exchange/types";
import { inspectPendingLimitOrder } from "@copytrade/shared/lib/pending-order-sync";
import { getSignalConfig } from "@copytrade/shared/lib/signal-config";
import {
  logExecutorError,
  logExecutorInfo,
  logExecutorWarn,
  logProcessStep,
} from "@copytrade/shared/lib/process-log";
import { ensurePersistedProcessId } from "@copytrade/shared/lib/process-id";
import { createTradeLog } from "@copytrade/shared/lib/trade-log-store";
import { agentTools, toolImplementations } from "./tools";
import { getAgentToolPolicy } from "./policies";

const MONITOR_TOOL_NAMES = new Set([
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

const MAX_AGENT_ITERATIONS = 10;
const MAX_VISION_IMAGES_PER_TOOL = 3;

const VISION_CAPABLE_PROVIDERS = new Set([
  "openai",
  "kimi",
  "codex",
  "patungin",
]);

function extractImageUrlsFromToolResult(
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

type PositionDocLike = IPosition;

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type InternalToolTrace = {
  toolName: string;
  toolArgs: Record<string, unknown>;
  mode: "read" | "mutating";
  status: "executed" | "failed" | "invalid_args" | "unknown_tool" | "denied";
  result?: string;
  error?: string;
};

type InternalAgentResult = {
  response: string;
  toolTraces: InternalToolTrace[];
  iterations: number;
  provider: string;
  model: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAccountPositionKey(
  accountId: string | undefined,
  symbol: string,
  side?: string,
): string {
  return `${accountId || "__global__"}::${symbol}::${side || "__any__"}`;
}

function buildAllowedTools() {
  return agentTools.filter((tool) => {
    const toolName = tool.function?.name;
    return typeof toolName === "string" && MONITOR_TOOL_NAMES.has(toolName);
  });
}

function resolveProviderConfig(provider?: string) {
  const codexPatunginCfg = getCodexPatunginConfig();
  const selectedProvider = (
    provider ||
    process.env.AI_PROVIDER ||
    (codexPatunginCfg.apiKey ? "patungin" : "glm")
  )
    .toLowerCase()
    .trim();

  const rawApiKey =
    selectedProvider === "kimi"
      ? process.env.ANTHROPIC_API_KEY
      : selectedProvider === "openai"
        ? process.env.OPENAI_API_KEY
        : selectedProvider === "codex" || selectedProvider === "patungin"
          ? codexPatunginCfg.apiKey
          : process.env.GLM_API_KEY;

  const baseURL =
    selectedProvider === "kimi"
      ? process.env.ANTHROPIC_BASE_URL || "https://api.kimi.com/coding/"
      : selectedProvider === "openai"
        ? process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
        : selectedProvider === "codex" || selectedProvider === "patungin"
          ? codexPatunginCfg.baseURL
          : process.env.GLM_BASE_URL || "https://api.z.ai/api/coding/paas/v4";

  const model =
    selectedProvider === "kimi"
      ? process.env.ANTHROPIC_MODEL || "kimi-latest"
      : selectedProvider === "openai"
        ? process.env.OPENAI_MODEL || "gpt-4o-mini"
        : selectedProvider === "codex" || selectedProvider === "patungin"
          ? codexPatunginCfg.model
          : process.env.GLM_MODEL || "glm-4-flash";

  const providerHeaders =
    selectedProvider === "codex" || selectedProvider === "patungin"
      ? codexPatunginCfg.headers
      : undefined;

  const apiKeys = (rawApiKey || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    selectedProvider,
    baseURL,
    model,
    providerHeaders,
    apiKeys,
  };
}

async function createChatCompletion(
  messages: OpenAI.ChatCompletionMessageParam[],
  provider?: string,
) {
  const config = resolveProviderConfig(provider);
  if (config.apiKeys.length === 0) {
    throw new Error(
      "No valid API keys configured for the selected AI provider.",
    );
  }

  let currentKeyIndex = 0;
  while (currentKeyIndex < config.apiKeys.length) {
    const client = new OpenAI({
      apiKey: config.apiKeys[currentKeyIndex],
      baseURL: config.baseURL,
      ...(config.providerHeaders &&
      Object.keys(config.providerHeaders).length > 0
        ? { defaultHeaders: config.providerHeaders }
        : {}),
    });

    try {
      const completion = await client.chat.completions.create({
        model: config.model,
        messages,
        tools: buildAllowedTools(),
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 1800,
      });

      return {
        completion,
        provider: config.selectedProvider,
        model: config.model,
      };
    } catch (error) {
      const message = getErrorMessage(error).toLowerCase();
      const retryable =
        message.includes("401") ||
        message.includes("403") ||
        message.includes("429") ||
        message.includes("token expired") ||
        message.includes("invalid") ||
        message.includes("balance");

      if (!retryable || currentKeyIndex === config.apiKeys.length - 1) {
        throw error;
      }

      currentKeyIndex += 1;
    }
  }

  throw new Error("No response from AI provider.");
}

function parseToolArgs(input: string): Record<string, unknown> {
  if (!input || input.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(input);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

async function runInternalPositionAgent(input: {
  processId: string;
  systemPrompt: string;
  userPrompt: string;
  provider?: string;
  visionImagesEnabled?: boolean;
}): Promise<InternalAgentResult> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.userPrompt },
  ];
  const toolTraces: InternalToolTrace[] = [];
  let finalResponse = "";
  let usedProvider = "";
  let usedModel = "";

  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    const { completion, provider, model } = await createChatCompletion(
      messages,
      input.provider,
    );
    usedProvider = provider;
    usedModel = model;

    const assistantMessage = completion.choices[0]?.message;
    if (!assistantMessage) {
      throw new Error("No assistant message returned by the model.");
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content || "",
      tool_calls: assistantMessage.tool_calls,
    } as OpenAI.ChatCompletionAssistantMessageParam);

    const toolCalls = (assistantMessage.tool_calls || [])
      .filter((toolCall) => toolCall.type === "function")
      .map(
        (toolCall): PendingToolCall => ({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        }),
      );

    if (toolCalls.length === 0) {
      finalResponse =
        typeof assistantMessage.content === "string"
          ? assistantMessage.content
          : finalResponse;
      return {
        response: finalResponse,
        toolTraces,
        iterations: iteration + 1,
        provider: usedProvider,
        model: usedModel,
      };
    }

    for (const toolCall of toolCalls) {
      const policy = getAgentToolPolicy(toolCall.name);
      let toolArgs: Record<string, unknown> = {};

      try {
        toolArgs = parseToolArgs(toolCall.arguments);
      } catch (error) {
        const errorResult = JSON.stringify({
          error: `Invalid tool arguments for ${toolCall.name}: ${getErrorMessage(error)}`,
        });
        toolTraces.push({
          toolName: toolCall.name,
          toolArgs: {},
          mode: policy?.mode || "read",
          status: "invalid_args",
          error: errorResult,
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: errorResult,
        });
        continue;
      }

      if (!policy) {
        const errorResult = JSON.stringify({
          error: `No policy configured for tool ${toolCall.name}`,
        });
        toolTraces.push({
          toolName: toolCall.name,
          toolArgs,
          mode: "read",
          status: "denied",
          error: errorResult,
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: errorResult,
        });
        continue;
      }

      const executor = toolImplementations[toolCall.name];
      if (!executor) {
        const errorResult = JSON.stringify({
          error: `Unknown tool ${toolCall.name}`,
        });
        toolTraces.push({
          toolName: toolCall.name,
          toolArgs,
          mode: policy.mode,
          status: "unknown_tool",
          error: errorResult,
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: errorResult,
        });
        continue;
      }

      try {
        const result = await executor(toolArgs);
        toolTraces.push({
          toolName: toolCall.name,
          toolArgs,
          mode: policy.mode,
          status: "executed",
          result,
        });
        console.log(
          `[PositionMonitor]   🔧 ${policy.mode === "mutating" ? "✏️" : "👁️"} ${toolCall.name}(${JSON.stringify(toolArgs).slice(0, 120)}) → ${policy.mode} OK`,
        );
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });

        // Inject Discord images as vision content if provider supports it and setting is enabled
        const imageUrls = extractImageUrlsFromToolResult(toolCall.name, result);
        if (
          imageUrls.length > 0 &&
          input.visionImagesEnabled &&
          VISION_CAPABLE_PROVIDERS.has(usedProvider)
        ) {
          console.log(
            `[PositionMonitor]   🖼️ Injecting ${imageUrls.length} image(s) from Discord for vision analysis`,
          );
          const imageContent: OpenAI.ChatCompletionContentPart[] = [
            {
              type: "text",
              text: `[System] Here are the chart images from the Discord signal thread for your visual analysis. Use them to assess the trade setup quality and current market context:`,
            },
            ...imageUrls.map(
              (url): OpenAI.ChatCompletionContentPartImage => ({
                type: "image_url",
                image_url: { url, detail: "low" },
              }),
            ),
          ];
          messages.push({
            role: "user",
            content: imageContent,
          });
        }
      } catch (error) {
        const errorResult = JSON.stringify({
          error: getErrorMessage(error),
        });
        toolTraces.push({
          toolName: toolCall.name,
          toolArgs,
          mode: policy.mode,
          status: "failed",
          error: errorResult,
        });
        console.log(
          `[PositionMonitor]   ❌ ${toolCall.name}(${JSON.stringify(toolArgs).slice(0, 120)}) → ${getErrorMessage(error)}`,
        );
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: errorResult,
        });
      }
    }
  }

  return {
    response:
      finalResponse ||
      '{"status":"max_iterations","decisionSummary":"Reached maximum monitoring reasoning steps","actionsTaken":[],"followUp":["Review the position manually if repeated loops occur."]}',
    toolTraces,
    iterations: MAX_AGENT_ITERATIONS,
    provider: usedProvider,
    model: usedModel,
  };
}

function buildPositionMonitorSystemPrompt(): string {
  return `You are the autonomous position-monitoring agent for a crypto copy-trading system.

You can inspect live exchange state, tracked database state, Discord signal context, and mutate position protection. You may use multiple tools and execute multiple actions in one run.

Your priorities, in order:
1. Keep the tracked position synced with the live exchange.
2. Ensure live TP/SL protection is correct and up to date on the exchange.
3. Protect capital without prematurely killing valid trades.
4. Remove stale orphan TP/SL orders that can interfere with future entries.

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

function buildPositionMonitorUserPrompt(
  position: PositionDocLike,
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

async function getExchangeForPosition(position: {
  accountId?: string;
}): Promise<ExchangeClient> {
  if (position.accountId) {
    const account = await Account.findById(position.accountId).lean();
    if (account?.exchangeData) {
      const creds = buildExchangeCredentials(
        account.tradingPlatform,
        account.exchangeData as Record<string, unknown>,
      );
      if (creds) {
        return ExchangeFactory.getClientForAccount(creds);
      }
    }
  }

  return ExchangeFactory.getPaperClient();
}

async function syncPendingPositions(result: {
  actions: number;
  errors: string[];
  syncedClosed: number;
}) {
  const pendingPositions = (await Position.find({
    status: "pending",
  })) as PositionDocLike[];
  if (pendingPositions.length === 0) {
    return;
  }

  await logExecutorInfo(
    `⏳ Position monitor agent checking ${pendingPositions.length} pending positions`,
    {
      type: "monitor",
      action: "pending_positions_check",
      level: "debug",
    },
  );

  for (const position of pendingPositions) {
    const processId = await ensurePersistedProcessId(position, "pendmon");

    try {
      const exchange = await getExchangeForPosition(position);
      const inspection = await inspectPendingLimitOrder(exchange, position);

      if (inspection.type === "live") {
        continue;
      }

      if (inspection.type === "cancelled") {
        position.status = "closed";
        position.closedAt = new Date();
        position.closeReason = inspection.reason;
        await position.save();
        result.syncedClosed++;
        continue;
      }

      position.status = "open";
      if (inspection.fillPrice && inspection.fillPrice > 0) {
        position.entryPrice = inspection.fillPrice;
      }
      await position.save();
      result.actions++;

      await logProcessStep({
        accountId: position.accountId,
        processId,
        type: "monitor",
        action: "limit_filled",
        symbol: position.symbol,
        details: `Limit order filled on exchange. Promoted to open. Fill price: ${position.entryPrice}. ${inspection.reason}`,
        result: "success",
      });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      result.errors.push(`Pending ${position.symbol}: ${errMsg}`);
      await logExecutorError(
        `Error checking pending position ${position.symbol}: ${errMsg}`,
        {
          accountId: position.accountId,
          processId,
          symbol: position.symbol,
          type: "monitor",
          action: "pending_position_check_error",
        },
      );
    }
  }
}

async function buildExchangePositionMap(openPositions: PositionDocLike[]) {
  const openByAccount = new Map<string, PositionDocLike[]>();
  for (const position of openPositions) {
    const key = position.accountId || "__global__";
    if (!openByAccount.has(key)) {
      openByAccount.set(key, []);
    }
    openByAccount.get(key)!.push(position);
  }

  const exchangePositions = new Map<
    string,
    {
      markPrice: number;
      unrealizedPnl: number;
      entryPrice: number;
      quantity: number;
      side?: string;
    }
  >();

  for (const [, positions] of openByAccount) {
    const exchange = await getExchangeForPosition(positions[0]);

    try {
      const livePositions = await exchange.getOpenPositions();
      for (const livePosition of livePositions) {
        exchangePositions.set(
          getAccountPositionKey(
            positions[0].accountId,
            livePosition.symbol,
            livePosition.side,
          ),
          {
            markPrice: livePosition.markPrice,
            unrealizedPnl: livePosition.unrealizedPnl,
            entryPrice: livePosition.entryPrice,
            quantity: livePosition.quantity,
            side: livePosition.side,
          },
        );
      }
    } catch (error) {
      await logExecutorWarn(
        `⚠️ Failed to fetch exchange positions for account ${positions[0].accountId || "__global__"}: ${getErrorMessage(error)}`,
        {
          accountId: positions[0].accountId,
          type: "monitor",
          action: "exchange_positions_fetch_failed",
        },
      );
    }
  }

  return exchangePositions;
}

async function syncClosedPositions(
  openPositions: PositionDocLike[],
  exchangePositions: Map<
    string,
    {
      markPrice: number;
      unrealizedPnl: number;
      entryPrice: number;
      quantity: number;
      side?: string;
    }
  >,
  result: { syncedClosed: number },
) {
  if (openPositions.length === 0) {
    console.log("[PositionMonitor] No open positions to sync");
    return;
  }

  const syncSummary: string[] = [];

  for (const position of openPositions) {
    const exactKey = getAccountPositionKey(
      position.accountId,
      position.symbol,
      position.side,
    );
    const fallbackKey = getAccountPositionKey(
      position.accountId,
      position.symbol,
    );

    if (exchangePositions.has(exactKey) || exchangePositions.has(fallbackKey)) {
      const matchedKey = exchangePositions.has(exactKey)
        ? exactKey
        : fallbackKey;
      const liveData = exchangePositions.get(matchedKey)!;
      console.log(
        `[PositionMonitor] ✅ ${position.symbol} ${position.side} — still on exchange (markPrice=${liveData.markPrice}, unrealizedPnl=${liveData.unrealizedPnl})`,
      );
      syncSummary.push(`${position.symbol} ${position.side}: open`);
      continue;
    }

    const processId = await ensurePersistedProcessId(position, "syncmon");
    position.status = "closed";
    position.closedAt = new Date();
    position.closeReason = "Closed on Exchange (external)";
    await position.save();

    console.log(
      `[PositionMonitor] 🔒 ${position.symbol} ${position.side} — NOT on exchange, marking closed in DB`,
    );

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "monitor",
      action: "sync_close",
      symbol: position.symbol,
      details: `Position ${position.side} ${position.symbol} was closed on the exchange externally. Marked as closed in DB.`,
      result: "success",
    });

    await createTradeLog({
      accountId: position.accountId,
      processId,
      type: "position_monitor",
      action: "sync_closed",
      symbol: position.symbol,
      details: `${position.side} ${position.symbol} no longer on exchange — marked closed in DB (externally closed)`,
      level: "info",
      result: "closed",
    }).catch(() => {});

    result.syncedClosed++;
    syncSummary.push(`${position.symbol} ${position.side}: synced-closed`);
  }

  console.log(
    `[PositionMonitor] Sync summary: ${syncSummary.length} positions checked, ${result.syncedClosed} closed externally`,
  );
}

async function cleanupOrphanProtectionForAccounts(
  positions: PositionDocLike[],
  result: { actions: number; errors: string[] },
) {
  const uniqueAccountIds = [
    ...new Set(
      positions
        .map((position) => position.accountId)
        .filter((accountId): accountId is string => Boolean(accountId)),
    ),
  ];

  for (const accountId of uniqueAccountIds) {
    try {
      const raw = await toolImplementations.cleanup_orphan_protection_orders({
        accountId,
        dryRun: false,
      });
      const parsed = JSON.parse(raw) as {
        cleanupResults?: Array<{ cancelled?: string[] }>;
      };
      const cancelledCount =
        parsed.cleanupResults?.reduce(
          (sum, item) => sum + (item.cancelled?.length || 0),
          0,
        ) || 0;
      result.actions += cancelledCount;
    } catch (error) {
      result.errors.push(`Cleanup ${accountId}: ${getErrorMessage(error)}`);
    }
  }
}

async function runPositionAgentForDoc(
  position: PositionDocLike,
  visionImagesEnabled: boolean,
) {
  const processId = await ensurePersistedProcessId(position, "posagent");

  console.log(
    `[PositionMonitor] 🤖 Running agent for ${position.symbol} ${position.side} (entry=${position.entryPrice}, qty=${position.quantity}, SL=${position.stopLossPrice || "none"}, accountId=${position.accountId || "none"})`,
  );

  await logProcessStep({
    accountId: position.accountId,
    processId,
    type: "monitor",
    action: "position_monitor_agent_started",
    symbol: position.symbol,
    details: {
      positionId: String(position._id),
      currentTime: new Date().toISOString(),
      accountId: position.accountId || null,
    },
    result: "processing",
  });

  const agentResult = await runInternalPositionAgent({
    processId,
    systemPrompt: buildPositionMonitorSystemPrompt(),
    userPrompt: buildPositionMonitorUserPrompt(position, processId),
    visionImagesEnabled,
  });

  try {
    await AgentTurn.create({
      sessionId: "position-monitor-session",
      processId,
      role: "admin",
      provider: agentResult.provider,
      status: "completed",
      userMessage: buildPositionMonitorUserPrompt(position, processId),
      assistantResponse: agentResult.response,
      history: [],
      messages: [],
      pendingToolCalls: [],
      toolTraces: agentResult.toolTraces,
      startedAt: new Date(),
      completedAt: new Date(),
    });
  } catch (err) {
    // Just swallow if the unique processId already exists or fails
  }

  await logProcessStep({
    accountId: position.accountId,
    processId,
    type: "monitor",
    action: "position_monitor_agent_completed",
    symbol: position.symbol,
    details: {
      response: agentResult.response,
      toolTraces: agentResult.toolTraces,
      iterations: agentResult.iterations,
      provider: agentResult.provider,
      model: agentResult.model,
    },
    result: "success",
  });

  return agentResult;
}

export async function runPositionMonitorAgent(): Promise<{
  checked: number;
  actions: number;
  errors: string[];
  syncedClosed: number;
}> {
  await connectDB();

  const result = {
    checked: 0,
    actions: 0,
    errors: [] as string[],
    syncedClosed: 0,
  };

  try {
    const initialOpenPositions = (await Position.find({
      status: "open",
    })) as PositionDocLike[];
    result.checked = initialOpenPositions.length;

    await logExecutorInfo(
      `🤖 Monitoring ${initialOpenPositions.length} open positions with autonomous agent`,
      {
        type: "monitor",
        action: "monitor_started",
        level: "debug",
      },
    );

    await syncPendingPositions(result);

    const openPositions = (await Position.find({
      status: "open",
    })) as PositionDocLike[];
    const exchangePositions = await buildExchangePositionMap(openPositions);
    await syncClosedPositions(openPositions, exchangePositions, result);

    const activePositions = (await Position.find({
      status: "open",
    })) as PositionDocLike[];
    await cleanupOrphanProtectionForAccounts(activePositions, result);

    // Read DB settings for vision image support in position monitor
    const signalCfg = await getSignalConfig();
    const visionImagesEnabled = signalCfg.monitorVisionImages;

    for (const position of activePositions) {
      try {
        const agentResult = await runPositionAgentForDoc(
          position,
          visionImagesEnabled,
        );
        const mutatingActions = agentResult.toolTraces.filter(
          (trace) => trace.mode === "mutating" && trace.status === "executed",
        ).length;
        const readActions = agentResult.toolTraces.filter(
          (trace) => trace.mode === "read" && trace.status === "executed",
        ).length;
        const failedActions = agentResult.toolTraces.filter(
          (trace) => trace.status === "failed",
        ).length;

        // Parse the agent's final decision for logging
        let decisionSummary = "unknown";
        let agentStatus = "unknown";
        try {
          const parsed = JSON.parse(agentResult.response);
          decisionSummary = parsed.decisionSummary || decisionSummary;
          agentStatus = parsed.status || agentStatus;
        } catch {
          // use defaults
        }

        console.log(
          `[PositionMonitor] 📋 ${position.symbol} ${position.side} agent done: status=${agentStatus}, tools=[${readActions} read, ${mutatingActions} mutate${failedActions > 0 ? `, ${failedActions} failed` : ""}], iterations=${agentResult.iterations}, decision="${decisionSummary}"`,
        );

        const toolSummary = agentResult.toolTraces
          .map((t) => `${t.toolName}:${t.status}`)
          .join(", ");

        await createTradeLog({
          accountId: position.accountId,
          processId: `posagent-${position.symbol}`,
          type: "position_monitor",
          action: "agent_decision",
          symbol: position.symbol,
          details: `${position.side} ${position.symbol} agent: status=${agentStatus}, iterations=${agentResult.iterations}, tools=[${toolSummary}], decision="${decisionSummary}"`,
          level: "info",
          result: agentStatus,
        }).catch(() => {});

        result.actions += mutatingActions;
      } catch (error) {
        const errMsg = getErrorMessage(error);
        result.errors.push(`${position.symbol}: ${errMsg}`);

        await createTradeLog({
          accountId: position.accountId,
          type: "position_monitor",
          action: "agent_error",
          symbol: position.symbol,
          details: `${position.side} ${position.symbol} agent failed: ${errMsg}`,
          level: "error",
          result: "error",
          error: errMsg,
        }).catch(() => {});

        await logExecutorError(
          `Position monitor agent failed for ${position.symbol}: ${errMsg}`,
          {
            accountId: position.accountId,
            symbol: position.symbol,
            type: "monitor",
            action: "position_monitor_agent_error",
          },
        );
      }
    }
  } catch (error) {
    const errMsg = getErrorMessage(error);
    result.errors.push(errMsg);
    await logExecutorError(`Position monitor agent error: ${errMsg}`, {
      type: "monitor",
      action: "monitor_error",
    });
  }

  console.log(
    `[PositionMonitor] ✅ Summary: checked=${result.checked}, syncedClosed=${result.syncedClosed}, actions=${result.actions}, errors=${result.errors.length}${result.errors.length > 0 ? ` [${result.errors.join(", ")}]` : ""}`,
  );

  await createTradeLog({
    type: "position_monitor",
    action: "monitor_summary",
    details: `checked=${result.checked}, syncedClosed=${result.syncedClosed}, actions=${result.actions}, errors=${result.errors.length}${result.errors.length > 0 ? ` [${result.errors.join(", ")}]` : ""}`,
    level: "info",
    result: result.errors.length > 0 ? "partial" : "success",
  }).catch(() => {});

  return result;
}
