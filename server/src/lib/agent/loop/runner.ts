import { buildSystemPrompt } from "../prompt";
import { resolveProviderConfig } from "../providers";
import type { AgentChatMessage } from "../message-helpers";
import {
  getErrorMessage,
  getHistoryFromTurn,
  getMessagesFromTurn,
  getPendingToolCallsFromTurn,
  getToolTracesFromTurn,
  isAbortError,
} from "./helpers";
import type {
  AgentStreamEvent,
  ConversationHistoryMessage,
} from "./types";
import type { AgentRole } from "../auth";
import {
  ensureAgentSession,
  createAgentTurn,
  createAgentTurnProcessId,
  loadAgentTurn,
  logAgentTurnEvent,
} from "../logging";

export interface AgentRunInput {
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

type ExecuteAgentRun = (
  input: AgentRunInput,
  initialMessages: AgentChatMessage[],
  initialPendingToolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>,
  initialResponse: string,
  initialToolTraces: Array<Record<string, unknown>>,
  providerName?: string,
) => AsyncGenerator<AgentStreamEvent>;

type FinalizeTurnState = (input: {
  processId: string;
  sessionId: string;
  status: "completed" | "awaiting_approval" | "failed" | "aborted";
  response: string;
  messages: AgentChatMessage[];
  pendingToolCalls: Array<{ id: string; name: string; arguments: string }>;
  pendingApproval: unknown;
  toolTraces: Array<Record<string, unknown>>;
  error?: string;
}) => Promise<void>;

export async function* runAgentLoopStreamingImpl(
  input: AgentRunInput,
  executeAgentRun: ExecuteAgentRun,
  finalizeTurnState: FinalizeTurnState,
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
      if (!turn) throw new Error(`Agent turn not found: ${input.processId}`);
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
    const history = Array.isArray(input.history) ? input.history : [];
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
      { ...input, processId: turn.processId, history },
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

export async function runAgentFullImpl(
  userMessage: string,
  history: ConversationHistoryMessage[],
  provider: string | undefined,
  sessionId: string,
  role: AgentRole,
  runAgentLoopStreaming: (
    input: AgentRunInput,
  ) => AsyncGenerator<AgentStreamEvent>,
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
    if (event.type === "token") response += event.token;
    if (event.type === "done") response = event.response;
  }

  return { response, events };
}
