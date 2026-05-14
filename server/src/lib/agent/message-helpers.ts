import OpenAI from "openai";

export type AgentChatMessage = OpenAI.ChatCompletionMessageParam;

export type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export function cloneMessages(messages: AgentChatMessage[]): AgentChatMessage[] {
  return JSON.parse(JSON.stringify(messages)) as AgentChatMessage[];
}

export function parseToolArgs(input: string): Record<string, unknown> {
  if (!input || input.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(input);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

export function buildToolResultMessage(
  toolCallId: string,
  content: string,
): AgentChatMessage {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content,
  } as AgentChatMessage;
}

export function buildAssistantToolCallMessage(
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
