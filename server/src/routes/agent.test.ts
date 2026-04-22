import express from "express";
import request from "supertest";
import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const agentRouteMocks = vi.hoisted(() => ({
  authenticateAgentRequest: vi.fn(),
  isAgentAuthConfigured: vi.fn(),
  resolveAgentRoleFromPassword: vi.fn(),
  createAgentSessionId: vi.fn(),
  ensureAgentSession: vi.fn(),
  runAgentLoopStreaming: vi.fn(),
}));

vi.mock("../lib/agent/auth", () => ({
  authenticateAgentRequest: agentRouteMocks.authenticateAgentRequest,
  isAgentAuthConfigured: agentRouteMocks.isAgentAuthConfigured,
  resolveAgentRoleFromPassword: agentRouteMocks.resolveAgentRoleFromPassword,
}));

vi.mock("../lib/agent/logging", () => ({
  createAgentSessionId: agentRouteMocks.createAgentSessionId,
  ensureAgentSession: agentRouteMocks.ensureAgentSession,
}));

vi.mock("../lib/agent/loop", () => ({
  runAgentLoopStreaming: agentRouteMocks.runAgentLoopStreaming,
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
  agentRouteMocks.isAgentAuthConfigured.mockReset();
  agentRouteMocks.resolveAgentRoleFromPassword.mockReset();
  agentRouteMocks.createAgentSessionId.mockReset();
  agentRouteMocks.ensureAgentSession.mockReset();
  agentRouteMocks.runAgentLoopStreaming.mockReset();
  agentRouteMocks.isAgentAuthConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("agent route returns 503 when auth is not configured", async () => {
  agentRouteMocks.isAgentAuthConfigured.mockReturnValue(false);

  const res = await request(createApp()).post("/auth").send({});

  assert.equal(res.status, 503);
  assert.match(res.body.error, /Agent auth is not configured/);
});

test("agent auth endpoint validates password and creates or reuses session ids", async () => {
  agentRouteMocks.resolveAgentRoleFromPassword
    .mockReturnValueOnce(null)
    .mockReturnValueOnce("operator")
    .mockReturnValueOnce("admin");
  agentRouteMocks.createAgentSessionId.mockReturnValue("generated-session");

  const app = createApp();

  const invalid = await request(app).post("/auth").send({ password: "bad" });
  assert.equal(invalid.status, 401);
  assert.deepEqual(invalid.body, { error: "Invalid agent password" });

  const generated = await request(app)
    .post("/auth")
    .set("user-agent", "agent-ui")
    .set("x-forwarded-for", "1.2.3.4, 5.6.7.8")
    .send({ password: "good" });
  assert.equal(generated.status, 200);
  assert.deepEqual(generated.body, {
    success: true,
    role: "operator",
    sessionId: "generated-session",
  });
  assert.deepEqual(agentRouteMocks.ensureAgentSession.mock.calls[0][0], {
    sessionId: "generated-session",
    role: "operator",
    userAgent: "agent-ui",
    ipAddress: "1.2.3.4",
  });

  const reused = await request(app)
    .post("/auth")
    .send({ password: "good", sessionId: "  custom-session  " });
  assert.equal(reused.status, 200);
  assert.equal(reused.body.sessionId, "custom-session");
});

test("agent main endpoint validates auth, required fields, and streams SSE token/done events", async () => {
  agentRouteMocks.authenticateAgentRequest
    .mockReturnValueOnce(null)
    .mockReturnValueOnce({ role: "viewer", source: "header" })
    .mockReturnValue({ role: "viewer", source: "header" });

  agentRouteMocks.runAgentLoopStreaming.mockImplementation(
    async function* (input: Record<string, unknown>) {
      assert.equal(input.sessionId, "sess-1");
      assert.equal(input.role, "viewer");
      assert.equal(input.provider, "openai");
      assert.deepEqual(input.history, [{ role: "user", content: "older" }]);
      assert.equal(input.userMessage, "hello");
      assert.equal(input.userAgent, "agent-ui");
      assert.equal(input.ipAddress, "9.9.9.9");
      yield { type: "token", token: "Hi" };
      yield { type: "step", step: { type: "tool_call", toolName: "get_account_info" } };
      yield { type: "done", response: "Hi there", sessionId: "sess-1" };
    },
  );

  const app = createApp();

  const unauthorized = await request(app).post("/").send({});
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(unauthorized.body, { error: "Unauthorized agent request" });

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

test("agent approval endpoint validates payload and streams approval-required/error events", async () => {
  agentRouteMocks.authenticateAgentRequest
    .mockReturnValueOnce(null)
    .mockReturnValue({ role: "operator", source: "header" });

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

  const unauthorized = await request(app).post("/approval").send({});
  assert.equal(unauthorized.status, 401);

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
  agentRouteMocks.authenticateAgentRequest.mockReturnValue({
    role: "viewer",
    source: "header",
  });
  agentRouteMocks.runAgentLoopStreaming.mockImplementation(
    async function* () {
      yield { type: "error", error: "agent failed" };
    },
  );

  const res = await request(createApp())
    .post("/")
    .send({ message: "hello", sessionId: "sess-1" });

  assert.equal(res.status, 200);
  assert.match(res.text, /event: error/);
  assert.match(res.text, /agent failed/);
});
