import express from "express";
import request from "supertest";
import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const draftRouteMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  draftFind: vi.fn(),
  draftCountDocuments: vi.fn(),
  draftFindById: vi.fn(),
  draftCreate: vi.fn(),
  processedMessageUpdateOne: vi.fn(),
  analyzeMessagesWithAI: vi.fn(),
  createDraft: vi.fn(),
  executeSignal: vi.fn(),
  refreshDraftFromSignal: vi.fn(),
  resolveDraftWithExecution: vi.fn(),
  createTradeProcessId: vi.fn(),
  logProcessStep: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/database/index", () => ({
  connectDB: draftRouteMocks.connectDB,
  DraftTrade: {
    find: draftRouteMocks.draftFind,
    countDocuments: draftRouteMocks.draftCountDocuments,
    findById: draftRouteMocks.draftFindById,
    create: draftRouteMocks.draftCreate,
  },
  ProcessedMessage: {
    updateOne: draftRouteMocks.processedMessageUpdateOne,
  },
}));

vi.mock("@copytrade/shared/lib/executor/index", () => ({
  analyzeMessagesWithAI: draftRouteMocks.analyzeMessagesWithAI,
  createDraft: draftRouteMocks.createDraft,
  executeSignal: draftRouteMocks.executeSignal,
  refreshDraftFromSignal: draftRouteMocks.refreshDraftFromSignal,
  resolveDraftWithExecution: draftRouteMocks.resolveDraftWithExecution,
}));

vi.mock("@copytrade/shared/lib/process/log", () => ({
  createTradeProcessId: draftRouteMocks.createTradeProcessId,
  logProcessStep: draftRouteMocks.logProcessStep,
}));

import draftsRouter from "./drafts";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/", draftsRouter);
  return app;
}

function createFindQuery(results: unknown[]) {
  const sort = vi.fn();
  const skip = vi.fn();
  const limit = vi.fn();
  const lean = vi.fn();
  const query = {
    sort,
    skip,
    limit,
    lean,
  };

  sort.mockReturnValue(query);
  skip.mockReturnValue(query);
  limit.mockReturnValue(query);
  lean.mockResolvedValue(results);

  return query;
}

function createDraftDoc(overrides: Record<string, unknown> = {}) {
  const id = String(overrides.id || "draft-1");
  const draft: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = {
    _id: { toString: () => id },
    accountId: "acc-1",
    processId: "proc-1",
    messageId: "msg-1",
    channelId: "chan-1",
    messageUrl: "https://discord.com/channels/test/1",
    author: "Trader",
    originalContent: "Buy BTCUSDT",
    imageUrls: ["https://cdn.example.com/chart.png"],
    signalData: JSON.stringify({
      action: "BUY",
      symbol: "BTCUSDT",
      entryPrice: 62000,
      takeProfitTargets: [64000],
      stopLoss: 61000,
      defaultRR: 2,
    }),
    action: "BUY",
    symbol: "BTCUSDT",
    side: "LONG",
    entryPrice: 62000,
    takeProfitTargets: [64000],
    stopLoss: 61000,
    leverage: 10,
    quantity: 1,
    confidence: 0.9,
    reasoning: "clean setup",
    status: "pending",
    positionId: null,
    sourceTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    resolvedAt: null,
    save: vi.fn(),
  };

  Object.assign(draft, overrides);
  draft.save.mockResolvedValue(draft);
  return draft;
}

beforeEach(() => {
  vi.restoreAllMocks();

  draftRouteMocks.connectDB.mockReset();
  draftRouteMocks.draftFind.mockReset();
  draftRouteMocks.draftCountDocuments.mockReset();
  draftRouteMocks.draftFindById.mockReset();
  draftRouteMocks.draftCreate.mockReset();
  draftRouteMocks.processedMessageUpdateOne.mockReset();
  draftRouteMocks.analyzeMessagesWithAI.mockReset();
  draftRouteMocks.createDraft.mockReset();
  draftRouteMocks.executeSignal.mockReset();
  draftRouteMocks.refreshDraftFromSignal.mockReset();
  draftRouteMocks.resolveDraftWithExecution.mockReset();
  draftRouteMocks.createTradeProcessId.mockReset();
  draftRouteMocks.logProcessStep.mockReset();

  draftRouteMocks.connectDB.mockResolvedValue(undefined);
  draftRouteMocks.logProcessStep.mockResolvedValue(undefined);
  draftRouteMocks.createTradeProcessId.mockReturnValue("draftproc_generated");
});

