import {
  buildToolResultMessage,
  type AgentChatMessage,
  type PendingToolCall,
} from "../message-helpers";
import type { AgentRunInput } from "./runner";
import type {
  AgentApprovalRequest,
  AgentStreamEvent,
  AgentStep,
} from "./types";
import {
  buildToolTrace,
  logAgentTurnEvent,
  updateAgentTurnState,
} from "../logging";

export type ToolCycleResult = {
  pendingToolCalls: PendingToolCall[];
  messages: AgentChatMessage[];
  toolTraces: Array<Record<string, unknown>>;
  decision?: "approve" | "reject";
  approvalReturned: boolean;
};

export type ToolCycleInput = {
  runInput: AgentRunInput;
  resolvedProvider: string;
  pendingToolCalls: PendingToolCall[];
  messages: AgentChatMessage[];
  assistantResponse: string;
  toolTraces: Array<Record<string, unknown>>;
  steps: AgentStep[];
  decision?: "approve" | "reject";
  buildApprovalRequest: (
    toolCall: PendingToolCall,
    toolArgs: Record<string, unknown>,
    minimumRole: AgentRunInput["role"],
  ) => AgentApprovalRequest;
  finalizeTurnState: (args: {
    processId: string;
    sessionId: string;
    status: "completed" | "awaiting_approval" | "failed" | "aborted";
    response: string;
    messages: AgentChatMessage[];
    pendingToolCalls: PendingToolCall[];
    pendingApproval: unknown;
    toolTraces: Array<Record<string, unknown>>;
    error?: string;
  }) => Promise<void>;
};

export function makeToolResultStep(
  content: string,
  toolName: string,
  startTime: number,
): AgentStep {
  return {
    type: "tool_result",
    content,
    toolName,
    duration: Date.now() - startTime,
  };
}

export async function persistRunningState(input: {
  processId: string;
  messages: AgentChatMessage[];
  pendingToolCalls: PendingToolCall[];
  toolTraces: Array<Record<string, unknown>>;
  assistantResponse: string;
}) {
  await updateAgentTurnState(input.processId, {
    status: "running",
    messages: input.messages,
    pendingToolCalls: input.pendingToolCalls,
    pendingApproval: null,
    toolTraces: input.toolTraces,
    assistantResponse: input.assistantResponse,
  });
}

export async function handleApprovalRequired(input: {
  toolCall: PendingToolCall;
  toolArgs: Record<string, unknown>;
  minimumRole: AgentRunInput["role"];
  processId: string;
  sessionId: string;
  assistantResponse: string;
  messages: AgentChatMessage[];
  pendingToolCalls: PendingToolCall[];
  toolTraces: Array<Record<string, unknown>>;
  buildApprovalRequest: ToolCycleInput["buildApprovalRequest"];
  finalizeTurnState: ToolCycleInput["finalizeTurnState"];
}): Promise<{
  approval: AgentApprovalRequest;
  toolTraces: Array<Record<string, unknown>>;
}> {
  const approval = input.buildApprovalRequest(
    input.toolCall,
    input.toolArgs,
    input.minimumRole,
  );

  const toolTraces = [
    ...input.toolTraces,
    buildToolTrace({
      toolCallId: input.toolCall.id,
      toolName: input.toolCall.name,
      toolArgs: input.toolArgs,
      mode: "mutating",
      minimumRole: input.minimumRole,
      requiresApproval: true,
      status: "approval_required",
    }),
  ];

  await input.finalizeTurnState({
    processId: input.processId,
    sessionId: input.sessionId,
    status: "awaiting_approval",
    response: input.assistantResponse,
    messages: input.messages,
    pendingToolCalls: input.pendingToolCalls,
    pendingApproval: approval,
    toolTraces,
  });

  await logAgentTurnEvent({
    processId: input.processId,
    action: "tool_approval_requested",
    result: "awaiting_approval",
    details: approval,
  });

  return { approval, toolTraces };
}

export async function handleApprovalRejected(input: {
  toolCall: PendingToolCall;
  toolArgs: Record<string, unknown>;
  processId: string;
  assistantResponse: string;
  messages: AgentChatMessage[];
  pendingToolCalls: PendingToolCall[];
  toolTraces: Array<Record<string, unknown>>;
  minimumRole: AgentRunInput["role"];
}): Promise<{
  errorResult: string;
  messages: AgentChatMessage[];
  pendingToolCalls: PendingToolCall[];
  toolTraces: Array<Record<string, unknown>>;
  event: AgentStreamEvent;
}> {
  const errorResult = JSON.stringify({
    error: `Tool execution rejected by operator approval policy for ${input.toolCall.name}.`,
    approvalRejected: true,
  });
  const messages = [
    ...input.messages,
    buildToolResultMessage(input.toolCall.id, errorResult),
  ];
  const pendingToolCalls = input.pendingToolCalls.slice(1);
  const toolTraces = [
    ...input.toolTraces,
    buildToolTrace({
      toolCallId: input.toolCall.id,
      toolName: input.toolCall.name,
      toolArgs: input.toolArgs,
      mode: "mutating",
      minimumRole: input.minimumRole,
      requiresApproval: true,
      status: "rejected",
      error: errorResult,
    }),
  ];

  await logAgentTurnEvent({
    processId: input.processId,
    action: "tool_approval_rejected",
    result: "rejected",
    details: {
      toolName: input.toolCall.name,
      toolArgs: input.toolArgs,
    },
  });

  await persistRunningState({
    processId: input.processId,
    messages,
    pendingToolCalls,
    toolTraces,
    assistantResponse: input.assistantResponse,
  });

  return {
    errorResult,
    messages,
    pendingToolCalls,
    toolTraces,
    event: {
      type: "step",
      step: makeToolResultStep(errorResult, input.toolCall.name, Date.now()),
    },
  };
}

export async function handleApprovalGranted(input: {
  toolCall: PendingToolCall;
  toolArgs: Record<string, unknown>;
  processId: string;
  toolTraces: Array<Record<string, unknown>>;
  minimumRole: AgentRunInput["role"];
}): Promise<Array<Record<string, unknown>>> {
  const toolTraces = [
    ...input.toolTraces,
    buildToolTrace({
      toolCallId: input.toolCall.id,
      toolName: input.toolCall.name,
      toolArgs: input.toolArgs,
      mode: "mutating",
      minimumRole: input.minimumRole,
      requiresApproval: true,
      status: "approved",
    }),
  ];

  await logAgentTurnEvent({
    processId: input.processId,
    action: "tool_approval_granted",
    result: "approved",
    details: {
      toolName: input.toolCall.name,
      toolArgs: input.toolArgs,
    },
  });

  return toolTraces;
}
