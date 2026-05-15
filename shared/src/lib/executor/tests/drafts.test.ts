import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const draftExecutorMocks = vi.hoisted(() => ({
  draftTradeCreate: vi.fn(),
  autoCalculateSLFromRR: vi.fn(),
  autoCalculateTPFromRR: vi.fn(),
  sanitizeLeverage: vi.fn(),
  logExecutorInfo: vi.fn(),
  logProcessStep: vi.fn(),
  resolveEffectiveRiskConfig: vi.fn(),
}));

vi.mock("../database/index", () => ({
  DraftTrade: {
    create: draftExecutorMocks.draftTradeCreate,
  },
}));

vi.mock("./executor/utils/signal", () => ({
  autoCalculateSLFromRR: draftExecutorMocks.autoCalculateSLFromRR,
  autoCalculateTPFromRR: draftExecutorMocks.autoCalculateTPFromRR,
  sanitizeLeverage: draftExecutorMocks.sanitizeLeverage,
}));

vi.mock("../process/log", () => ({
  logExecutorInfo: draftExecutorMocks.logExecutorInfo,
  logProcessStep: draftExecutorMocks.logProcessStep,
}));

vi.mock("../risk/index", () => ({
  resolveEffectiveRiskConfig: draftExecutorMocks.resolveEffectiveRiskConfig,
}));

import {
  createDraft,
  refreshDraftFromSignal,
  rejectDraftWithReason,
  resolveDraftWithExecution,
  summarizeExecutionForDraft,
} from "./executor/drafts";

function createDraftDoc(overrides: Record<string, unknown> = {}) {
  const id = String(overrides.id || "draft-1");
  const draft: Record<string, unknown> & { save: ReturnType<typeof vi.fn> } = {
    _id: { toString: () => id },
    accountId: "acc-1",
    processId: "proc-1",
    messageId: "msg-1",
    status: "pending",
    positionId: undefined,
    resolvedAt: undefined,
    save: vi.fn(),
  };

  Object.assign(draft, overrides);
  draft.save.mockResolvedValue(draft);
  return draft;
}

function createMessage(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "msg-1",
    channelId: "chan-1",
    messageUrl: "https://discord.com/channels/test/1",
    author: "Trader",
    content: "Buy BTCUSDT",
    originalContent: "Buy BTCUSDT at market",
    imageUrls: ["https://cdn.example.com/chart.png"],
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    processId: "proc-1",
    ...overrides,
  };
}

beforeEach(() => {
  draftExecutorMocks.draftTradeCreate.mockReset();
  draftExecutorMocks.autoCalculateSLFromRR.mockReset();
  draftExecutorMocks.autoCalculateTPFromRR.mockReset();
  draftExecutorMocks.sanitizeLeverage.mockReset();
  draftExecutorMocks.logExecutorInfo.mockReset();
  draftExecutorMocks.logProcessStep.mockReset();
  draftExecutorMocks.resolveEffectiveRiskConfig.mockReset();

  draftExecutorMocks.logExecutorInfo.mockResolvedValue(undefined);
  draftExecutorMocks.logProcessStep.mockResolvedValue(undefined);
  draftExecutorMocks.resolveEffectiveRiskConfig.mockResolvedValue({
    defaultPositionSize: 0.25,
    defaultRR: 2,
    defaultLeverage: 7,
  });
  draftExecutorMocks.sanitizeLeverage.mockImplementation((value: number) => value);
});

test("summarizeExecutionForDraft maps every execution result type", () => {
  assert.deepEqual(
    summarizeExecutionForDraft({
      type: "opened",
      position: { _id: { toString: () => "pos-1" } },
    } as never),
    {
      status: "accepted",
      result: "executed",
      positionId: "pos-1",
    },
  );

  assert.deepEqual(
    summarizeExecutionForDraft({
      type: "updated",
      details: "TP moved",
    } as never),
    {
      status: "accepted",
      result: "updated",
      message: "TP moved",
    },
  );

  assert.deepEqual(
    summarizeExecutionForDraft({
      type: "closed",
      closedCount: 2,
    } as never),
    {
      status: "accepted",
      result: "updated",
      message: "Closed 2 position(s)",
    },
  );

  assert.deepEqual(
    summarizeExecutionForDraft({
      type: "noop",
      details: "Nothing to do",
    } as never),
    {
      status: "accepted",
      result: "noop",
      message: "Nothing to do",
    },
  );

  assert.deepEqual(
    summarizeExecutionForDraft({
      type: "rejected",
      reason: "Risk blocked",
    } as never),
    {
      status: "rejected",
      result: "rejected",
      message: "Risk blocked",
      error: "Risk blocked",
    },
  );
});

test("resolveDraftWithExecution and rejectDraftWithReason persist status updates", async () => {
  const resolvedDraft = createDraftDoc();
  const rejectedDraft = createDraftDoc({ id: "draft-2" });

  const resolved = await resolveDraftWithExecution(
    resolvedDraft as never,
    {
      type: "opened",
      position: { _id: { toString: () => "pos-77" } },
    } as never,
  );
  const rejected = await rejectDraftWithReason(
    rejectedDraft as never,
    "Signal was invalid",
  );

  assert.equal(resolved.status, "accepted");
  assert.equal(resolvedDraft.status, "accepted");
  assert.equal(resolvedDraft.positionId, "pos-77");
  assert.ok(resolvedDraft.resolvedAt instanceof Date);
  assert.equal(resolvedDraft.save.mock.calls.length, 1);

  assert.equal(rejected.status, "rejected");
  assert.equal(rejectedDraft.status, "rejected");
  assert.ok(rejectedDraft.resolvedAt instanceof Date);
  assert.equal(rejectedDraft.save.mock.calls.length, 1);
});

