import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const loopMocks = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  providerClients: [] as Array<Record<string, unknown>>,
  getCodexPatunginConfig: vi.fn(),
  connectDB: vi.fn(),
  accountFind: vi.fn(),
  ensureAgentSession: vi.fn(),
  createAgentTurn: vi.fn(),
  createAgentTurnProcessId: vi.fn(),
  loadAgentTurn: vi.fn(),
  updateAgentTurnState: vi.fn(),
  logAgentTurnEvent: vi.fn(),
  buildToolTrace: vi.fn(),
  getAgentApprovalRequired: vi.fn(),
  hasRequiredAgentRole: vi.fn(),
  getAgentToolPolicy: vi.fn(),
  toolExecutors: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = {
      completions: {
        create: loopMocks.openaiCreate,
      },
    };

    constructor(options: Record<string, unknown>) {
      loopMocks.providerClients.push(options);
    }
  },
}));

vi.mock("@copytrade/shared/lib/ai/CodexPatunginConfig", () => ({
  getCodexPatunginConfig: loopMocks.getCodexPatunginConfig,
}));

vi.mock("@copytrade/shared/lib/database", () => ({
  Account: {
    find: loopMocks.accountFind,
  },
  connectDB: loopMocks.connectDB,
}));

vi.mock("./tools", () => ({
  agentTools: [{ type: "function", function: { name: "read_tool" } }],
  toolImplementations: loopMocks.toolExecutors,
}));

vi.mock("./auth", () => ({
  getAgentApprovalRequired: loopMocks.getAgentApprovalRequired,
  hasRequiredAgentRole: loopMocks.hasRequiredAgentRole,
}));

vi.mock("./logging", () => ({
  ensureAgentSession: loopMocks.ensureAgentSession,
  createAgentTurn: loopMocks.createAgentTurn,
  createAgentTurnProcessId: loopMocks.createAgentTurnProcessId,
  loadAgentTurn: loopMocks.loadAgentTurn,
  updateAgentTurnState: loopMocks.updateAgentTurnState,
  logAgentTurnEvent: loopMocks.logAgentTurnEvent,
  buildToolTrace: loopMocks.buildToolTrace,
}));

vi.mock("./policies", () => ({
  getAgentToolPolicy: loopMocks.getAgentToolPolicy,
}));

import { runAgentFull, runAgentLoopStreaming } from "./loop";

function createQuery(result: unknown) {
  const sort = vi.fn();
  const lean = vi.fn();
  const exec = vi.fn();
  const query = { sort, lean, exec };
  sort.mockReturnValue(query);
  lean.mockReturnValue(query);
  exec.mockResolvedValue(result);
  return query;
}

function streamFromDeltas(
  deltas: Array<Record<string, unknown>>,
): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield { choices: [{ delta }] };
      }
    },
  };
}

beforeEach(() => {
  process.env.GLM_API_KEY = "glm-key";
  delete process.env.AI_PROVIDER;

  loopMocks.openaiCreate.mockReset();
  loopMocks.providerClients.length = 0;
  loopMocks.getCodexPatunginConfig.mockReset();
  loopMocks.connectDB.mockReset();
  loopMocks.accountFind.mockReset();
  loopMocks.ensureAgentSession.mockReset();
  loopMocks.createAgentTurn.mockReset();
  loopMocks.createAgentTurnProcessId.mockReset();
  loopMocks.loadAgentTurn.mockReset();
  loopMocks.updateAgentTurnState.mockReset();
  loopMocks.logAgentTurnEvent.mockReset();
  loopMocks.buildToolTrace.mockReset();
  loopMocks.getAgentApprovalRequired.mockReset();
  loopMocks.hasRequiredAgentRole.mockReset();
  loopMocks.getAgentToolPolicy.mockReset();
  Object.keys(loopMocks.toolExecutors).forEach((key) => delete loopMocks.toolExecutors[key]);

  loopMocks.getCodexPatunginConfig.mockReturnValue({
    apiKey: "",
    baseURL: "https://patungin.example/v1",
    model: "patungin-test",
    headers: {},
  });
  loopMocks.connectDB.mockResolvedValue(undefined);
  loopMocks.accountFind.mockReturnValue(createQuery([]));
  loopMocks.ensureAgentSession.mockResolvedValue(undefined);
  loopMocks.createAgentTurnProcessId.mockReturnValue("proc-generated");
  loopMocks.createAgentTurn.mockResolvedValue({ processId: "proc-generated" });
  loopMocks.updateAgentTurnState.mockResolvedValue(undefined);
  loopMocks.logAgentTurnEvent.mockResolvedValue(undefined);
  loopMocks.buildToolTrace.mockImplementation((input) => input);
  loopMocks.getAgentApprovalRequired.mockReturnValue(false);
  loopMocks.hasRequiredAgentRole.mockReturnValue(true);
  loopMocks.getAgentToolPolicy.mockReturnValue({
    mode: "read",
    minimumRole: "viewer",
    requiresApproval: false,
  });
});