test("drafts route lists drafts with normalized filters and handles query failures", async () => {
  draftRouteMocks.draftFind.mockReturnValue(
    createFindQuery([{ _id: "draft-a" }]),
  );
  draftRouteMocks.draftCountDocuments.mockResolvedValueOnce(2);
  draftRouteMocks.connectDB
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("db failed"));

  const app = createApp();

  const success = await request(app).get(
    "/?page=0&limit=999&channelId=chan-1&accountId=acc-1&status=pending",
  );
  assert.equal(success.status, 200);
  assert.deepEqual(draftRouteMocks.draftFind.mock.calls[0][0], {
    channelId: "chan-1",
    accountId: "acc-1",
    status: "pending",
  });
  assert.deepEqual(draftRouteMocks.draftCountDocuments.mock.calls[0][0], {
    channelId: "chan-1",
    accountId: "acc-1",
    status: "pending",
  });
  assert.equal(success.body.data.page, 1);
  assert.equal(success.body.data.limit, 100);
  assert.equal(success.body.data.totalPages, 1);

  const failure = await request(app).get("/");
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.body, {
    success: false,
    error: "db failed",
  });
});

test("accept route rejects missing, already resolved, and malformed drafts", async () => {
  const acceptedDraft = createDraftDoc({
    id: "draft-accepted",
    status: "accepted",
  });
  const badSignalDraft = createDraftDoc({
    id: "draft-bad-signal",
    signalData: "{not json}",
  });

  draftRouteMocks.draftFindById
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(acceptedDraft)
    .mockResolvedValueOnce(badSignalDraft);

  const app = createApp();

  const missing = await request(app).post("/draft-missing/accept").send({});
  assert.equal(missing.status, 404);

  const alreadyResolved = await request(app)
    .post("/draft-accepted/accept")
    .send({});
  assert.equal(alreadyResolved.status, 400);
  assert.match(alreadyResolved.body.error, /Draft already accepted/);

  const malformed = await request(app)
    .post("/draft-bad-signal/accept")
    .send({});
  assert.equal(malformed.status, 500);
  assert.match(malformed.body.error, /Invalid signal data/);
});

test("accept route executes pending drafts, persists generated process ids, and merges request RR", async () => {
  const draft = createDraftDoc({
    processId: "",
  });
  draftRouteMocks.draftFindById.mockResolvedValue(draft);
  draftRouteMocks.executeSignal.mockResolvedValue({ type: "executed" });
  draftRouteMocks.resolveDraftWithExecution.mockResolvedValue({
    status: "accepted",
    result: "executed",
    positionId: "pos-1",
    message: "Trade executed",
  });

  const response = await request(createApp())
    .post("/draft-1/accept")
    .send({ rr: 4 });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.positionId, "pos-1");
  assert.equal(response.body.data.message, "Trade executed");
  assert.equal(draft.save.mock.calls.length, 1);
  assert.equal(draftRouteMocks.createTradeProcessId.mock.calls.length, 1);
  assert.equal(draftRouteMocks.executeSignal.mock.calls[0][0].defaultRR, 4);
  assert.equal(
    draftRouteMocks.executeSignal.mock.calls[0][0].messageId,
    "msg-1",
  );
  assert.equal(
    draftRouteMocks.executeSignal.mock.calls[0][5],
    "draftproc_generated",
  );
});

test("accept route handles rejected executions and unexpected execution failures", async () => {
  const rejectedDraft = createDraftDoc({
    id: "draft-rejected",
  });
  const failingDraft = createDraftDoc({
    id: "draft-failing",
  });

  draftRouteMocks.draftFindById
    .mockResolvedValueOnce(rejectedDraft)
    .mockResolvedValueOnce(failingDraft);
  draftRouteMocks.executeSignal
    .mockResolvedValueOnce({ type: "noop" })
    .mockRejectedValueOnce(new Error("exchange offline"));
  draftRouteMocks.resolveDraftWithExecution.mockResolvedValueOnce({
    status: "rejected",
    result: "rejected",
    error: "Risk policy blocked this trade",
  });

  const app = createApp();

  const rejected = await request(app)
    .post("/draft-rejected/accept")
    .send({});
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Risk policy blocked this trade");

  const failed = await request(app).post("/draft-failing/accept").send({});
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error, "exchange offline");
  assert.equal(failed.body.processId, "proc-1");
  assert.equal(draftRouteMocks.logProcessStep.mock.calls.length >= 3, true);
  assert.equal(
    draftRouteMocks.logProcessStep.mock.calls.at(-1)?.[0]?.action,
    "manual_accept_failed",
  );
});

