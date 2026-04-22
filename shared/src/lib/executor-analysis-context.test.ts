import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const contextMocks = vi.hoisted(() => ({
  accountFindById: vi.fn(),
  positionFind: vi.fn(),
  draftFind: vi.fn(),
  getClientForAccount: vi.fn(),
  buildExchangeCredentials: vi.fn(),
  logExecutorWarn: vi.fn(),
  logProcessStep: vi.fn(),
}));

vi.mock("./database", () => ({
  Account: {
    findById: contextMocks.accountFindById,
  },
  Position: {
    find: contextMocks.positionFind,
  },
  DraftTrade: {
    find: contextMocks.draftFind,
  },
}));

vi.mock("./exchange/ExchangeFactory", () => ({
  ExchangeFactory: {
    getClientForAccount: contextMocks.getClientForAccount,
  },
  buildExchangeCredentials: contextMocks.buildExchangeCredentials,
}));

vi.mock("./process-log", () => ({
  logExecutorWarn: contextMocks.logExecutorWarn,
  logProcessStep: contextMocks.logProcessStep,
}));

import { buildMessageAnalysisContext } from "./executor-analysis-context";

function createLeanQuery(result: unknown) {
  const sort = vi.fn();
  const limit = vi.fn();
  const lean = vi.fn();
  const query = {
    sort,
    limit,
    lean,
  };

  sort.mockReturnValue(query);
  limit.mockReturnValue(query);
  lean.mockResolvedValue(result);

  return query;
}

function createExchangeMock() {
  return {
    getAccountInfo: vi.fn(),
    getOpenPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getAlgoOrders: vi.fn(),
    getTickerPrice: vi.fn(),
  };
}

beforeEach(() => {
  contextMocks.accountFindById.mockReset();
  contextMocks.positionFind.mockReset();
  contextMocks.draftFind.mockReset();
  contextMocks.getClientForAccount.mockReset();
  contextMocks.buildExchangeCredentials.mockReset();
  contextMocks.logExecutorWarn.mockReset();
  contextMocks.logProcessStep.mockReset();

  contextMocks.logProcessStep.mockResolvedValue(undefined);
  contextMocks.logExecutorWarn.mockResolvedValue(undefined);
  contextMocks.buildExchangeCredentials.mockReturnValue({ provider: "bybit" });
});

test("buildMessageAnalysisContext returns a fallback block when no source account is attached", async () => {
  const result = await buildMessageAnalysisContext({
    messageId: "msg-1",
    channelId: "chan-1",
    author: "Trader",
    content: "hello",
    messageUrl: "https://discord.com/channels/test/1",
    imageUrls: [],
  });

  assert.equal(
    result,
    "[LIVE ACCOUNT CONTEXT]\nNo source account is attached to this message.\n[END LIVE ACCOUNT CONTEXT]",
  );
  assert.equal(contextMocks.logProcessStep.mock.calls.length, 0);
});