test("runAgentLoopStreaming completes a new turn and reuses configured source context", async () => {
  loopMocks.accountFind.mockReturnValue(
    createQuery([
      {
        _id: "src-1",
        name: "VIP Source",
        isActive: true,
        sourceType: "discord",
        channelIds: ["1", "2"],
      },
    ]),
  );
  loopMocks.openaiCreate.mockResolvedValueOnce(
    streamFromDeltas([{ content: "Hello " }, { content: "world" }]),
  );

  const events: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-1",
    role: "viewer",
    history: [{ role: "user", content: "prior" }],
    userMessage: "status?",
  })) {
    events.push(event);
  }

  assert.equal(events.at(-1)?.type, "done");
  assert.equal(events.at(-1)?.response, "Hello world");
  assert.equal(loopMocks.ensureAgentSession.mock.calls.length, 1);
  assert.equal(loopMocks.createAgentTurn.mock.calls.length, 1);
  assert.equal(loopMocks.updateAgentTurnState.mock.calls.length > 0, true);
  assert.match(
    String(loopMocks.createAgentTurn.mock.calls[0][0].messages[0].content),
    /Configured Signal Sources Right Now/,
  );
});

test("runAgentFull collects streamed events for resumed approval turns", async () => {
  loopMocks.loadAgentTurn.mockResolvedValueOnce({
    sessionId: "session-full",
    status: "awaiting_approval",
    userMessage: "resume",
    history: [],
    provider: "glm",
    messages: [],
    pendingToolCalls: [],
    assistantResponse: "",
    toolTraces: [],
  });
  loopMocks.openaiCreate.mockResolvedValueOnce(
    streamFromDeltas([{ content: "Wrapped " }, { content: "response" }]),
  );

  const result = await runAgentFull(
    "ignored",
    [],
    undefined,
    "session-full",
    "viewer",
  );

  assert.equal(result.response, "Wrapped response");
  assert.equal(result.events.at(-1)?.type, "done");
});

test("runAgentLoopStreaming pauses for approval on mutating tools", async () => {
  loopMocks.getAgentApprovalRequired.mockReturnValue(true);
  loopMocks.getAgentToolPolicy.mockReturnValue({
    mode: "mutating",
    minimumRole: "operator",
    requiresApproval: true,
  });
  loopMocks.openaiCreate.mockResolvedValueOnce(
    streamFromDeltas([
      {
        content: "Need approval",
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            function: {
              name: "cancel_order",
              arguments: '{"orderId":"123"}',
            },
          },
        ],
      },
    ]),
  );

  const events: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-approval",
    role: "operator",
    userMessage: "cancel it",
  })) {
    events.push(event);
  }

  assert.equal(events.at(-1)?.type, "approval_required");
  assert.equal(
    loopMocks.updateAgentTurnState.mock.calls.at(-1)?.[1]?.status,
    "awaiting_approval",
  );
});

test("runAgentLoopStreaming denies tools when no policy exists or the role is insufficient", async () => {
  loopMocks.loadAgentTurn
    .mockResolvedValueOnce({
      sessionId: "session-no-policy",
      status: "awaiting_approval",
      userMessage: "x",
      history: [],
      provider: "glm",
      messages: [],
      pendingToolCalls: [{ id: "call-1", name: "missing_tool", arguments: "{}" }],
      assistantResponse: "",
      toolTraces: [],
    })
    .mockResolvedValueOnce({
      sessionId: "session-role-denied",
      status: "awaiting_approval",
      userMessage: "x",
      history: [],
      provider: "glm",
      messages: [],
      pendingToolCalls: [{ id: "call-2", name: "admin_tool", arguments: "{}" }],
      assistantResponse: "",
      toolTraces: [],
    });

  loopMocks.openaiCreate
    .mockResolvedValueOnce(streamFromDeltas([{ content: "done one" }]))
    .mockResolvedValueOnce(streamFromDeltas([{ content: "done two" }]));

  loopMocks.getAgentToolPolicy
    .mockReturnValueOnce(null)
    .mockReturnValueOnce({
      mode: "read",
      minimumRole: "admin",
      requiresApproval: false,
    });
  loopMocks.hasRequiredAgentRole.mockReturnValueOnce(false);

  const firstEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-no-policy",
    role: "operator",
    processId: "proc-no-policy",
  })) {
    firstEvents.push(event);
  }

  const secondEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-role-denied",
    role: "viewer",
    processId: "proc-role-denied",
  })) {
    secondEvents.push(event);
  }

  assert.equal(firstEvents.some((event) => event.type === "step"), true);
  assert.equal(secondEvents.some((event) => event.type === "step"), true);
  assert.equal(loopMocks.buildToolTrace.mock.calls.length >= 2, true);
});

