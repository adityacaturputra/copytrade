import type { IAgentTurn } from "@copytrade/shared/lib/database/index";
import type { AgentRole } from "../auth";
import type {
  AgentApprovalRequest,
  ConversationHistoryMessage,
} from "./types";
import type { AgentChatMessage, PendingToolCall } from "../message-helpers";

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Agent request aborted");
  }
}

export function isAbortError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("aborted") ||
    message.includes("aborterror") ||
    message.includes("request was aborted")
  );
}

export function getApprovalRequest(input: {
  sessionId: string;
  processId: string;
  role: AgentRole;
}): (
  toolCall: PendingToolCall,
  toolArgs: Record<string, unknown>,
  minimumRole: AgentRole,
) => AgentApprovalRequest {
  return (toolCall, toolArgs, minimumRole) => ({
    sessionId: input.sessionId,
    processId: input.processId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    toolArgs,
    role: input.role,
    minimumRole,
  });
}

export function getHistoryFromTurn(
  turn: IAgentTurn,
): ConversationHistoryMessage[] {
  return Array.isArray(turn.history)
    ? (JSON.parse(JSON.stringify(turn.history)) as ConversationHistoryMessage[])
    : [];
}

export function getMessagesFromTurn(turn: IAgentTurn): AgentChatMessage[] {
  return Array.isArray(turn.messages)
    ? (JSON.parse(JSON.stringify(turn.messages)) as AgentChatMessage[])
    : [];
}

export function getPendingToolCallsFromTurn(
  turn: IAgentTurn,
): PendingToolCall[] {
  return Array.isArray(turn.pendingToolCalls)
    ? (JSON.parse(JSON.stringify(turn.pendingToolCalls)) as PendingToolCall[])
    : [];
}

export function getToolTracesFromTurn(
  turn: IAgentTurn,
): Array<Record<string, unknown>> {
  return Array.isArray(turn.toolTraces)
    ? (JSON.parse(JSON.stringify(turn.toolTraces)) as Array<
        Record<string, unknown>
      >)
    : [];
}
