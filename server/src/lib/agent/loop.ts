import OpenAI from "openai";
import { getCodexPatunginConfig } from "@copytrade/shared/lib/ai/CodexPatunginConfig";
import { Account, type IAgentTurn, connectDB } from "@copytrade/shared/lib/database";
import { agentTools, toolImplementations } from "./tools";
import type { AgentRole } from "./auth";
import { getAgentApprovalRequired, hasRequiredAgentRole } from "./auth";
import { ensureAgentSession, createAgentTurn, createAgentTurnProcessId, loadAgentTurn, updateAgentTurnState, logAgentTurnEvent, buildToolTrace } from "./logging";
import { getAgentToolPolicy } from "./policies";

const MAX_ITERATIONS = 12;

type SourcePromptAccount = {
  _id: unknown;
  name: string;
  isActive: boolean;
  sourceType?: string;
  channelIds?: string[];
};

type ConversationHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type AgentChatMessage = OpenAI.ChatCompletionMessageParam;

export interface AgentStep {
  type: "thinking" | "tool_call" | "tool_result" | "response";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  duration?: number;
}

export interface AgentApprovalRequest {
  sessionId: string;
  processId: string;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  role: AgentRole;
  minimumRole: AgentRole;
}

export type AgentStreamEvent =
  | { type: "token"; token: string }
  | { type: "step"; step: AgentStep }
  | { type: "approval_required"; approval: AgentApprovalRequest }
  | {
      type: "done";
      response: string;
      sessionId: string;
      processId: string;
      status: "completed" | "awaiting_approval";
      steps: number;
      toolCalls: number;
    }
  | { type: "error"; error: string; sessionId: string; processId: string };

interface AgentRunInput {
  sessionId: string;
  role: AgentRole;
  provider?: string;
  history?: ConversationHistoryMessage[];
  userMessage?: string;
  processId?: string;
  signal?: AbortSignal;
  decision?: "approve" | "reject";
  userAgent?: string;
  ipAddress?: string;
}

const BASE_SYSTEM_PROMPT = `You are an intelligent trading assistant for a crypto copy-trading system. You have access to tools that let you:

📊 **Account & Market**: Check balances, get prices, view positions, get kline/candlestick data
📈 **Trading**: Place orders (market/limit), close positions, set leverage, set TP/SL
🔧 **Order Management**: Get/cancel open orders, get/cancel algo orders (TP/SL), modify TP/SL, view order history
📝 **Drafts**: Review, accept, or reject pending signal drafts
💬 **Signal Sources**: Inspect configured source accounts, check source health, fetch source messages, trigger manual signal checks
🧠 **Operator Tools**: Analyze one tracked position with AI context, manage a tracked position, review a signal thread, inspect process logs
🗄️ **Database**: View logs, signal history, position history
⚙️ **Settings**: Get/set trading mode, risk settings, calculate risk

**CRITICAL — Exact Enum Values for Tool Parameters:**
- Order side: MUST be exactly "BUY" or "SELL" (NOT "LONG" or "SHORT"). "BUY" opens long / closes short. "SELL" opens short / closes long.
- Order type: MUST be exactly "MARKET" or "LIMIT"
- Trading mode: MUST be exactly "auto" or "manual"
- When closing a position: use the OPPOSITE side (SELL for LONG positions, BUY for SHORT positions)

**Guidelines:**
- Always gather context FIRST before making trading decisions (check positions, account balance, current price)
- If there are multiple trading accounts, call get_trading_accounts first and then pass accountId to exchange tools
- If there are multiple signal source accounts, call get_signal_sources first and then pass accountId to source tools
- Exchange tools are selected per account via that account's tradingPlatform using ExchangeFactory
- Source tools are selected per account via that account's sourceType using SourceFactory
- Be helpful and explain what you're doing step by step
- When showing data, format it in a human-readable way (tables, summaries)
- High-risk and mutating tools are enforced server-side. If a mutating action needs confirmation, wait for approval flow rather than claiming it is already executed.
- Prefer high-level tools first when they match the task:
  - use analyze_position_context for "what should I do with this position?"
  - use manage_position for close / partial close / move SL / breakeven / trailing stop / move TP workflows
  - use sync_position_with_exchange when the user wants to reconcile DB state against live exchange state
  - use review_signal_thread for reconstructing a signal/update thread
  - use get_process_logs for debugging one processId
- If a tool returns an error, explain it clearly and suggest next steps
- Always show prices with appropriate decimal places (round to 2 decimals, e.g., 62333.34 not 62333.333333)
- When calculating or suggesting SL/TP prices, ALWAYS round to 2 decimal places

The exchange is determined by the selected account's tradingPlatform, not by a global env variable. Symbols must match that exchange format (e.g., BTC-USDT-SWAP for OKX, BTCUSDT for Binance/MEXC).`;