test("runAgentLoopStreaming handles invalid args, unknown tools, executor failures, and executor success on resumed turns", async () => {
  loopMocks.toolExecutors.read_tool = vi
    .fn()
    .mockResolvedValueOnce('{"ok":true}')
    .mockRejectedValueOnce(new Error("executor blew up"));

  loopMocks.loadAgentTurn
    .mockResolvedValueOnce({
      sessionId: "session-invalid",
      status: "awaiting_approval",
      userMessage: "x",
      history: [],
      provider: "glm",
      messages: [],
      pendingToolCalls: [{ id: "call-bad", name: "read_tool", arguments: "{bad" }],
      assistantResponse: "",
      toolTraces: [],
    })
    .mockResolvedValueOnce({
      sessionId: "session-unknown",
      status: "awaiting_approval",
      userMessage: "x",
      history: [],
      provider: "glm",
      messages: [],
      pendingToolCalls: [{ id: "call-unknown", name: "unknown_tool", arguments: "{}" }],
      assistantResponse: "",
      toolTraces: [],
    })
    .mockResolvedValueOnce({
      sessionId: "session-success",
      status: "awaiting_approval",
      userMessage: "x",
      history: [{ role: "assistant", content: "prior" }],
      provider: "glm",
      messages: [],
      pendingToolCalls: [{ id: "call-ok", name: "read_tool", arguments: '{"value":1}' }],
      assistantResponse: "",
      toolTraces: [{ old: true }],
    })
    .mockResolvedValueOnce({
      sessionId: "session-fail",
      status: "awaiting_approval",
      userMessage: "x",
      history: [],
      provider: "glm",
      messages: [],
      pendingToolCalls: [{ id: "call-fail", name: "read_tool", arguments: '{"value":2}' }],
      assistantResponse: "",
      toolTraces: [],
    });

  loopMocks.openaiCreate
    .mockResolvedValueOnce(streamFromDeltas([{ content: "after invalid" }]))
    .mockResolvedValueOnce(streamFromDeltas([{ content: "after unknown" }]))
    .mockResolvedValueOnce(streamFromDeltas([{ content: "after success" }]))
    .mockResolvedValueOnce(streamFromDeltas([{ content: "after failure" }]));

  loopMocks.getAgentToolPolicy.mockReturnValue({
    mode: "read",
    minimumRole: "viewer",
    requiresApproval: false,
  });

  const collected: Array<Array<Record<string, unknown>>> = [];
  for (const input of [
    { sessionId: "session-invalid", processId: "proc-invalid" },
    { sessionId: "session-unknown", processId: "proc-unknown" },
    { sessionId: "session-success", processId: "proc-success" },
    { sessionId: "session-fail", processId: "proc-fail" },
  ]) {
    const events: Array<Record<string, unknown>> = [];
    for await (const event of runAgentLoopStreaming({
      ...input,
      role: "viewer",
    })) {
      events.push(event);
    }
    collected.push(events);
  }

  assert.equal(collected.every((events) => events.at(-1)?.type === "done"), true);
  assert.equal(loopMocks.toolExecutors.read_tool.mock.calls.length, 2);
  assert.equal(loopMocks.logAgentTurnEvent.mock.calls.length > 0, true);
});

