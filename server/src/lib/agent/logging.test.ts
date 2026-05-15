import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const loggingMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  agentSessionFindOneAndUpdate: vi.fn(),
  agentTurnCreate: vi.fn(),
  agentTurnFindOne: vi.fn(),
  agentTurnFindOneAndUpdate: vi.fn(),
  createTradeProcessId: vi.fn(),
  logProcessStep: vi.fn(),
  serializeProcessLogDetails: vi.fn((value: unknown) =>
    value === undefined ? undefined : `serialized:${String(value)}`,
  ),
}));

vi.mock("@copytrade/shared/lib/database/index", () => ({
  connectDB: loggingMocks.connectDB,
  AgentSession: {
    findOneAndUpdate: loggingMocks.agentSessionFindOneAndUpdate,
  },
  AgentTurn: {
    create: loggingMocks.agentTurnCreate,
    findOne: loggingMocks.agentTurnFindOne,
    findOneAndUpdate: loggingMocks.agentTurnFindOneAndUpdate,
  },
}));

vi.mock("@copytrade/shared/lib/process/log", () => ({
  createTradeProcessId: loggingMocks.createTradeProcessId,
  logProcessStep: loggingMocks.logProcessStep,
  serializeProcessLogDetails: loggingMocks.serializeProcessLogDetails,
}));

import {
  buildToolTrace,
  createAgentSessionId,
  createAgentTurn,
  createAgentTurnProcessId,
  ensureAgentSession,
  loadAgentTurn,
  logAgentTurnEvent,
  updateAgentTurnState,
} from "./logging";

beforeEach(() => {
  loggingMocks.connectDB.mockReset();
  loggingMocks.agentSessionFindOneAndUpdate.mockReset();
  loggingMocks.agentTurnCreate.mockReset();
  loggingMocks.agentTurnFindOne.mockReset();
  loggingMocks.agentTurnFindOneAndUpdate.mockReset();
  loggingMocks.createTradeProcessId.mockReset();
  loggingMocks.logProcessStep.mockReset();
  loggingMocks.serializeProcessLogDetails.mockClear();
});

test("agent logging creates session and turn ids from process log ids", () => {
  loggingMocks.createTradeProcessId
    .mockReturnValueOnce("agentsess_1")
    .mockReturnValueOnce("agentturn_1");

  assert.equal(createAgentSessionId(), "agentsess_1");
  assert.equal(createAgentTurnProcessId(), "agentturn_1");
  assert.deepEqual(loggingMocks.createTradeProcessId.mock.calls, [
    ["agentsess"],
    ["agentturn"],
  ]);
});

test("ensureAgentSession persists the session with normalized nullable fields", async () => {
  const exec = vi.fn().mockResolvedValue({ ok: true });
  loggingMocks.agentSessionFindOneAndUpdate.mockReturnValue({ exec });

  const result = await ensureAgentSession({
    sessionId: "sess-1",
    role: "admin",
  });

  const [filter, update, options] =
    loggingMocks.agentSessionFindOneAndUpdate.mock.calls[0];
  assert.deepEqual(filter, { sessionId: "sess-1" });
  assert.equal(update.$set.role, "admin");
  assert.equal(update.$set.status, "active");
  assert.equal(update.$set.userAgent, null);
  assert.equal(update.$set.ipAddress, null);
  assert.equal(update.$set.lastActivityAt instanceof Date, true);
  assert.deepEqual(update.$setOnInsert, { sessionId: "sess-1" });
  assert.deepEqual(options, { upsert: true, new: true });
  assert.deepEqual(result, { ok: true });
});

test("createAgentTurn stores cloned payloads and logs a truncated start event", async () => {
  const storedTurn = { id: "turn-1" };
  loggingMocks.agentTurnCreate.mockResolvedValue(storedTurn);

  const history = [{ role: "user" as const, content: "hello" }];
  const messages = [{ a: 1 }];
  const userMessage = "x".repeat(900);
  const result = await createAgentTurn({
    sessionId: "sess-1",
    processId: "proc-1",
    role: "operator",
    provider: "openai",
    userMessage,
    history,
    messages,
  });

  assert.strictEqual(result, storedTurn);
  const payload = loggingMocks.agentTurnCreate.mock.calls[0][0];
  assert.equal(payload.status, "running");
  assert.notStrictEqual(payload.history, history);
  assert.notStrictEqual(payload.messages, messages);
  assert.equal(loggingMocks.logProcessStep.mock.calls[0][0].action, "turn_started");
  assert.equal(
    (loggingMocks.logProcessStep.mock.calls[0][0].details as { userMessage: string })
      .userMessage.length,
    800,
  );
});

test("loadAgentTurn and updateAgentTurnState read and patch persisted turns", async () => {
  const findExec = vi.fn().mockResolvedValue({ processId: "proc-1" });
  loggingMocks.agentTurnFindOne.mockReturnValue({ exec: findExec });
  const updateExec = vi.fn().mockResolvedValue({ updated: true });
  loggingMocks.agentTurnFindOneAndUpdate.mockReturnValue({ exec: updateExec });

  const loaded = await loadAgentTurn("proc-1");
  assert.deepEqual(loaded, { processId: "proc-1" });

  const messages = [{ foo: "bar" }];
  const update = await updateAgentTurnState("proc-1", {
    status: "completed",
    assistantResponse: "y".repeat(21000),
    error: "",
    messages,
    pendingToolCalls: [{ tool: "a" }],
    pendingApproval: { need: true },
    toolTraces: [{ trace: 1 }],
    completedAt: null,
  });

  assert.deepEqual(update, { updated: true });
  const updatePayload = loggingMocks.agentTurnFindOneAndUpdate.mock.calls[0][1].$set;
  assert.equal(updatePayload.status, "completed");
  assert.equal(updatePayload.assistantResponse.length, 20000);
  assert.equal(updatePayload.error, null);
  assert.notStrictEqual(updatePayload.messages, messages);
  assert.equal(updatePayload.completedAt, null);
});

test("logAgentTurnEvent delegates to process log and buildToolTrace serializes results", async () => {
  await logAgentTurnEvent({
    processId: "proc-1",
    action: "tool_called",
    result: "ok",
    error: "warn",
    details: { tool: "x" },
  });

  assert.deepEqual(loggingMocks.logProcessStep.mock.calls[0][0], {
    processId: "proc-1",
    type: "agent_turn",
    action: "tool_called",
    details: { tool: "x" },
    result: "ok",
    error: "warn",
  });

  const trace = buildToolTrace({
    toolCallId: "tool-1",
    toolName: "get_account_info",
    toolArgs: { symbol: "BTCUSDT" },
    mode: "read",
    minimumRole: "viewer",
    requiresApproval: false,
    status: "executed",
    result: "done",
  });

  assert.equal(trace.result, "serialized:done");
  assert.equal(trace.error, null);
  assert.equal(typeof trace.timestamp, "string");
});
