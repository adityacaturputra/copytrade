import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const monitorContextMocks = vi.hoisted(() => ({
  accountFindById: vi.fn(),
  positionFind: vi.fn(),
  getClientForAccount: vi.fn(),
  getPaperClient: vi.fn(),
  buildExchangeCredentials: vi.fn(),
  logProcessStep: vi.fn(),
  fetchMessageContext: vi.fn(),
}));

vi.mock("../database", () => ({
  Account: {
    findById: monitorContextMocks.accountFindById,
  },
  Position: {
    find: monitorContextMocks.positionFind,
  },
}));

vi.mock("../exchange/ExchangeFactory", () => ({
  ExchangeFactory: {
    getClientForAccount: monitorContextMocks.getClientForAccount,
    getPaperClient: monitorContextMocks.getPaperClient,
  },
  buildExchangeCredentials: monitorContextMocks.buildExchangeCredentials,
}));

vi.mock("../process-log", () => ({
  logProcessStep: monitorContextMocks.logProcessStep,
}));

vi.mock("../source/DiscordSourceProvider", () => ({
  DiscordSourceProvider: class {
    fetchMessageContext = monitorContextMocks.fetchMessageContext;
  },
}));

import { buildPositionAnalysisInput } from "./context";

function createLeanQuery(result: unknown) {
  const sort = vi.fn();
  const lean = vi.fn();
  const query = { sort, lean };
  sort.mockReturnValue(query);
  lean.mockResolvedValue(result);
  return query;
}

beforeEach(() => {
  monitorContextMocks.accountFindById.mockReset();
  monitorContextMocks.positionFind.mockReset();
  monitorContextMocks.getClientForAccount.mockReset();
  monitorContextMocks.getPaperClient.mockReset();
  monitorContextMocks.buildExchangeCredentials.mockReset();
  monitorContextMocks.logProcessStep.mockReset();
  monitorContextMocks.fetchMessageContext.mockReset();

  monitorContextMocks.logProcessStep.mockResolvedValue(undefined);
  monitorContextMocks.buildExchangeCredentials.mockReturnValue({ provider: "bybit" });
});

test("buildPositionAnalysisInput enriches account positions with live prices and fetches Discord context", async () => {
  const exchange = {
    getTickerPrice: vi.fn()
      .mockResolvedValueOnce(111)
      .mockRejectedValueOnce(new Error("ticker unavailable")),
  };
  monitorContextMocks.getClientForAccount.mockReturnValue(exchange);
  monitorContextMocks.accountFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      _id: { toString: () => "acc-1" },
      name: "VIP account",
      sourceType: "discord",
      tradingPlatform: "bybit",
      exchangeData: { apiKey: "x" },
      sourceData: {
        method: "bot",
        token: "token",
      },
    }),
  });
  monitorContextMocks.positionFind.mockReturnValue(
    createLeanQuery([
      {
        _id: { toString: () => "pos-1" },
        accountId: "acc-1",
        symbol: "BTCUSDT",
        side: "LONG",
        status: "open",
        entryPrice: 100,
        quantity: 1,
        leverage: 10,
        stopLossPrice: 95,
        takeProfitTargets: [{ price: 120, status: "pending", percentage: 100 }],
      },
      {
        _id: { toString: () => "pos-2" },
        accountId: "acc-1",
        symbol: "ETHUSDT",
        side: "SHORT",
        status: "open",
        entryPrice: 200,
        quantity: 1,
        leverage: 5,
        stopLossPrice: 210,
        takeProfitTargets: [{ price: 180, status: "pending", percentage: 100 }],
      },
    ]),
  );
  monitorContextMocks.fetchMessageContext.mockResolvedValue([
    {
      messageId: "msg-1",
      author: "Trader",
      content: "buy",
      originalContent: "buy now",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      messageUrl: "https://discord.com/channels/test/1",
      imageUrls: ["https://cdn.example.com/chart.png"],
    },
  ]);

  const result = await buildPositionAnalysisInput(
    {
      accountId: "acc-1",
      symbol: "BTCUSDT",
      side: "LONG",
      status: "open",
      entryPrice: 100,
      quantity: 1,
      leverage: 10,
      stopLossPrice: 95,
      takeProfitTargets: [{ price: 120 }],
      messageId: "msg-1",
      channelId: "chan-1",
      messageUrl: "https://discord.com/channels/test/1",
    },
    111,
    10,
    "proc-1",
  );

  assert.equal(result.accountName, "VIP account");
  assert.equal(result.tradingPlatform, "bybit");
  assert.equal(result.accountOpenPositions?.[0]?.currentPrice, 111);
  assert.equal(result.accountOpenPositions?.[0]?.pnl, 110);
  assert.equal(result.accountOpenPositions?.[1]?.currentPrice, undefined);
  assert.equal(result.discordContextMessages?.[0]?.content, "buy now");
  assert.equal(monitorContextMocks.logProcessStep.mock.calls.length >= 4, true);
  assert.equal(
    monitorContextMocks.logProcessStep.mock.calls.some(
      (call) => call[0].action === "account_position_live_price_failed",
    ),
    true,
  );
  assert.equal(
    monitorContextMocks.logProcessStep.mock.calls.some(
      (call) => call[0].action === "discord_context_fetched",
    ),
    true,
  );
});

test("buildPositionAnalysisInput skips Discord context when source metadata is incomplete", async () => {
  const exchange = {
    getTickerPrice: vi.fn().mockResolvedValue(123),
  };
  monitorContextMocks.getPaperClient.mockReturnValue(exchange);
  monitorContextMocks.accountFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      _id: { toString: () => "acc-2" },
      name: "Paper account",
      sourceType: "telegram",
      tradingPlatform: "paper",
      exchangeData: null,
      sourceData: {},
    }),
  });
  monitorContextMocks.positionFind.mockReturnValue(createLeanQuery([]));

  const result = await buildPositionAnalysisInput(
    {
      accountId: "acc-2",
      symbol: "SOLUSDT",
      side: "LONG",
      status: "open",
      entryPrice: 100,
      quantity: 1,
      leverage: 2,
      channelId: "chan-1",
      messageId: "msg-1",
    },
    123,
    46,
    "proc-2",
  );

  assert.deepEqual(result.accountOpenPositions, []);
  assert.deepEqual(result.discordContextMessages, []);
  assert.equal(monitorContextMocks.getPaperClient.mock.calls.length, 1);
  assert.equal(
    monitorContextMocks.logProcessStep.mock.calls.some(
      (call) => call[0].action === "discord_context_skipped",
    ),
    true,
  );
});

test("buildPositionAnalysisInput skips Discord context immediately when anchor metadata is missing", async () => {
  monitorContextMocks.accountFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue(null),
  });
  monitorContextMocks.positionFind.mockReturnValue(createLeanQuery([]));
  monitorContextMocks.getPaperClient.mockReturnValue({
    getTickerPrice: vi.fn(),
  });

  const result = await buildPositionAnalysisInput(
    {
      accountId: "acc-3",
      symbol: "XRPUSDT",
      side: "SHORT",
      status: "open",
      entryPrice: 1,
      quantity: 100,
      leverage: 3,
    },
    0.9,
    30,
    "proc-3",
  );

  assert.deepEqual(result.discordContextMessages, []);
  assert.equal(
    monitorContextMocks.logProcessStep.mock.calls.some(
      (call) => call[0].action === "discord_context_skipped",
    ),
    true,
  );
  assert.equal(monitorContextMocks.fetchMessageContext.mock.calls.length, 0);
});