function cloneMessages(messages: AgentChatMessage[]): AgentChatMessage[] {
  return JSON.parse(JSON.stringify(messages)) as AgentChatMessage[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Agent request aborted");
  }
}

function isAbortError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("aborted") ||
    message.includes("aborterror") ||
    message.includes("request was aborted")
  );
}

async function buildSystemPrompt(role: AgentRole): Promise<string> {
  try {
    await connectDB();

    const sourceAccounts = (await Account.find({
      isActive: true,
      sourceType: { $exists: true, $ne: null },
    })
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as SourcePromptAccount[];

    const sourceLines = sourceAccounts
      .filter((account) => typeof account.sourceType === "string")
      .map((account) => {
        const channels = Array.isArray(account.channelIds)
          ? account.channelIds.length
          : 0;
        return `- ${account.name} (${account.sourceType}, accountId=${String(account._id)}, channels=${channels})`;
      });

    const roleSection = `\n\n**Current Operator Role:** ${role}\n- viewer: read-only tools only\n- operator: mutating tools allowed, but server approval is required\n- admin: full access, but mutating tools still require server approval when enabled`;

    const sourceSection =
      sourceLines.length > 0
        ? `\n\n**Configured Signal Sources Right Now:**\n${sourceLines.join("\n")}\n\n**Dynamic Source Example:**\n- "Check inputs from my configured sources" → get_signal_sources → check_source_health → fetch_source_messages → summarize by account name`
        : `\n\n**Configured Signal Sources Right Now:**\n- No active source accounts found in the database yet.\n\n**Dynamic Source Example:**\n- "Check inputs from my configured sources" → get_signal_sources → check_source_health → fetch_source_messages → summarize`;

    return `${BASE_SYSTEM_PROMPT}${roleSection}${sourceSection}`;
  } catch {
    return `${BASE_SYSTEM_PROMPT}\n\n**Current Operator Role:** ${role}`;
  }
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

async function* streamAssistantResponse(input: {
  messages: AgentChatMessage[];
  provider?: string;
  signal?: AbortSignal;
}): AsyncGenerator<
  | { type: "token"; token: string }
  | {
      type: "complete";
      provider: string;
      model: string;
      content: string;
      toolCalls: PendingToolCall[];
    }
> {
  const config = resolveProviderConfig(input.provider);
  if (config.apiKeys.length === 0) {
    throw new Error("No valid API keys configured for the selected AI provider.");
  }

  let currentKeyIndex = 0;

  while (currentKeyIndex < config.apiKeys.length) {
    throwIfAborted(input.signal);

    const client = new OpenAI({
      apiKey: config.apiKeys[currentKeyIndex],
      baseURL: config.baseURL,
      ...(config.providerHeaders &&
      Object.keys(config.providerHeaders).length > 0
        ? { defaultHeaders: config.providerHeaders }
        : {}),
    });

    try {
      const stream = await client.chat.completions.create(
        {
          model: config.model,
          messages: input.messages,
          tools: agentTools,
          tool_choice: "auto",
          temperature: 0.3,
          max_tokens: 2048,
          stream: true,
        },
        {
          signal: input.signal,
        },
      );

      let assistantContent = "";
      const toolCalls = new Map<number, PendingToolCall>();

      for await (const chunk of stream) {
        throwIfAborted(input.signal);

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content.length > 0) {
          assistantContent += delta.content;
          yield {
            type: "token",
            token: delta.content,
          };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index ?? 0;
            const existing = toolCalls.get(index) || {
              id: "",
              name: "",
              arguments: "",
            };

            if (toolCallDelta.id) {
              existing.id = toolCallDelta.id;
            }

            if (toolCallDelta.function?.name) {
              existing.name += toolCallDelta.function.name;
            }

            if (toolCallDelta.function?.arguments) {
              existing.arguments += toolCallDelta.function.arguments;
            }

            toolCalls.set(index, existing);
          }
        }
      }

      yield {
        type: "complete",
        provider: config.selectedProvider,
        model: config.model,
        content: assistantContent,
        toolCalls: Array.from(toolCalls.entries())
          .sort(([left], [right]) => left - right)
          .map(([, value]) => value),
      };
      return;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

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

function buildToolResultMessage(toolCallId: string, content: string): AgentChatMessage {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content,
  } as AgentChatMessage;
}

function buildAssistantToolCallMessage(
  content: string,
  toolCalls: PendingToolCall[],
): AgentChatMessage {
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    })),
  } as AgentChatMessage;
}

