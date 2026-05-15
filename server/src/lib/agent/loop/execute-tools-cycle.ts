import { verifyActionPassword } from "../../action-auth";
import { getAgentApprovalRequired, hasRequiredAgentRole } from "../auth";
import { getContextLimits, pruneToolResult } from "../context-manager";
import { buildToolResultMessage, parseToolArgs } from "../message-helpers";
import { getErrorMessage, throwIfAborted } from "./helpers";
import type { AgentStep, AgentStreamEvent } from "./types";
import { buildToolTrace, logAgentTurnEvent } from "../logging";
import { getAgentToolPolicy } from "../policies";
import { toolImplementations } from "../tools";
import {
  handleApprovalGranted,
  handleApprovalRejected,
  handleApprovalRequired,
  makeToolResultStep,
  persistRunningState,
  type ToolCycleInput,
  type ToolCycleResult,
} from "./execute-tools-cycle-helpers";

export async function* runToolCallsCycle(
  input: ToolCycleInput,
): AsyncGenerator<AgentStreamEvent, ToolCycleResult> {
  const { runInput } = input;
  let pendingToolCalls = [...input.pendingToolCalls];
  let messages = [...input.messages];
  let toolTraces = [...input.toolTraces];
  let decision = input.decision;

  while (pendingToolCalls.length > 0) {
    throwIfAborted(runInput.signal);
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
        step: makeToolResultStep(errorResult, toolCall.name, startTime),
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
    input.steps.push(toolCallStep);
    yield { type: "step", step: toolCallStep };

    const policy = getAgentToolPolicy(toolCall.name);
    if (!policy || !hasRequiredAgentRole(runInput.role, policy.minimumRole)) {
      const errorResult = JSON.stringify({
        error: !policy
          ? `No server-side policy configured for tool: ${toolCall.name}`
          : `Role "${runInput.role}" is not allowed to execute ${toolCall.name}. Minimum role: ${policy.minimumRole}.`,
      });
      messages.push(buildToolResultMessage(toolCall.id, errorResult));
      pendingToolCalls = pendingToolCalls.slice(1);
      toolTraces.push(
        buildToolTrace({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolArgs,
          mode: policy?.mode || "mutating",
          minimumRole: policy?.minimumRole || "admin",
          requiresApproval: policy?.requiresApproval ?? true,
          status: "denied",
          error: errorResult,
        }),
      );
      await persistRunningState({
        processId: runInput.processId!,
        messages,
        pendingToolCalls,
        toolTraces,
        assistantResponse: input.assistantResponse,
      });
      yield {
        type: "step",
        step: makeToolResultStep(errorResult, toolCall.name, startTime),
      };
      continue;
    }

    if (
      policy.mode === "mutating" &&
      !verifyActionPassword(runInput.actionPassword)
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
      await persistRunningState({
        processId: runInput.processId!,
        messages,
        pendingToolCalls,
        toolTraces,
        assistantResponse: input.assistantResponse,
      });
      yield {
        type: "step",
        step: makeToolResultStep(errorResult, toolCall.name, startTime),
      };
      continue;
    }

    const needsApproval =
      policy.mode === "mutating" &&
      policy.requiresApproval &&
      getAgentApprovalRequired();
    if (needsApproval && !decision) {
      const approvalState = await handleApprovalRequired({
        toolCall,
        toolArgs,
        minimumRole: policy.minimumRole,
        processId: runInput.processId!,
        sessionId: runInput.sessionId,
        assistantResponse: input.assistantResponse,
        messages,
        pendingToolCalls,
        toolTraces,
        buildApprovalRequest: input.buildApprovalRequest,
        finalizeTurnState: input.finalizeTurnState,
      });
      toolTraces = approvalState.toolTraces;
      yield { type: "approval_required", approval: approvalState.approval };
      return {
        pendingToolCalls,
        messages,
        toolTraces,
        decision,
        approvalReturned: true,
      };
    }

    if (needsApproval && decision === "reject") {
      const rejectedState = await handleApprovalRejected({
        toolCall,
        toolArgs,
        processId: runInput.processId!,
        assistantResponse: input.assistantResponse,
        messages,
        pendingToolCalls,
        toolTraces,
        minimumRole: policy.minimumRole,
      });
      messages = rejectedState.messages;
      pendingToolCalls = rejectedState.pendingToolCalls;
      toolTraces = rejectedState.toolTraces;
      decision = undefined;
      yield rejectedState.event;
      continue;
    }

    if (needsApproval && decision === "approve") {
      decision = undefined;
      toolTraces = await handleApprovalGranted({
        toolCall,
        toolArgs,
        processId: runInput.processId!,
        toolTraces,
        minimumRole: policy.minimumRole,
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
        step: makeToolResultStep(errorResult, toolCall.name, startTime),
      };
      continue;
    }

    try {
      const result = await executor(toolArgs);
      const contextLimits = getContextLimits(input.resolvedProvider);
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
      await persistRunningState({
        processId: runInput.processId!,
        messages,
        pendingToolCalls,
        toolTraces,
        assistantResponse: input.assistantResponse,
      });
      const toolResultStep: AgentStep = {
        type: "tool_result",
        content: result,
        toolName: toolCall.name,
        duration: Date.now() - startTime,
      };
      input.steps.push(toolResultStep);
      yield { type: "step", step: toolResultStep };
    } catch (error) {
      const errorResult = JSON.stringify({ error: getErrorMessage(error) });
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
      await persistRunningState({
        processId: runInput.processId!,
        messages,
        pendingToolCalls,
        toolTraces,
        assistantResponse: input.assistantResponse,
      });
      const toolResultStep = makeToolResultStep(
        errorResult,
        toolCall.name,
        startTime,
      );
      input.steps.push(toolResultStep);
      yield { type: "step", step: toolResultStep };
    }
  }

  return {
    pendingToolCalls,
    messages,
    toolTraces,
    decision,
    approvalReturned: false,
  };
}
