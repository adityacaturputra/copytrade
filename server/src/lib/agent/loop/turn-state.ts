import {
  cloneMessages,
  type AgentChatMessage,
  type PendingToolCall,
} from "../message-helpers";
import { updateAgentTurnState } from "../logging";

export async function finalizeTurnState(input: {
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