function getApprovalRequest(
  input: AgentRunInput,
  toolCall: PendingToolCall,
  toolArgs: Record<string, unknown>,
  minimumRole: AgentRole,
): AgentApprovalRequest {
  return {
    sessionId: input.sessionId,
    processId: input.processId!,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    toolArgs,
    role: input.role,
    minimumRole,
  };
}

async function finalizeTurnState(input: {
  processId: string;
  sessionId: string;
  status: "completed" | "awaiting_approval" | "failed" | "aborted";
  response: string;
  messages: AgentChatMessage[];
  pendingToolCalls: PendingToolCall[];
  pendingApproval: unknown;
  toolTraces: Array<Record<string, unknown>>;
  error?: string;
}) {
  await updateAgentTurnState(input.processId, {
    status: input.status,
    assistantResponse: input.response,
    messages: cloneMessages(input.messages),
    pendingToolCalls: input.pendingToolCalls,
    pendingApproval: input.pendingApproval,
    toolTraces: input.toolTraces,
    error: input.error || null,
    completedAt:
      input.status === "completed" || input.status === "failed" || input.status === "aborted"
        ? new Date()
        : null,
  });
}

async function* executeAgentRun(
  input: AgentRunInput,
  initialMessages: AgentChatMessage[],
  initialPendingToolCalls: PendingToolCall[],
  initialResponse: string,
  initialToolTraces: Array<Record<string, unknown>>,
): AsyncGenerator<AgentStreamEvent> {
  const steps: AgentStep[] = [];
  let assistantResponse = initialResponse;
  let messages = cloneMessages(initialMessages);
  let pendingToolCalls = [...initialPendingToolCalls];
  let toolTraces = [...initialToolTraces];
  let decision = input.decision;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    throwIfAborted(input.signal);

    if (pendingToolCalls.length === 0) {
      const startTime = Date.now();
      let assistantChunk:
        | {
            provider: string;
            model: string;
            content: string;
            toolCalls: PendingToolCall[];
          }
        | null = null;

      await logAgentTurnEvent({
        processId: input.processId!,
        action: "model_stream_started",
        result: "processing",
      });

      for await (const streamEvent of streamAssistantResponse({
        messages,
        provider: input.provider,
        signal: input.signal,
      })) {
        if (streamEvent.type === "token") {
          assistantResponse += streamEvent.token;
          yield {
            type: "token",
            token: streamEvent.token,
          };
          continue;
        }

        assistantChunk = streamEvent;
      }

      if (!assistantChunk) {
        throw new Error("No assistant response received from streaming provider.");
      }

      await logAgentTurnEvent({
        processId: input.processId!,
        action: "model_stream_completed",
        result: "success",
        details: {
          provider: assistantChunk.provider,
          model: assistantChunk.model,
          toolCalls: assistantChunk.toolCalls.length,
          durationMs: Date.now() - startTime,
        },
      });

      if (assistantChunk.toolCalls.length === 0) {
        messages.push({
          role: "assistant",
          content: assistantChunk.content || "",
        } as AgentChatMessage);

        const responseStep: AgentStep = {
          type: "response",
          content: assistantChunk.content || "No response.",
          duration: Date.now() - startTime,
        };
        steps.push(responseStep);

        await finalizeTurnState({
          processId: input.processId!,
          sessionId: input.sessionId,
          status: "completed",
          response: assistantResponse,
          messages,
          pendingToolCalls: [],
          pendingApproval: null,
          toolTraces,
        });

        await logAgentTurnEvent({
          processId: input.processId!,
          action: "turn_completed",
          result: "success",
          details: {
            sessionId: input.sessionId,
            steps: steps.length,
            toolCalls: toolTraces.length,
          },
        });

        yield {
          type: "done",
          response: assistantResponse,
          sessionId: input.sessionId,
          processId: input.processId!,
          status: "completed",
          steps: steps.length,
          toolCalls: toolTraces.length,
        };
        return;
      }

      pendingToolCalls = assistantChunk.toolCalls;
      messages.push(
        buildAssistantToolCallMessage(
          assistantChunk.content || "",
          assistantChunk.toolCalls,
        ),
      );

      await updateAgentTurnState(input.processId!, {
        messages,
        pendingToolCalls,
        assistantResponse,
        toolTraces,
      });
    }

    while (pendingToolCalls.length > 0) {
      throwIfAborted(input.signal);

      const toolCall = pendingToolCalls[0];
      const startTime = Date.now();
      let toolArgs: Record<string, unknown>;

      try {
        toolArgs = parseToolArgs(toolCall.arguments);
      } catch (error) {
        const errorResult = JSON.stringify({
          error: `Invalid tool arguments for ${toolCall.name}: ${getErrorMessage(error)}`,
        });
        messages.push(buildToolResultMessage(toolCall.id, errorResult));
        pendingToolCalls = pendingToolCalls.slice(1);
        yield {
          type: "step",
          step: {
            type: "tool_result",
            content: errorResult,
            toolName: toolCall.name,
            duration: Date.now() - startTime,
          },
        };
        continue;
      }

      const toolCallStep: AgentStep = {
        type: "tool_call",
        content: `Calling ${toolCall.name}...`,
        toolName: toolCall.name,
        toolArgs,
        duration: Date.now() - startTime,
      };
      steps.push(toolCallStep);
      yield { type: "step", step: toolCallStep };

      const policy = getAgentToolPolicy(toolCall.name);
      if (!policy) {
        const errorResult = JSON.stringify({
          error: `No server-side policy configured for tool: ${toolCall.name}`,
        });
        messages.push(buildToolResultMessage(toolCall.id, errorResult));
        pendingToolCalls = pendingToolCalls.slice(1);
        toolTraces.push(
          buildToolTrace({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolArgs,
            mode: "mutating",
            minimumRole: "admin",
            requiresApproval: true,
            status: "denied",
            error: errorResult,
          }),
        );
        await updateAgentTurnState(input.processId!, {
          messages,
          pendingToolCalls,
          toolTraces,
          assistantResponse,
        });
        yield {
          type: "step",
          step: {
            type: "tool_result",
            content: errorResult,
            toolName: toolCall.name,
            duration: Date.now() - startTime,
          },
        };
        continue;
      }

      if (!hasRequiredAgentRole(input.role, policy.minimumRole)) {
        const errorResult = JSON.stringify({
          error: `Role "${input.role}" is not allowed to execute ${toolCall.name}. Minimum role: ${policy.minimumRole}.`,
        });
        messages.push(buildToolResultMessage(toolCall.id, errorResult));
        pendingToolCalls = pendingToolCalls.slice(1);
        toolTraces.push(
          buildToolTrace({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolArgs,
            mode: policy.mode,
            minimumRole: policy.minimumRole,
            requiresApproval: policy.requiresApproval,
            status: "denied",
            error: errorResult,
          }),
        );
        await logAgentTurnEvent({
          processId: input.processId!,
          action: "tool_denied_role",
          result: "denied",
          details: {
            toolName: toolCall.name,
            role: input.role,
            minimumRole: policy.minimumRole,
          },
        });
        await updateAgentTurnState(input.processId!, {
          messages,
          pendingToolCalls,
          toolTraces,
          assistantResponse,
        });
        yield {
          type: "step",
          step: {
            type: "tool_result",
            content: errorResult,
            toolName: toolCall.name,
            duration: Date.now() - startTime,
          },
        };
        continue;
      }

      const needsApproval =
        policy.mode === "mutating" &&
        policy.requiresApproval &&
        getAgentApprovalRequired();

      if (needsApproval && !decision) {
        const approval = getApprovalRequest(
          input,
          toolCall,
          toolArgs,
          policy.minimumRole,
        );
        toolTraces.push(
          buildToolTrace({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolArgs,
            mode: policy.mode,
            minimumRole: policy.minimumRole,
            requiresApproval: true,
            status: "approval_required",
          }),
        );

        await finalizeTurnState({
          processId: input.processId!,
          sessionId: input.sessionId,
          status: "awaiting_approval",
          response: assistantResponse,
          messages,
          pendingToolCalls,
          pendingApproval: approval,
          toolTraces,
        });

        await logAgentTurnEvent({
          processId: input.processId!,
          action: "tool_approval_requested",
          result: "awaiting_approval",
          details: approval,
        });

        yield {
          type: "approval_required",
          approval,
        };
        return;
      }

      if (needsApproval && decision === "reject") {
        const errorResult = JSON.stringify({
          error: `Tool execution rejected by operator approval policy for ${toolCall.name}.`,
          approvalRejected: true,
        });
        messages.push(buildToolResultMessage(toolCall.id, errorResult));
        pendingToolCalls = pendingToolCalls.slice(1);
        decision = undefined;
        toolTraces.push(
          buildToolTrace({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolArgs,
            mode: policy.mode,
            minimumRole: policy.minimumRole,
            requiresApproval: true,
            status: "rejected",
            error: errorResult,
          }),
        );
        await logAgentTurnEvent({
          processId: input.processId!,
          action: "tool_approval_rejected",
          result: "rejected",
          details: {
            toolName: toolCall.name,
            toolArgs,
          },
        });
        await updateAgentTurnState(input.processId!, {
          status: "running",
          messages,
          pendingToolCalls,
          pendingApproval: null,
          toolTraces,
          assistantResponse,
        });
        yield {
          type: "step",
          step: {
            type: "tool_result",
            content: errorResult,
            toolName: toolCall.name,
            duration: Date.now() - startTime,
          },
        };
        continue;
      }

      if (needsApproval && decision === "approve") {
        decision = undefined;
        toolTraces.push(
          buildToolTrace({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolArgs,
            mode: policy.mode,
            minimumRole: policy.minimumRole,
            requiresApproval: true,
            status: "approved",
          }),
        );
        await logAgentTurnEvent({
          processId: input.processId!,
          action: "tool_approval_granted",
          result: "approved",
          details: {
            toolName: toolCall.name,
            toolArgs,
          },
        });
      }

      const executor = toolImplementations[toolCall.name];
      if (!executor) {
        const errorResult = JSON.stringify({
          error: `Unknown tool: ${toolCall.name}`,
        });
        messages.push(buildToolResultMessage(toolCall.id, errorResult));
        pendingToolCalls = pendingToolCalls.slice(1);
        yield {
          type: "step",
          step: {
            type: "tool_result",
            content: errorResult,
            toolName: toolCall.name,
            duration: Date.now() - startTime,
          },
        };
        continue;
      }

      try {
        const result = await executor(toolArgs);
        messages.push(buildToolResultMessage(toolCall.id, result));
        pendingToolCalls = pendingToolCalls.slice(1);
        toolTraces.push(
          buildToolTrace({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolArgs,
            mode: policy.mode,
            minimumRole: policy.minimumRole,
            requiresApproval: policy.requiresApproval,
            status: "executed",
            result,
          }),
        );
        await logAgentTurnEvent({
          processId: input.processId!,
          action: "tool_executed",
          result: "success",
          details: {
            toolName: toolCall.name,
            toolArgs,
          },
        });
        await updateAgentTurnState(input.processId!, {
          status: "running",
          messages,
          pendingToolCalls,
          pendingApproval: null,
          toolTraces,
          assistantResponse,
        });

        const toolResultStep: AgentStep = {
          type: "tool_result",
          content: result,
          toolName: toolCall.name,
          duration: Date.now() - startTime,
        };
        steps.push(toolResultStep);
        yield { type: "step", step: toolResultStep };
      } catch (error) {
        const errorResult = JSON.stringify({
          error: getErrorMessage(error),
        });
        messages.push(buildToolResultMessage(toolCall.id, errorResult));
        pendingToolCalls = pendingToolCalls.slice(1);
        toolTraces.push(
          buildToolTrace({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolArgs,
            mode: policy.mode,
            minimumRole: policy.minimumRole,
            requiresApproval: policy.requiresApproval,
            status: "failed",
            error: errorResult,
          }),
        );
        await logAgentTurnEvent({
          processId: input.processId!,
          action: "tool_failed",
          result: "error",
          error: getErrorMessage(error),
          details: {
            toolName: toolCall.name,
            toolArgs,
          },
        });
        await updateAgentTurnState(input.processId!, {
          status: "running",
          messages,
          pendingToolCalls,
          pendingApproval: null,
          toolTraces,
          assistantResponse,
        });
        const toolResultStep: AgentStep = {
          type: "tool_result",
          content: errorResult,
          toolName: toolCall.name,
          duration: Date.now() - startTime,
        };
        steps.push(toolResultStep);
        yield { type: "step", step: toolResultStep };
      }
    }
  }

  const maxIterationMessage =
    "⚠️ Reached maximum number of reasoning steps. Please continue the conversation for more.";

  await finalizeTurnState({
    processId: input.processId!,
    sessionId: input.sessionId,
    status: "completed",
    response: assistantResponse || maxIterationMessage,
    messages,
    pendingToolCalls: [],
    pendingApproval: null,
    toolTraces,
  });

  yield {
    type: "done",
    response: assistantResponse || maxIterationMessage,
    sessionId: input.sessionId,
    processId: input.processId!,
    status: "completed",
    steps: steps.length,
    toolCalls: toolTraces.length,
  };
}

