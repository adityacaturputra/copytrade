import express from "express";
import request from "supertest";
import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const agentRouteMocks = vi.hoisted(() => ({
  authenticateAgentRequest: vi.fn(),
  createAgentSessionId: vi.fn(),
  ensureAgentSession: vi.fn(),
  runAgentLoopStreaming: vi.fn(),
}));

vi.mock("../lib/agent/auth", () => ({
  authenticateAgentRequest: agentRouteMocks.authenticateAgentRequest,
  isAgentAuthConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock("../lib/agent/logging", () => ({
  createAgentSessionId: agentRouteMocks.createAgentSessionId,
  ensureAgentSession: agentRouteMocks.ensureAgentSession,
}));

vi.mock("../lib/agent/loop/index", () => ({
  runAgentLoopStreaming: agentRouteMocks.runAgentLoopStreaming,
}));

vi.mock("../lib/action-auth", () => ({
  getActionPasswordHeader: vi.fn().mockReturnValue(undefined),
}));

import agentRouter from "./agent";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/", agentRouter);
  return app;
}

beforeEach(() => {
  agentRouteMocks.authenticateAgentRequest.mockReset();
  agentRouteMocks.createAgentSessionId.mockReset();
  agentRouteMocks.ensureAgentSession.mockReset();
  agentRouteMocks.runAgentLoopStreaming.mockReset();

  // Default: always authenticated as admin
  agentRouteMocks.authenticateAgentRequest.mockReturnValue({
    role: "admin",
    source: "default",
  });
  agentRouteMocks.createAgentSessionId.mockReturnValue("generated-session");
  agentRouteMocks.ensureAgentSession.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("agent auth endpoint creates or reuses session ids", async () => {
  const app = createApp();

  const generated = await request(app)
    .post("/auth")
    .set("user-agent", "agent-ui")
    .set("x-forwarded-for", "1.2.3.4, 5.6.7.8")
    .send({});
  assert.equal(generated.status, 200);
  assert.equal(generated.body.success, true);
  assert.equal(generated.body.role, "admin");
  assert.equal(generated.body.sessionId, "generated-session");
  assert.deepEqual(agentRouteMocks.ensureAgentSession.mock.calls[0][0], {
    sessionId: "generated-session",
    role: "admin",
    userAgent: "agent-ui",
    ipAddress: "1.2.3.4",
  });

  const reused = await request(app)
    .post("/auth")
    .send({ sessionId: "  custom-session  " });
  assert.equal(reused.status, 200);
  assert.equal(reused.body.sessionId, "custom-session");
});

test("agent main endpoint validates required fields and streams SSE events", async () => {
  agentRouteMocks.runAgentLoopStreaming.mockImplementation(async function* (
    input: Record<string, unknown>,
  ) {
    assert.equal(input.sessionId, "sess-1");
    assert.equal(input.role, "admin");
    assert.equal(input.provider, "openai");
    assert.deepEqual(input.history, [{ role: "user", content: "older" }]);
    assert.equal(input.userMessage, "hello");
    yield { type: "token", token: "Hi" };
    yield {
      type: "step",
      step: { type: "tool_call", toolName: "get_account_info" },
    };
    yield { type: "done", response: "Hi there", sessionId: "sess-1" };
  });

  const app = createApp();

  const missingMessage = await request(app)
    .post("/")
    .send({ sessionId: "sess-1" });
  assert.equal(missingMessage.status, 400);
  assert.deepEqual(missingMessage.body, { error: "Message is required" });

  const missingSession = await request(app)
    .post("/")
    .send({ message: "hello" });
  assert.equal(missingSession.status, 400);
  assert.deepEqual(missingSession.body, { error: "sessionId is required" });

  const streamed = await request(app)
    .post("/")
    .set("user-agent", "agent-ui")
    .set("x-forwarded-for", "9.9.9.9")
    .send({
      message: "hello",
      sessionId: "sess-1",
      provider: "openai",
      history: [{ role: "user", content: "older" }],
    });

  assert.equal(streamed.status, 200);
  assert.match(streamed.text, /event: status/);
  assert.match(streamed.text, /event: token/);
  assert.match(streamed.text, /event: step/);
  assert.match(streamed.text, /event: done/);
  assert.match(streamed.text, /"response":"Hi there"/);
});

test("agent approval endpoint validates payload and streams approval-required events", async () => {
  agentRouteMocks.runAgentLoopStreaming.mockImplementationOnce(
    async function* () {
      yield {
        type: "approval_required",
        approval: {
          sessionId: "sess-2",
          processId: "proc-2",
          reason: "approve tool",
        },
      };
    },
  );

  const app = createApp();

  const missingSession = await request(app)
    .post("/approval")
    .send({ processId: "proc-1", decision: "approve" });
  assert.equal(missingSession.status, 400);
  assert.deepEqual(missingSession.body, { error: "sessionId is required" });

  const missingProcess = await request(app)
    .post("/approval")
    .send({ sessionId: "sess-1", decision: "approve" });
  assert.equal(missingProcess.status, 400);
  assert.deepEqual(missingProcess.body, { error: "processId is required" });

  const badDecision = await request(app)
    .post("/approval")
    .send({ sessionId: "sess-1", processId: "proc-1", decision: "maybe" });
  assert.equal(badDecision.status, 400);
  assert.deepEqual(badDecision.body, {
    error: "decision must be 'approve' or 'reject'",
  });

  const approval = await request(app)
    .post("/approval")
    .send({ sessionId: "sess-2", processId: "proc-2", decision: "approve" });
  assert.equal(approval.status, 200);
  assert.match(approval.text, /event: approval_required/);
  assert.match(approval.text, /awaiting_approval/);
});

test("agent route streams error events and closes the response", async () => {
  agentRouteMocks.runAgentLoopStreaming.mockImplementation(async function* () {
    yield { type: "error", error: "agent failed" };
  });

  const res = await request(createApp())
    .post("/")
    .send({ message: "hello", sessionId: "sess-1" });

  assert.equal(res.status, 200);
  assert.match(res.text, /event: error/);
  assert.match(res.text, /agent failed/);
});
