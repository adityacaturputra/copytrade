import {
  buildAssistantToolCallMessage,
  type AgentChatMessage,
  type PendingToolCall,
} from "../message-helpers";
import { streamAssistantResponse } from "./stream";
import { logAgentTurnEvent, updateAgentTurnState } from "../logging";
import type { AgentStep } from "./types";

export async function runAssistantCycle(input: {
  processId: string;
  provider?: string;
  signal?: AbortSignal;
  messages: AgentChatMessage[];
  assistantResponse: string;
  toolTraces: Array<Record<string, unknown>>;
}): Promise<{
  assistantResponse: string;
  messages: AgentChatMessage[];
  pendingToolCalls: PendingToolCall[];
  responseStep: AgentStep | null;
  done: boolean;
}> {
  const startTime = Date.now();
  let assistantChunk: {
    provider: string;
    model: string;
    content: string;
    toolCalls: PendingToolCall[];
  } | null = null;
  let assistantResponse = input.assistantResponse;

  await logAgentTurnEvent({
    processId: input.processId,
    action: "model_stream_started",
    level: "debug",
    result: "processing",
  });

  for await (const streamEvent of streamAssistantResponse({
    messages: input.messages,
    provider: input.provider,
    signal: input.signal,
  })) {
    if (streamEvent.type === "token") {
      assistantResponse += streamEvent.token;
      continue;
    }
    assistantChunk = streamEvent;
  }

  if (!assistantChunk) {
    throw new Error("No assistant response received from streaming provider.");
  }

  await logAgentTurnEvent({
    processId: input.processId,
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
    const messages = [
      ...input.messages,
      {
        role: "assistant",
        content: assistantChunk.content || "",
      } as AgentChatMessage,
    ];
    return {
      assistantResponse,
      messages,
      pendingToolCalls: [],
      responseStep: {
        type: "response",
        content: assistantChunk.content || "No response.",
        duration: Date.now() - startTime,
      },
      done: true,
    };
  }

  const pendingToolCalls = assistantChunk.toolCalls;
  const messages = [
    ...input.messages,
    buildAssistantToolCallMessage(
      assistantChunk.content || "",
      pendingToolCalls,
    ),
  ];

  await updateAgentTurnState(input.processId, {
    messages,
    pendingToolCalls,
    assistantResponse,
    toolTraces: input.toolTraces,
  });

  return {
    assistantResponse,
    messages,
    pendingToolCalls,
    responseStep: null,
    done: false,
  };
}