test("reject and redraft routes validate draft state and persist state transitions", async () => {
  const rejectDraft = createDraftDoc({
    id: "draft-reject",
  });
  const alreadyRejectedDraft = createDraftDoc({
    id: "draft-reject-closed",
    status: "rejected",
  });
  const pendingRedraft = createDraftDoc({
    id: "draft-pending-redraft",
  });
  const resolvedDraft = createDraftDoc({
    id: "draft-resolved",
    status: "accepted",
    resolvedAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  const recreatedDraft = createDraftDoc({
    id: "draft-new",
    processId: "draftproc_new",
  });

  draftRouteMocks.draftFindById
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(alreadyRejectedDraft)
    .mockResolvedValueOnce(rejectDraft)
    .mockResolvedValueOnce(pendingRedraft)
    .mockResolvedValueOnce(resolvedDraft);
  draftRouteMocks.draftCreate.mockResolvedValue(recreatedDraft);

  const app = createApp();

  const missing = await request(app).post("/missing/reject").send({});
  assert.equal(missing.status, 404);

  const alreadyRejected = await request(app)
    .post("/draft-reject-closed/reject")
    .send({});
  assert.equal(alreadyRejected.status, 400);

  const rejected = await request(app).post("/draft-reject/reject").send({});
  assert.equal(rejected.status, 200);
  assert.equal(rejectDraft.status, "rejected");
  assert.equal(rejectDraft.save.mock.calls.length, 1);

  const pendingBlocked = await request(app)
    .post("/draft-pending-redraft/redraft")
    .send({});
  assert.equal(pendingBlocked.status, 400);
  assert.match(pendingBlocked.body.error, /already pending/);

  const recreated = await request(app)
    .post("/draft-resolved/redraft")
    .send({});
  assert.equal(recreated.status, 200);
  assert.match(recreated.body.data.message, /pending review/);
  assert.equal(
    draftRouteMocks.draftCreate.mock.calls[0][0].processId,
    "draftproc_generated",
  );
});

test("reanalyze route handles missing drafts and AI error classifications", async () => {
  const emptyDraft = createDraftDoc({ id: "draft-empty" });
  const parseDraft = createDraftDoc({ id: "draft-parse" });
  const holdDraft = createDraftDoc({ id: "draft-hold" });
  const cancelDraft = createDraftDoc({ id: "draft-cancel" });

  draftRouteMocks.draftFindById
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(emptyDraft)
    .mockResolvedValueOnce(parseDraft)
    .mockResolvedValueOnce(holdDraft)
    .mockResolvedValueOnce(cancelDraft);
  draftRouteMocks.analyzeMessagesWithAI
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ parseError: "model parse failed" }])
    .mockResolvedValueOnce([{ signal: { action: "HOLD" } }])
    .mockResolvedValueOnce([{ signal: { action: "CANCEL" } }]);

  const app = createApp();

  const missing = await request(app).post("/missing/reanalyze").send({});
  assert.equal(missing.status, 404);

  const empty = await request(app).post("/draft-empty/reanalyze").send({});
  assert.equal(empty.status, 500);
  assert.match(empty.body.error, /did not return any analysis result/);

  const parseError = await request(app).post("/draft-parse/reanalyze").send({});
  assert.equal(parseError.status, 500);
  assert.equal(parseError.body.error, "model parse failed");

  const hold = await request(app).post("/draft-hold/reanalyze").send({});
  assert.equal(hold.status, 400);
  assert.match(
    hold.body.error,
    /no longer classifies this Discord message as an actionable trading signal/,
  );

  const cancel = await request(app).post("/draft-cancel/reanalyze").send({});
  assert.equal(cancel.status, 400);
  assert.match(cancel.body.error, /cancel\/close instruction/);
});

test("reanalyze route refreshes pending drafts and creates new drafts for resolved ones", async () => {
  const pendingDraft = createDraftDoc({
    id: "draft-pending",
    processId: "",
    status: "pending",
  });
  const resolvedDraft = createDraftDoc({
    id: "draft-resolved-reanalyze",
    status: "accepted",
    processId: "proc-old",
  });
  const refreshedDraft = createDraftDoc({
    id: "draft-refreshed",
    processId: "draftproc_generated",
  });
  const createdDraft = createDraftDoc({
    id: "draft-created",
    processId: "draftproc_generated",
  });

  draftRouteMocks.draftFindById
    .mockResolvedValueOnce(pendingDraft)
    .mockResolvedValueOnce(resolvedDraft);
  draftRouteMocks.analyzeMessagesWithAI
    .mockResolvedValueOnce([
      {
        signal: {
          action: "BUY",
          symbol: "BTCUSDT",
          takeProfitTargets: [64500],
        },
      },
    ])
    .mockResolvedValueOnce([
      {
        signal: {
          action: "SELL",
          symbol: "ETHUSDT",
        },
      },
    ]);
  draftRouteMocks.refreshDraftFromSignal.mockResolvedValue(refreshedDraft);
  draftRouteMocks.createDraft.mockResolvedValue(createdDraft);

  const app = createApp();

  const refreshed = await request(app)
    .post("/draft-pending/reanalyze")
    .send({});
  assert.equal(refreshed.status, 200);
  assert.equal(
    draftRouteMocks.refreshDraftFromSignal.mock.calls[0][0],
    pendingDraft,
  );
  assert.equal(pendingDraft.save.mock.calls.length, 1);
  assert.equal(draftRouteMocks.createTradeProcessId.mock.calls.length, 1);
  assert.equal(draftRouteMocks.processedMessageUpdateOne.mock.calls.length, 1);
  assert.equal(
    draftRouteMocks.processedMessageUpdateOne.mock.calls[0][0].messageId,
    "msg-1",
  );

  const recreated = await request(app)
    .post("/draft-resolved-reanalyze/reanalyze")
    .send({});
  assert.equal(recreated.status, 200);
  assert.equal(
    draftRouteMocks.createDraft.mock.calls[0][2],
    "acc-1",
  );
  assert.match(
    recreated.body.data.message,
    /New pending draft created from fresh AI analysis/,
  );
});
