export interface AgentStep {
  type: "thinking" | "tool_call" | "tool_result" | "response";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  duration?: number;
}

export interface AgentApproval {
  sessionId: string;
  processId: string;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  role: "viewer" | "operator" | "admin";
  minimumRole: "viewer" | "operator" | "admin";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: AgentStep[];
  timestamp: Date;
  streaming?: boolean;
  approval?: AgentApproval | null;
  processId?: string | null;
}

export type AgentRole = "viewer" | "operator" | "admin";

export interface HistoryItem {
  id: string;
  processId: string;
  sessionId: string;
  role: string;
  status: string;
  userMessage: string;
  assistantResponse: string | null;
  createdAt: string;
  toolCount: number;
}
