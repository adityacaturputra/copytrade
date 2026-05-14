import OpenAI from "openai";
import { buildSystemPrompt } from "./prompt";
import { resolveProviderConfig, buildAgentProviderChain } from "./providers";
import { 
  cloneMessages, 
  parseToolArgs, 
  buildToolResultMessage, 
  buildAssistantToolCallMessage,
  type AgentChatMessage,
  type PendingToolCall
} from "./message-helpers";

import { getCodexPatunginConfig } from "@copytrade/shared/lib/ai/CodexPatunginConfig";
import {
  Account,
  type IAgentTurn,
  connectDB,
} from "@copytrade/shared/lib/database";
import { agentTools, toolImplementations } from "./tools";
import type { AgentRole } from "./auth";
import { getAgentApprovalRequired, hasRequiredAgentRole } from "./auth";
import { verifyActionPassword } from "../action-auth";
import {
  ensureAgentSession,
  createAgentTurn,
  createAgentTurnProcessId,
  loadAgentTurn,
  updateAgentTurnState,
  logAgentTurnEvent,
  buildToolTrace,
} from "./logging";
import { getAgentToolPolicy } from "./policies";
import {
  getContextLimits,
  estimateMessagesTokens,
  pruneToolResult,
  trimHistoryToTokenBudget,
  shouldCompact,
  compactMessages,
} from "./context-manager";

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
  actionPassword?: string;
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
  const chain = buildAgentProviderChain(input.provider);
  let lastError: Error | null = null;

  for (const currentProvider of chain) {
    const config = resolveProviderConfig(currentProvider);
    if (config.apiKeys.length === 0) continue;

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

        lastError = error as Error;
        const message = getErrorMessage(error).toLowerCase();
        const retryable =
          message.includes("401") ||
          message.includes("403") ||
          message.includes("429") ||
          message.includes("token expired") ||
          message.includes("invalid") ||
          message.includes("balance") ||
          message.includes("rate limit");

        if (!retryable || currentKeyIndex === config.apiKeys.length - 1) {
          console.warn(
            `[AgentLoop] Provider ${currentProvider} failed (key ${currentKeyIndex + 1}/${config.apiKeys.length}): ${getErrorMessage(error).substring(0, 120)}`,
          );
          break;
        }

        currentKeyIndex += 1;
      }
    }
  }

  throw new Error(
    `All AI providers failed for agent loop. Last error: ${lastError?.message || "Unknown error"}`,
  );
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
      input.status === "completed" ||
      input.status === "failed" ||
      input.status === "aborted"
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
  providerName?: string,
): AsyncGenerator<AgentStreamEvent> {
  const steps: AgentStep[] = [];
  let assistantResponse = initialResponse;
  let messages = cloneMessages(initialMessages);
  let pendingToolCalls = [...initialPendingToolCalls];
  let toolTraces = [...initialToolTraces];
  let decision = input.decision;
  const resolvedProvider = providerName || input.provider || "glm";

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    throwIfAborted(input.signal);

    // ── Auto-compact if context is too large ──
    if (shouldCompact(messages, resolvedProvider)) {
      const tokensBefore = estimateMessagesTokens(messages);
      await logAgentTurnEvent({
        processId: input.processId!,
        action: "context_compaction",
        level: "info",
        result: "processing",
        details: { tokensBefore, messageCount: messages.length },
      });

      messages = await compactMessages(
        messages,
        resolvedProvider,
        input.signal,
      );

      const tokensAfter = estimateMessagesTokens(messages);
      await logAgentTurnEvent({
        processId: input.processId!,
        action: "context_compaction",
        level: "info",
        result: "success",
        details: {
          tokensBefore,
          tokensAfter,
          saved: tokensBefore - tokensAfter,
          messageCount: messages.length,
        },
      });
    }

    if (pendingToolCalls.length === 0) {
      const startTime = Date.now();
      let assistantChunk: {
        provider: string;
        model: string;
        content: string;
        toolCalls: PendingToolCall[];
      } | null = null;

      await logAgentTurnEvent({
        processId: input.processId!,
        action: "model_stream_started",
        level: "debug",
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
        throw new Error(
          "No assistant response received from streaming provider.",
        );
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

      // ── Action password gate for mutating tools ──
      if (
        policy.mode === "mutating" &&
        !verifyActionPassword(input.actionPassword)
      ) {
        const errorResult = JSON.stringify({
          error:
            "🔒 Action locked. Unlock first to perform mutating operations (place orders, close positions, etc.). Use the unlock button in the UI header.",
          actionLocked: true,
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
          action: "tool_denied_action_password",
          result: "denied",
          details: { toolName: toolCall.name },
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
        const contextLimits = getContextLimits(resolvedProvider);
        messages.push(
          buildToolResultMessage(
            toolCall.id,
            pruneToolResult(result, contextLimits.maxToolResultTokens),
          ),
        );
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

function getToolTracesFromTurn(
  turn: IAgentTurn,
): Array<Record<string, unknown>> {
  return Array.isArray(turn.toolTraces)
    ? (JSON.parse(JSON.stringify(turn.toolTraces)) as Array<
        Record<string, unknown>
      >)
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
        turn.provider,
      );
      return;
    }

    if (!input.userMessage || input.userMessage.trim().length === 0) {
      throw new Error("Message is required");
    }

    const systemPrompt = await buildSystemPrompt(input.role);
    const config = resolveProviderConfig(input.provider);
    const history = Array.isArray(input.history)
      ? trimHistoryToTokenBudget(
          input.history,
          config.contextLimits.historyBudgetTokens,
        )
      : [];
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
      config.selectedProvider,
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