test("buildMessageAnalysisContext builds a detailed live context block and logs progress", async () => {
  const exchange = createExchangeMock();
  exchange.getAccountInfo.mockResolvedValue({
    totalBalance: 1234.567,
    availableBalance: 1000.111,
    unrealizedPnl: 12.345,
    currency: "USDT",
  });
  exchange.getOpenPositions.mockResolvedValue([
    {
      symbol: "BTCUSDT",
      side: "LONG",
      entryPrice: 100,
      quantity: 2,
      leverage: 10,
      margin: 20,
      unrealizedPnl: 5.4321,
      liquidationPrice: 80,
      markPrice: 111.111,
    },
  ]);
  exchange.getOpenOrders.mockResolvedValue([
    {
      symbol: "ETHUSDT",
      side: "BUY",
      type: "limit",
      price: 2500,
      quantity: 1.25,
      filledQuantity: 0.5,
      status: "open",
    },
  ]);
  exchange.getAlgoOrders.mockResolvedValue([
    {
      symbol: "BTCUSDT",
      side: "SELL",
      type: "tp",
      triggerPrice: 120,
      executePrice: 119.5,
      quantity: 2,
      status: "live",
    },
    {
      symbol: "BTCUSDT",
      side: "SELL",
      type: "sl",
      triggerPrice: 95,
      executePrice: 94.5,
      quantity: 2,
      status: "live",
    },
  ]);
  exchange.getTickerPrice
    .mockResolvedValueOnce(112.222)
    .mockRejectedValueOnce(new Error("ticker unavailable"));
  contextMocks.getClientForAccount.mockReturnValue(exchange);
  contextMocks.accountFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      name: "VIP account",
      sourceType: "discord",
      tradingPlatform: "bybit",
      exchangeData: { apiKey: "k" },
    }),
  });
  contextMocks.positionFind.mockReturnValue(
    createLeanQuery([
      {
        symbol: "BTCUSDT",
        side: "LONG",
        status: "open",
        entryPrice: 100,
        currentPrice: 111.333,
        quantity: 2,
        leverage: 10,
        pnl: 12.345,
        stopLossPrice: 95,
        takeProfitTargets: [{ price: 120, quantity: 1, percentage: 50, status: "pending" }],
        orderId: "ord-1",
        openedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]),
  );
  contextMocks.draftFind.mockReturnValue(
    createLeanQuery([
      {
        symbol: "SOLUSDT",
        action: "BUY",
        side: "LONG",
        entryPrice: 150,
        stopLoss: 145,
        takeProfitTargets: [160, 170],
        leverage: 5,
        quantity: 10,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]),
  );

  const result = await buildMessageAnalysisContext({
    messageId: "msg-ctx",
    channelId: "chan-1",
    author: "Trader",
    content: "update tp",
    messageUrl: "https://discord.com/channels/test/1",
    imageUrls: [],
    sourceId: "acc-1",
    sourceName: "VIP account",
    processId: "proc-1",
  });

  assert.match(result, /\[LIVE ACCOUNT CONTEXT\]/);
  assert.match(result, /Account: VIP account/);
  assert.match(result, /Trading platform: bybit/);
  assert.match(result, /Balance: total=1234\.57 \| available=1000\.11 \| unrealizedPnl=12\.35 \| currency=USDT/);
  assert.match(result, /BTCUSDT LONG \| entry=100/);
  assert.match(result, /tpOrders=120/);
  assert.match(result, /slOrders=95/);
  assert.match(result, /trackedSL=95/);
  assert.match(result, /trackedTP=120\(pending\)/);
  assert.match(result, /ETHUSDT BUY limit/);
  assert.match(result, /SOLUSDT BUY\/LONG/);
  assert.equal(contextMocks.logProcessStep.mock.calls[0][0].action, "analysis_context_started");
  assert.equal(
    contextMocks.logProcessStep.mock.calls[1][0].action,
    "analysis_context_completed",
  );
  assert.equal(contextMocks.logExecutorWarn.mock.calls.length, 1);
  assert.match(
    contextMocks.logExecutorWarn.mock.calls[0][0],
    /Failed to fetch live price for ETHUSDT/,
  );
});

test("buildMessageAnalysisContext falls back cleanly when the account is missing", async () => {
  contextMocks.accountFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue(null),
  });

  const result = await buildMessageAnalysisContext({
    messageId: "msg-missing",
    channelId: "chan-1",
    author: "Trader",
    content: "hello",
    messageUrl: "https://discord.com/channels/test/1",
    imageUrls: [],
    sourceId: "acc-missing",
    processId: "proc-missing",
  });

  assert.match(result, /\[LIVE ACCOUNT CONTEXT\]/);
  assert.match(result, /Failed to load live account context: Account not found: acc-missing/);
  assert.equal(contextMocks.logProcessStep.mock.calls[0][0].action, "analysis_context_started");
  assert.equal(contextMocks.logProcessStep.mock.calls[1][0].action, "analysis_context_failed");
  assert.match(
    contextMocks.logExecutorWarn.mock.calls[0][0],
    /Failed to build live account analysis context for msg-missing/,
  );
});

test("buildMessageAnalysisContext reports invalid trading platform errors from credential building", async () => {
  contextMocks.accountFindById.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      name: "Broken account",
      sourceType: "discord",
      tradingPlatform: "unknown-platform",
      exchangeData: {},
    }),
  });
  contextMocks.positionFind.mockReturnValue(createLeanQuery([]));
  contextMocks.draftFind.mockReturnValue(createLeanQuery([]));
  contextMocks.buildExchangeCredentials.mockReturnValue(null);

  const result = await buildMessageAnalysisContext({
    messageId: "msg-bad-platform",
    channelId: "chan-1",
    author: "Trader",
    content: "hello",
    messageUrl: "https://discord.com/channels/test/1",
    imageUrls: [],
    sourceId: "acc-bad",
  });

  assert.match(
    result,
    /Account "Broken account" has invalid trading platform "unknown-platform"/,
  );
  assert.match(
    contextMocks.logExecutorWarn.mock.calls[0][0],
    /Failed to build live account analysis context for msg-bad-platform/,
  );
  assert.equal(contextMocks.getClientForAccount.mock.calls.length, 0);
});
