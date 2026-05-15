import {
  cloneMessages,
  buildAssistantToolCallMessage,
  type AgentChatMessage,
  type PendingToolCall,
} from "../message-helpers";
import { getApprovalRequest, throwIfAborted } from "./helpers";
import type {
  AgentApprovalRequest,
  AgentStep,
  AgentStreamEvent,
  ConversationHistoryMessage,
} from "./types";
import { streamAssistantResponse } from "./stream";
import {
  runAgentFullImpl,
  runAgentLoopStreamingImpl,
  type AgentRunInput,
} from "./runner";
import { runToolCallsCycle } from "./execute-tools-cycle";
import type { AgentRole } from "../auth";
import { updateAgentTurnState, logAgentTurnEvent } from "../logging";
import { finalizeTurnState } from "./turn-state";
import {
  estimateMessagesTokens,
  shouldCompact,
  compactMessages,
} from "../context-manager";

const MAX_ITERATIONS = 12;

export type {
  AgentApprovalRequest,
  AgentStep,
  AgentStreamEvent,
  ConversationHistoryMessage,
} from "./types";

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
  const buildApprovalRequest = getApprovalRequest({
    sessionId: input.sessionId,
    processId: input.processId!,
    role: input.role,
  });

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

    const toolCycle = runToolCallsCycle({
      runInput: input,
      resolvedProvider,
      pendingToolCalls,
      messages,
      assistantResponse,
      toolTraces,
      steps,
      decision,
      buildApprovalRequest,
      finalizeTurnState,
    });

    while (true) {
      const result = await toolCycle.next();
      if (result.done) {
        pendingToolCalls = result.value.pendingToolCalls;
        messages = result.value.messages;
        toolTraces = result.value.toolTraces;
        decision = result.value.decision;
        if (result.value.approvalReturned) return;
        break;
      }
      yield result.value;
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

export async function* runAgentLoopStreaming(
  input: AgentRunInput,
): AsyncGenerator<AgentStreamEvent> {
  yield* runAgentLoopStreamingImpl(input, executeAgentRun, finalizeTurnState);
}

export async function runAgentFull(
  userMessage: string,
  history: ConversationHistoryMessage[],
  provider: string | undefined,
  sessionId: string,
  role: AgentRole,
): Promise<{ response: string; events: AgentStreamEvent[] }> {
  return runAgentFullImpl(
    userMessage,
    history,
    provider,
    sessionId,
    role,
    runAgentLoopStreaming,
  );
}