test("createDraft auto-calculates stop loss from RR, uses risk defaults, and logs process steps", async () => {
  const draft = createDraftDoc();
  const message = createMessage();
  draftExecutorMocks.autoCalculateSLFromRR.mockReturnValue(61000);
  draftExecutorMocks.draftTradeCreate.mockResolvedValue(draft);

  const created = await createDraft(
    {
      action: "BUY",
      symbol: "BTCUSDT",
      entryPrice: 62000,
      takeProfitTargets: [64000],
      leverage: 10,
      confidence: 0.8,
      reasoning: "breakout",
    } as never,
    message as never,
    "acc-1",
  );

  assert.equal(created, draft);
  assert.equal(draftExecutorMocks.autoCalculateSLFromRR.mock.calls.length, 1);
  assert.deepEqual(draftExecutorMocks.draftTradeCreate.mock.calls[0][0], {
    accountId: "acc-1",
    processId: "proc-1",
    messageId: "msg-1",
    channelId: "chan-1",
    messageUrl: "https://discord.com/channels/test/1",
    author: "Trader",
    originalContent: "Buy BTCUSDT at market",
    imageUrls: ["https://cdn.example.com/chart.png"],
    signalData: JSON.stringify({
      action: "BUY",
      symbol: "BTCUSDT",
      entryPrice: 62000,
      takeProfitTargets: [64000],
      leverage: 10,
      confidence: 0.8,
      reasoning: "breakout",
    }),
    action: "BUY",
    symbol: "BTCUSDT",
    side: "LONG",
    entryPrice: 62000,
    takeProfitTargets: [64000],
    stopLoss: 61000,
    leverage: 10,
    quantity: 0.25,
    confidence: 0.8,
    reasoning: "breakout",
    sourceTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    status: "pending",
  });
  assert.equal(draftExecutorMocks.logExecutorInfo.mock.calls.length, 2);
  assert.equal(draftExecutorMocks.logProcessStep.mock.calls[0][0].action, "draft_created");
});

test("createDraft auto-calculates TP targets and falls back to default leverage when sanitization empties the input", async () => {
  const draft = createDraftDoc({ id: "draft-2" });
  draftExecutorMocks.autoCalculateTPFromRR.mockReturnValue([2600, 2700]);
  draftExecutorMocks.sanitizeLeverage.mockReturnValue(undefined);
  draftExecutorMocks.draftTradeCreate.mockResolvedValue(draft);

  await createDraft(
    {
      action: "SELL",
      symbol: "ETHUSDT",
      entryPrice: 2500,
      stopLoss: 2550,
      positionSize: 2,
      leverage: 99,
    } as never,
    createMessage({
      processId: null,
      originalContent: "",
      content: "Sell ETHUSDT",
    }) as never,
  );

  assert.equal(draftExecutorMocks.autoCalculateTPFromRR.mock.calls.length, 1);
  assert.equal(draftExecutorMocks.draftTradeCreate.mock.calls[0][0].side, "SHORT");
  assert.deepEqual(
    draftExecutorMocks.draftTradeCreate.mock.calls[0][0].takeProfitTargets,
    [2600, 2700],
  );
  assert.equal(draftExecutorMocks.draftTradeCreate.mock.calls[0][0].leverage, 7);
  assert.equal(draftExecutorMocks.draftTradeCreate.mock.calls[0][0].quantity, 2);
  assert.equal(draftExecutorMocks.logProcessStep.mock.calls.length, 0);
});

test("createDraft uses a safe placeholder when both originalContent and content are empty", async () => {
  const draft = createDraftDoc({ id: "draft-empty-content" });
  draftExecutorMocks.autoCalculateTPFromRR.mockReturnValue([160, 170]);
  draftExecutorMocks.draftTradeCreate.mockResolvedValue(draft);

  await createDraft(
    {
      action: "BUY",
      symbol: "SOLUSDT",
      entryPrice: 150,
      stopLoss: 140,
    } as never,
    createMessage({
      content: "   ",
      originalContent: "",
      imageUrls: [
        "https://cdn.example.com/chart-1.png",
        "https://cdn.example.com/chart-2.png",
      ],
      messageUrl: "https://discord.com/channels/test/empty",
    }) as never,
    "acc-1",
  );

  assert.equal(
    draftExecutorMocks.draftTradeCreate.mock.calls[0][0].originalContent,
    "[source message had no text content with 2 attachments] https://discord.com/channels/test/empty",
  );
});

test("refreshDraftFromSignal rebuilds draft payload and skips process logging when no process id exists", async () => {
  const draft = createDraftDoc({
    accountId: "acc-9",
    processId: null,
    messageId: "msg-old",
  });
  draftExecutorMocks.autoCalculateTPFromRR.mockReturnValue([111, 122]);

  const refreshed = await refreshDraftFromSignal(
    draft as never,
    {
      action: "BUY",
      symbol: "SOLUSDT",
      entryPrice: 100,
      stopLoss: 95,
      confidence: 0.55,
    } as never,
    createMessage({
      processId: null,
      messageId: "msg-new",
      content: "Buy SOLUSDT",
      originalContent: "Buy SOLUSDT and hold",
    }) as never,
  );

  assert.equal(refreshed, draft);
  assert.equal(draft.symbol, "SOLUSDT");
  assert.deepEqual(draft.takeProfitTargets, [111, 122]);
  assert.equal(draft.messageId, "msg-new");
  assert.equal(draft.save.mock.calls.length, 1);
  assert.equal(draftExecutorMocks.logProcessStep.mock.calls.length, 0);
});
