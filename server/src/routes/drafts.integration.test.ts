import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// @ts-ignore -- test helper outside server/src rootDir
import {
  startTestMongo,
  clearTestMongo,
  stopTestMongo,
} from "../../../tests/helpers/mongo";

const { executeSignalMock, logProcessStepMock } = vi.hoisted(() => ({
  executeSignalMock: vi.fn(),
  logProcessStepMock: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/executor", async () => {
  const actual = await vi.importActual<
    typeof import("@copytrade/shared/lib/executor")
  >("@copytrade/shared/lib/executor");

  return {
    ...actual,
    executeSignal: executeSignalMock,
  };
});

vi.mock("@copytrade/shared/lib/process-log", async () => {
  const actual = await vi.importActual<
    typeof import("@copytrade/shared/lib/process-log")
  >("@copytrade/shared/lib/process-log");

  return {
    ...actual,
    logProcessStep: logProcessStepMock,
  };
});

import { createApp } from "../app";
import { DraftTrade } from "@copytrade/shared/lib/database";

describe("drafts routes integration", () => {
  const app = createApp();

  beforeAll(async () => {
    await startTestMongo();
  });

  afterAll(async () => {
    await stopTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
    executeSignalMock.mockReset();
    logProcessStepMock.mockReset();
    logProcessStepMock.mockResolvedValue(undefined);
  });

  it("lists drafts from MongoDB with pagination metadata", async () => {
    await DraftTrade.create([
      {
        messageId: "msg-1",
        channelId: "chan-1",
        messageUrl: "https://discord.com/channels/test/1",
        author: "Trader A",
        originalContent: "Buy BTCUSDT market",
        imageUrls: [],
        signalData: JSON.stringify({ action: "BUY", symbol: "BTCUSDT" }),
        action: "BUY",
        symbol: "BTCUSDT",
        side: "LONG",
        entryPrice: 62000,
        takeProfitTargets: [64000],
        stopLoss: 61000,
        leverage: 10,
        quantity: 1,
        confidence: 0.95,
        reasoning: "clean breakout",
        status: "pending",
      },
      {
        messageId: "msg-2",
        channelId: "chan-2",
        messageUrl: "https://discord.com/channels/test/2",
        author: "Trader B",
        originalContent: "Sell ETHUSDT limit",
        imageUrls: [],
        signalData: JSON.stringify({ action: "SELL", symbol: "ETHUSDT" }),
        action: "SELL",
        symbol: "ETHUSDT",
        side: "SHORT",
        entryPrice: 3100,
        takeProfitTargets: [3000],
        stopLoss: 3200,
        leverage: 8,
        quantity: 2,
        confidence: 0.8,
        reasoning: "retest short",
        status: "pending",
      },
    ]);

    const response = await request(app).get("/api/drafts?page=1&limit=1");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.page).toBe(1);
    expect(response.body.data.limit).toBe(1);
    expect(response.body.data.totalCount).toBe(2);
    expect(response.body.data.totalPages).toBe(2);
    expect(response.body.data.drafts).toHaveLength(1);
  });

  it("accepts a pending draft and persists the accepted state", async () => {
    executeSignalMock.mockResolvedValue({
      type: "updated",
      code: "updated_tp_sl",
      details: "TP: 64000 → 64500",
    });

    const draft = await DraftTrade.create({
      messageId: "msg-accept",
      channelId: "chan-1",
      messageUrl: "https://discord.com/channels/test/accept",
      author: "Trader A",
      originalContent: "Update TP BTCUSDT to 64500",
      imageUrls: [],
      signalData: JSON.stringify({
        action: "BUY",
        symbol: "BTCUSDT",
        takeProfitTargets: [64500],
      }),
      action: "BUY",
      symbol: "BTCUSDT",
      side: "LONG",
      entryPrice: 62000,
      takeProfitTargets: [64500],
      stopLoss: 61000,
      leverage: 10,
      quantity: 1,
      confidence: 0.92,
      reasoning: "update target",
      status: "pending",
    });

    const response = await request(app)
      .post(`/api/drafts/${draft._id.toString()}/accept`)
      .set("x-action-password", process.env.ACTION_PASSWORD || "")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.message).toBe("TP: 64000 → 64500");

    const saved = await DraftTrade.findById(draft._id).lean();
    expect(saved?.status).toBe("accepted");
    expect(saved?.resolvedAt).toBeTruthy();
    expect(executeSignalMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a pending draft and persists the rejected state", async () => {
    const draft = await DraftTrade.create({
      messageId: "msg-reject",
      channelId: "chan-1",
      messageUrl: "https://discord.com/channels/test/reject",
      author: "Trader A",
      originalContent: "Skip this trade",
      imageUrls: [],
      signalData: JSON.stringify({ action: "BUY", symbol: "BTCUSDT" }),
      action: "BUY",
      symbol: "BTCUSDT",
      side: "LONG",
      entryPrice: 62000,
      takeProfitTargets: [64000],
      stopLoss: 61000,
      leverage: 10,
      quantity: 1,
      confidence: 0.4,
      reasoning: "too late",
      status: "pending",
    });

    const response = await request(app)
      .post(`/api/drafts/${draft._id.toString()}/reject`)
      .set("x-action-password", process.env.ACTION_PASSWORD || "")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const saved = await DraftTrade.findById(draft._id).lean();
    expect(saved?.status).toBe("rejected");
    expect(saved?.resolvedAt).toBeTruthy();
  });
});