function getHistoryFromTurn(turn: IAgentTurn): ConversationHistoryMessage[] {
  return Array.isArray(turn.history)
    ? (JSON.parse(JSON.stringify(turn.history)) as ConversationHistoryMessage[])
    : [];
}

function getMessagesFromTurn(turn: IAgentTurn): AgentChatMessage[] {
  return Array.isArray(turn.messages)
    ? (JSON.parse(JSON.stringify(turn.messages)) as AgentChatMessage[])
    : [];
}

function getPendingToolCallsFromTurn(turn: IAgentTurn): PendingToolCall[] {
  return Array.isArray(turn.pendingToolCalls)
    ? (JSON.parse(JSON.stringify(turn.pendingToolCalls)) as PendingToolCall[])
    : [];
}

function getToolTracesFromTurn(turn: IAgentTurn): Array<Record<string, unknown>> {
  return Array.isArray(turn.toolTraces)
    ? (JSON.parse(JSON.stringify(turn.toolTraces)) as Array<Record<string, unknown>>)
    : [];
}

export async function* runAgentLoopStreaming(
  input: AgentRunInput,
): AsyncGenerator<AgentStreamEvent> {
  try {
    await ensureAgentSession({
      sessionId: input.sessionId,
      role: input.role,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    if (input.processId) {
      const turn = await loadAgentTurn(input.processId);
      if (!turn) {
        throw new Error(`Agent turn not found: ${input.processId}`);
      }
      if (turn.sessionId !== input.sessionId) {
        throw new Error(
          `Agent turn ${input.processId} does not belong to session ${input.sessionId}.`,
        );
      }
      if (turn.status !== "awaiting_approval") {
        throw new Error(
          `Agent turn ${input.processId} is not awaiting approval.`,
        );
      }

      yield* executeAgentRun(
        {
          ...input,
          userMessage: turn.userMessage,
          history: getHistoryFromTurn(turn),
          provider: turn.provider,
        },
        getMessagesFromTurn(turn),
        getPendingToolCallsFromTurn(turn),
        turn.assistantResponse || "",
        getToolTracesFromTurn(turn),
      );
      return;
    }

    if (!input.userMessage || input.userMessage.trim().length === 0) {
      throw new Error("Message is required");
    }

    const systemPrompt = await buildSystemPrompt(input.role);
    const history = Array.isArray(input.history) ? input.history.slice(-20) : [];
    const messages: AgentChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map(
        (item): AgentChatMessage => ({
          role: item.role,
          content: item.content,
        }),
      ),
      { role: "user", content: input.userMessage },
    ];

    const processId = input.processId || createAgentTurnProcessId();
    const turn = await createAgentTurn({
      sessionId: input.sessionId,
      processId,
      role: input.role,
      provider: input.provider || process.env.AI_PROVIDER || "glm",
      userMessage: input.userMessage,
      history,
      messages,
    });

    yield* executeAgentRun(
      {
        ...input,
        processId: turn.processId,
        history,
      },
      messages,
      [],
      "",
      [],
    );
  } catch (error) {
    const message = getErrorMessage(error);

    if (input.processId) {
      await finalizeTurnState({
        processId: input.processId,
        sessionId: input.sessionId,
        status: isAbortError(error) ? "aborted" : "failed",
        response: "",
        messages: [],
        pendingToolCalls: [],
        pendingApproval: null,
        toolTraces: [],
        error: message,
      }).catch(() => undefined);

      await logAgentTurnEvent({
        processId: input.processId,
        action: isAbortError(error) ? "turn_aborted" : "turn_failed",
        result: isAbortError(error) ? "aborted" : "error",
        error: message,
      }).catch(() => undefined);
    }

    if (!isAbortError(error)) {
      yield {
        type: "error",
        error: message,
        sessionId: input.sessionId,
        processId: input.processId || "",
      };
    }
  }
}

export async function runAgentFull(
  userMessage: string,
  history: ConversationHistoryMessage[],
  provider: string | undefined,
  sessionId: string,
  role: AgentRole,
): Promise<{ response: string; events: AgentStreamEvent[] }> {
  const processId = createAgentTurnProcessId();
  const events: AgentStreamEvent[] = [];
  let response = "";

  for await (const event of runAgentLoopStreaming({
    sessionId,
    role,
    provider,
    history,
    userMessage,
    processId,
  })) {
    events.push(event);
    if (event.type === "token") {
      response += event.token;
    }
    if (event.type === "done") {
      response = event.response;
    }
  }

  return { response, events };
}
