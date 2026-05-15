import type { AgentRole } from "../auth";

export type ConversationHistoryMessage = {
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