test("runAgentLoopStreaming retries provider keys, reports validation failures, and surfaces resumed-turn errors", async () => {
  loopMocks.connectDB.mockRejectedValueOnce(new Error("db offline"));
  loopMocks.openaiCreate
    .mockRejectedValueOnce(new Error("401 unauthorized"))
    .mockResolvedValueOnce(streamFromDeltas([{ content: "retry ok" }]));

  const retryEvents: Array<Record<string, unknown>> = [];
  process.env.GLM_API_KEY = "bad-key,good-key";
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-retry",
    role: "viewer",
    userMessage: "hello",
  })) {
    retryEvents.push(event);
  }

  const missingMessageEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-missing",
    role: "viewer",
    userMessage: "   ",
  })) {
    missingMessageEvents.push(event);
  }

  loopMocks.loadAgentTurn.mockResolvedValueOnce(null);
  const missingTurnEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-load",
    role: "viewer",
    processId: "proc-missing",
  })) {
    missingTurnEvents.push(event);
  }

  assert.equal(retryEvents.at(-1)?.type, "done");
  assert.equal(loopMocks.providerClients.length >= 2, true);
  assert.equal(missingMessageEvents.at(-1)?.type, "error");
  assert.equal(missingTurnEvents.at(-1)?.type, "error");
});

test("runAgentLoopStreaming reports resumed-turn session mismatch and invalid status", async () => {
  loopMocks.loadAgentTurn
    .mockResolvedValueOnce({
      sessionId: "other-session",
      status: "awaiting_approval",
      userMessage: "x",
      history: [],
      provider: "glm",
      messages: [],
      pendingToolCalls: [],
      assistantResponse: "",
      toolTraces: [],
    })
    .mockResolvedValueOnce({
      sessionId: "session-status",
      status: "completed",
      userMessage: "x",
      history: [],
      provider: "glm",
      messages: [],
      pendingToolCalls: [],
      assistantResponse: "",
      toolTraces: [],
    });

  const mismatchEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-mismatch",
    role: "viewer",
    processId: "proc-mismatch",
  })) {
    mismatchEvents.push(event);
  }

  const statusEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-status",
    role: "viewer",
    processId: "proc-status",
  })) {
    statusEvents.push(event);
  }

  assert.equal(mismatchEvents.at(-1)?.type, "error");
  assert.match(String(mismatchEvents.at(-1)?.error), /does not belong to session/);
  assert.equal(statusEvents.at(-1)?.type, "error");
  assert.match(String(statusEvents.at(-1)?.error), /is not awaiting approval/);
});

test("runAgentLoopStreaming executes approved mutating tools and supports provider-specific config", async () => {
  process.env.OPENAI_API_KEY = "openai-key";
  process.env.OPENAI_BASE_URL = "https://openai-proxy.example/v1";
  process.env.OPENAI_MODEL = "gpt-openai-test";
  loopMocks.getCodexPatunginConfig.mockReturnValue({
    apiKey: "pat-key",
    baseURL: "https://patungin.example/v9",
    model: "pat-model",
    headers: { "X-Pat": "1" },
  });
  loopMocks.toolExecutors.mutate_tool = vi.fn().mockResolvedValue('{"ok":true}');
  loopMocks.getAgentApprovalRequired.mockReturnValue(true);
  loopMocks.getAgentToolPolicy.mockReturnValue({
    mode: "mutating",
    minimumRole: "operator",
    requiresApproval: true,
  });
  loopMocks.loadAgentTurn.mockResolvedValueOnce({
    sessionId: "session-approved",
    status: "awaiting_approval",
    userMessage: "x",
    history: [],
    provider: "openai",
    messages: [],
    pendingToolCalls: [{ id: "call-approve", name: "mutate_tool", arguments: '{"size":1}' }],
    assistantResponse: "",
    toolTraces: [],
  });
  loopMocks.openaiCreate.mockResolvedValueOnce(
    streamFromDeltas([{ content: "approved path" }]),
  );

  const approvedEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-approved",
    role: "operator",
    processId: "proc-approved",
    decision: "approve",
  })) {
    approvedEvents.push(event);
  }

  loopMocks.openaiCreate.mockResolvedValueOnce(
    streamFromDeltas([{ content: "codex path" }]),
  );
  const codexEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-codex",
    role: "viewer",
    userMessage: "hello",
    provider: "codex",
  })) {
    codexEvents.push(event);
  }

  assert.equal(approvedEvents.at(-1)?.type, "done");
  assert.equal(loopMocks.toolExecutors.mutate_tool.mock.calls.length, 1);
  assert.equal(
    loopMocks.logAgentTurnEvent.mock.calls.some(
      (call) => call[0]?.action === "tool_approval_granted",
    ),
    true,
  );
  assert.equal(codexEvents.at(-1)?.type, "done");
  assert.deepEqual(loopMocks.providerClients.at(-1), {
    apiKey: "pat-key",
    baseURL: "https://patungin.example/v9",
    defaultHeaders: { "X-Pat": "1" },
  });
});

