import {
  AgentSession,
  AgentTurn,
  connectDB,
  type IAgentTurn,
} from "@copytrade/shared/lib/database";
import {
  createTradeProcessId,
  logProcessStep,
  serializeProcessLogDetails,
} from "@copytrade/shared/lib/process-log";
import type { AgentRole } from "./auth";

function truncateText(value: string | undefined, maxLength: number = 4000) {
  if (!value) return value;
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

function cloneForStorage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createAgentSessionId(): string {
  return createTradeProcessId("agentsess");
}

export function createAgentTurnProcessId(): string {
  return createTradeProcessId("agentturn");
}

export async function ensureAgentSession(input: {
  sessionId: string;
  role: AgentRole;
  userAgent?: string;
  ipAddress?: string;
}) {
  await connectDB();

  return AgentSession.findOneAndUpdate(
    { sessionId: input.sessionId },
    {
      $set: {
        role: input.role,
        status: "active",
        userAgent: input.userAgent || null,
        ipAddress: input.ipAddress || null,
        lastActivityAt: new Date(),
      },
      $setOnInsert: {
        sessionId: input.sessionId,
      },
    },
    { upsert: true, new: true },
  ).exec();
}

export async function createAgentTurn(input: {
  sessionId: string;
  processId: string;
  role: AgentRole;
  provider: string;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  messages: unknown[];
}) {
  await connectDB();

  const turn = await AgentTurn.create({
    sessionId: input.sessionId,
    processId: input.processId,
    role: input.role,
    provider: input.provider,
    status: "running",
    userMessage: input.userMessage,
    history: cloneForStorage(input.history),
    messages: cloneForStorage(input.messages),
    pendingToolCalls: [],
    pendingApproval: null,
    toolTraces: [],
    startedAt: new Date(),
  });

  await logProcessStep({
    processId: input.processId,
    type: "agent_turn",
    action: "turn_started",
    details: {
      sessionId: input.sessionId,
      role: input.role,
      provider: input.provider,
      userMessage: truncateText(input.userMessage, 800),
    },
    result: "processing",
  });

  return turn;
}

export async function loadAgentTurn(processId: string) {
  await connectDB();
  return AgentTurn.findOne({ processId }).exec();
}

export async function updateAgentTurnState(
  processId: string,
  patch: Partial<{
    status: IAgentTurn["status"];
    assistantResponse: string;
    error: string | null;
    messages: unknown[];
    pendingToolCalls: unknown[];
    pendingApproval: unknown;
    toolTraces: Array<Record<string, unknown>>;
    completedAt: Date | null;
  }>,
) {
  await connectDB();

  const update: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (patch.status !== undefined) update.status = patch.status;
  if (patch.assistantResponse !== undefined) {
    update.assistantResponse = truncateText(patch.assistantResponse, 20000) || null;
  }
  if (patch.error !== undefined) update.error = patch.error || null;
  if (patch.messages !== undefined) update.messages = cloneForStorage(patch.messages);
  if (patch.pendingToolCalls !== undefined) {
    update.pendingToolCalls = cloneForStorage(patch.pendingToolCalls);
  }
  if (patch.pendingApproval !== undefined) {
    update.pendingApproval =
      patch.pendingApproval === null
        ? null
        : cloneForStorage(patch.pendingApproval);
  }
  if (patch.toolTraces !== undefined) {
    update.toolTraces = cloneForStorage(patch.toolTraces);
  }
  if (patch.completedAt !== undefined) {
    update.completedAt = patch.completedAt;
  }

  return AgentTurn.findOneAndUpdate({ processId }, { $set: update }, { new: true }).exec();
}

export async function logAgentTurnEvent(input: {
  processId: string;
  action: string;
  level?: string;
  result?: string;
  error?: string;
  details?: unknown;
}) {
  await logProcessStep({
    processId: input.processId,
    type: "agent_turn",
    action: input.action,
    details: input.details,
    ...(input.level ? { level: input.level } : {}),
    result: input.result,
    error: input.error,
  });
}

export function buildToolTrace(input: {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  mode: "read" | "mutating";
  minimumRole: AgentRole;
  requiresApproval: boolean;
  status:
    | "requested"
    | "approval_required"
    | "approved"
    | "rejected"
    | "denied"
    | "executed"
    | "failed";
  result?: string;
  error?: string;
}) {
  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    toolArgs: cloneForStorage(input.toolArgs),
    mode: input.mode,
    minimumRole: input.minimumRole,
    requiresApproval: input.requiresApproval,
    status: input.status,
    result: input.result ? serializeProcessLogDetails(input.result) : null,
    error: input.error || null,
    timestamp: new Date().toISOString(),
  };
}