test("runAgentLoopStreaming aborts resumed turns without emitting an error event", async () => {
  loopMocks.loadAgentTurn.mockResolvedValueOnce({
    sessionId: "session-abort",
    status: "awaiting_approval",
    userMessage: "resume",
    history: [],
    provider: "glm",
    messages: [],
    pendingToolCalls: [],
    assistantResponse: "",
    toolTraces: [],
  });

  const controller = new AbortController();
  controller.abort();

  const events: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-abort",
    role: "viewer",
    processId: "proc-abort",
    signal: controller.signal,
  })) {
    events.push(event);
  }

  assert.deepEqual(events, []);
  assert.equal(
    loopMocks.updateAgentTurnState.mock.calls.some(
      (call) => call[0] === "proc-abort" && call[1]?.status === "aborted",
    ),
    true,
  );
  assert.equal(
    loopMocks.logAgentTurnEvent.mock.calls.some(
      (call) => call[0]?.action === "turn_aborted" && call[0]?.processId === "proc-abort",
    ),
    true,
  );
});

test("runAgentLoopStreaming reports missing provider keys and uses kimi provider fallbacks", async () => {
  const originalKey = process.env.GLM_API_KEY;
  delete process.env.GLM_API_KEY;

  try {
    const noKeyEvents: Array<Record<string, unknown>> = [];
    for await (const event of runAgentLoopStreaming({
      sessionId: "session-no-key",
      role: "viewer",
      userMessage: "hello",
      provider: "glm",
    })) {
      noKeyEvents.push(event);
    }

    assert.equal(noKeyEvents.at(-1)?.type, "error");
    assert.match(
      String(noKeyEvents.at(-1)?.error),
      /No valid API keys configured for the selected AI provider/,
    );
  } finally {
    process.env.GLM_API_KEY = originalKey;
  }

  process.env.ANTHROPIC_API_KEY = "kimi-bad,kimi-good";
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_MODEL;
  loopMocks.openaiCreate
    .mockRejectedValueOnce(new Error("token expired"))
    .mockResolvedValueOnce(streamFromDeltas([{ content: "kimi ok" }]));

  const kimiEvents: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-kimi",
    role: "viewer",
    userMessage: "hello",
    provider: "kimi",
  })) {
    kimiEvents.push(event);
  }

  assert.equal(kimiEvents.at(-1)?.type, "done");
  assert.deepEqual(loopMocks.providerClients.at(-2), {
    apiKey: "kimi-bad",
    baseURL: "https://api.kimi.com/coding/",
  });
  assert.deepEqual(loopMocks.providerClients.at(-1), {
    apiKey: "kimi-good",
    baseURL: "https://api.kimi.com/coding/",
  });
});

test("runAgentLoopStreaming records explicit approval rejections before continuing", async () => {
  loopMocks.getAgentApprovalRequired.mockReturnValue(true);
  loopMocks.getAgentToolPolicy.mockReturnValue({
    mode: "mutating",
    minimumRole: "operator",
    requiresApproval: true,
  });
  loopMocks.loadAgentTurn.mockResolvedValueOnce({
    sessionId: "session-reject",
    status: "awaiting_approval",
    userMessage: "x",
    history: [],
    provider: "glm",
    messages: [],
    pendingToolCalls: [{ id: "call-reject", name: "cancel_order", arguments: '{"orderId":"1"}' }],
    assistantResponse: "",
    toolTraces: [],
  });
  loopMocks.openaiCreate.mockResolvedValueOnce(
    streamFromDeltas([{ content: "rejection handled" }]),
  );

  const events: Array<Record<string, unknown>> = [];
  for await (const event of runAgentLoopStreaming({
    sessionId: "session-reject",
    role: "operator",
    processId: "proc-reject",
    decision: "reject",
  })) {
    events.push(event);
  }

  assert.equal(events.at(-1)?.type, "done");
  assert.equal(
    events.some(
      (event) =>
        event.type === "step" &&
        String(event.step?.content).includes('"approvalRejected":true'),
    ),
    true,
  );
  assert.equal(
    loopMocks.logAgentTurnEvent.mock.calls.some(
      (call) =>
        call[0]?.action === "tool_approval_rejected" &&
        call[0]?.processId === "proc-reject",
    ),
    true,
  );
});
