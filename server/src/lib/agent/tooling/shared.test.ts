import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  accountFind: vi.fn(),
  accountFindById: vi.fn(),
  positionFind: vi.fn(),
  positionFindById: vi.fn(),
  getClientForAccount: vi.fn(),
  buildExchangeCredentials: vi.fn(),
  exchangeSupportsDirectAlgoCancel: vi.fn(),
  normalizeSharedExchangeProvider: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/database", () => ({
  connectDB: sharedMocks.connectDB,
  Account: {
    find: sharedMocks.accountFind,
    findById: sharedMocks.accountFindById,
  },
  Position: {
    find: sharedMocks.positionFind,
    findById: sharedMocks.positionFindById,
  },
}));

vi.mock("@copytrade/shared/lib/exchange/ExchangeFactory", () => ({
  ExchangeFactory: {
    getClientForAccount: sharedMocks.getClientForAccount,
  },
  buildExchangeCredentials: sharedMocks.buildExchangeCredentials,
  exchangeSupportsDirectAlgoCancel: sharedMocks.exchangeSupportsDirectAlgoCancel,
  normalizeExchangeProvider: sharedMocks.normalizeSharedExchangeProvider,
}));

vi.mock("@copytrade/shared/lib/source/SourceFactory", () => ({
  SourceFactory: {
    getProvider: sharedMocks.getProvider,
  },
}));

import {
  buildSourceSummary,
  calculatePositionPnlPercent,
  cancelAlgoOrdersByTypes,
  findPositionRecord,
  getAccountIdFromArgs,
  getBackendBaseUrl,
  getErrorMessage,
  getFrontendBaseUrl,
  getLivePositionSnapshot,
  getSourceConfigForAccount,
  getSourceContextForAccount,
  loadSourceAccounts,
  normalizePositiveNumber,
  normalizeSortOrder,
  normalizeSourceType,
  parseOptionalString,
  resolveExchangeContext,
  roundPrice,
  serializeSourceMessages,
  toClosingSide,
  toExchangeCredentials,
} from "./shared";

function createExecQuery(result: unknown) {
  const sort = vi.fn();
  const limit = vi.fn();
  const lean = vi.fn();
  const exec = vi.fn();
  const query = {
    sort,
    limit,
    lean,
    exec,
  };
  sort.mockReturnValue(query);
  limit.mockReturnValue(query);
  lean.mockReturnValue(query);
  exec.mockResolvedValue(result);
  return query;
}

beforeEach(() => {
  delete process.env.FRONTEND_URL;
  delete process.env.BACKEND_URL;
  delete process.env.PORT;

  sharedMocks.connectDB.mockReset();
  sharedMocks.accountFind.mockReset();
  sharedMocks.accountFindById.mockReset();
  sharedMocks.positionFind.mockReset();
  sharedMocks.positionFindById.mockReset();
  sharedMocks.getClientForAccount.mockReset();
  sharedMocks.buildExchangeCredentials.mockReset();
  sharedMocks.exchangeSupportsDirectAlgoCancel.mockReset();
  sharedMocks.normalizeSharedExchangeProvider.mockReset();
  sharedMocks.getProvider.mockReset();

  sharedMocks.connectDB.mockResolvedValue(undefined);
  sharedMocks.normalizeSharedExchangeProvider.mockImplementation((value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  });
  sharedMocks.buildExchangeCredentials.mockImplementation((provider) =>
    provider ? { provider: String(provider).toLowerCase() } : null,
  );
  sharedMocks.exchangeSupportsDirectAlgoCancel.mockReturnValue(false);
});

test("shared helpers normalize primitive values and URLs", () => {
  process.env.FRONTEND_URL = "http://localhost:3000///";
  process.env.BACKEND_URL = "http://localhost:5000//";

  assert.equal(roundPrice(123.456), 123.46);
  assert.equal(getFrontendBaseUrl(), "http://localhost:3000");
  assert.equal(getBackendBaseUrl(), "http://localhost:5000");
  assert.equal(getErrorMessage({ error: "boom" }), "boom");
  assert.equal(getErrorMessage({ error: 1 }), undefined);
  assert.equal(getAccountIdFromArgs({ accountId: "  acc-1 " }), "acc-1");
  assert.equal(getAccountIdFromArgs({ accountId: 10 }), undefined);
  assert.equal(normalizeSourceType(" discord "), "discord");
  assert.equal(normalizeSourceType("email"), null);
  assert.equal(normalizePositiveNumber(-1, 5), 5);
  assert.equal(normalizePositiveNumber(10, 5, 7), 7);
  assert.equal(normalizeSortOrder("asc"), "asc");
  assert.equal(normalizeSortOrder("anything"), "desc");
  assert.equal(toClosingSide("LONG"), "SELL");
  assert.equal(toClosingSide("SHORT"), "BUY");
  assert.equal(calculatePositionPnlPercent({ side: "LONG", entryPrice: 100, leverage: 10 } as never, 110), 100);
  assert.equal(calculatePositionPnlPercent({ side: "SHORT", entryPrice: 100, leverage: 5 } as never, 90), 50);
  assert.equal(parseOptionalString("  hi "), "hi");
  assert.equal(parseOptionalString("   "), undefined);
});

test("shared account/source helpers build summaries and validate configs", () => {
  sharedMocks.getProvider.mockReturnValue({ kind: "discord-provider" });

  const account = {
    _id: "acc-1",
    name: "VIP",
    isActive: true,
    sourceType: "discord",
    sourceData: { token: "abc" },
    channelIds: ["c1"],
    tradingPlatform: "bybit",
    exchangeData: { apiKey: "x" },
  };

  assert.deepEqual(toExchangeCredentials(account as never), { provider: "bybit" });
  assert.deepEqual(getSourceConfigForAccount(account as never), {
    _id: "acc-1",
    name: "VIP",
    type: "discord",
    channelIds: ["c1"],
    token: "abc",
  });
  assert.deepEqual(buildSourceSummary(account as never), {
    accountId: "acc-1",
    name: "VIP",
    sourceType: "discord",
    providerName: "discord",
    channelIds: ["c1"],
    isActive: true,
    hasCredentials: true,
    lastFetchedAt: null,
    lastError: null,
  });
  assert.deepEqual(getSourceContextForAccount(account as never), {
    provider: { kind: "discord-provider" },
    config: {
      _id: "acc-1",
      name: "VIP",
      type: "discord",
      channelIds: ["c1"],
      token: "abc",
    },
    accountId: "acc-1",
    accountName: "VIP",
    sourceType: "discord",
  });

  sharedMocks.buildExchangeCredentials.mockReturnValueOnce(null);
  assert.throws(
    () => toExchangeCredentials({ _id: "acc-2", name: "Bad", tradingPlatform: null } as never),
    /does not have a valid tradingPlatform/,
  );
  assert.throws(
    () => getSourceConfigForAccount({ _id: "acc-3", name: "Bad", sourceType: "email" } as never),
    /does not have a valid sourceType/,
  );
  assert.throws(
    () => getSourceContextForAccount({ _id: "acc-4", name: "Bad", sourceType: "email" } as never),
    /does not have a valid sourceType/,
  );
});

test("cancelAlgoOrdersByTypes falls back to exchange cancel for providers without direct algo cancellation", async () => {
  const exchange = {
    name: "paper",
    cancelAlgoOrders: vi.fn().mockResolvedValue({ cancelled: ["a1"], errors: [] }),
  };

  const result = await cancelAlgoOrdersByTypes(exchange as never, "BTCUSDT", ["tp"]);

  assert.deepEqual(result, { cancelled: ["a1"], errors: [] });
  assert.deepEqual(exchange.cancelAlgoOrders.mock.calls[0], ["BTCUSDT"]);
});

test("cancelAlgoOrdersByTypes filters selected algo orders and aggregates cancel errors", async () => {
  sharedMocks.exchangeSupportsDirectAlgoCancel.mockReturnValue(true);
  const exchange = {
    name: "binance",
    getAlgoOrders: vi.fn().mockResolvedValue([
      { orderId: "tp-1", symbol: "BTCUSDT", type: "tp" },
      { orderId: "sl-1", symbol: "BTCUSDT", type: "sl" },
      { orderId: "cond-1", symbol: "BTCUSDT", type: "conditional" },
    ]),
    cancelOrder: vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false),
  };

  const result = await cancelAlgoOrdersByTypes(exchange as never, "BTCUSDT", ["tp", "sl"]);

  assert.deepEqual(result, {
    cancelled: ["tp-1"],
    errors: ["sl-1: Unknown order"],
  });
  assert.deepEqual(exchange.cancelOrder.mock.calls, [
    ["tp-1", "BTCUSDT"],
    ["sl-1", "BTCUSDT"],
  ]);
});

test("loadSourceAccounts filters invalid source types and applies account filters", async () => {
  sharedMocks.accountFind.mockReturnValue(
    createExecQuery([
      { _id: "1", sourceType: "discord", name: "A", isActive: true },
      { _id: "2", sourceType: "email", name: "B", isActive: true },
    ]),
  );

  const accounts = await loadSourceAccounts(
    { accountId: " acc-1 ", sourceType: "telegram" },
    { fallbackSourceType: "discord" as never, activeOnly: true },
  );

  assert.equal(sharedMocks.connectDB.mock.calls.length, 1);
  assert.deepEqual(sharedMocks.accountFind.mock.calls[0][0], {
    _id: "acc-1",
    sourceType: "telegram",
    isActive: true,
  });
  assert.deepEqual(accounts, [
    { _id: "1", sourceType: "discord", name: "A", isActive: true },
  ]);
});

test("findPositionRecord resolves by id or symbol and guards ambiguous lookups", async () => {
  sharedMocks.positionFindById.mockReturnValueOnce(
    createExecQuery({ _id: { toString: () => "pos-1" }, symbol: "BTCUSDT" }),
  );
  const byId = await findPositionRecord({ positionId: "pos-1" });
  assert.equal(byId.symbol, "BTCUSDT");

  sharedMocks.positionFindById.mockReturnValueOnce(createExecQuery(null));
  await assert.rejects(() => findPositionRecord({ positionId: "missing" }), /Position not found: missing/);

  await assert.rejects(() => findPositionRecord({}), /Provide either positionId or symbol/);

  sharedMocks.positionFind.mockReturnValueOnce(createExecQuery([]));
  await assert.rejects(
    () => findPositionRecord({ symbol: "ETHUSDT", accountId: "acc-1" }),
    /Position not found for symbol ETHUSDT on account acc-1/,
  );

  sharedMocks.positionFind.mockReturnValueOnce(
    createExecQuery([{ _id: { toString: () => "p1" } }, { _id: { toString: () => "p2" } }]),
  );
  await assert.rejects(
    () => findPositionRecord({ symbol: "ETHUSDT" }),
    /Multiple positions found for symbol ETHUSDT/,
  );

  sharedMocks.positionFind.mockReturnValueOnce(
    createExecQuery([{ _id: { toString: () => "p3" }, symbol: "ETHUSDT" }]),
  );
  const bySymbol = await findPositionRecord({ symbol: "ETHUSDT", status: "open" });
  assert.equal(bySymbol._id.toString(), "p3");
});

test("resolveExchangeContext handles explicit accounts and default active-account resolution", async () => {
  const exchange = { name: "bybit" };
  sharedMocks.getClientForAccount.mockReturnValue(exchange);

  sharedMocks.accountFindById.mockReturnValueOnce(
    createExecQuery({ _id: "acc-1", name: "VIP", tradingPlatform: "bybit" }),
  );
  const explicit = await resolveExchangeContext({ accountId: "acc-1" });
  assert.deepEqual(explicit, {
    exchange,
    provider: "bybit",
    accountId: "acc-1",
    accountName: "VIP",
  });

  sharedMocks.accountFindById.mockReturnValueOnce(createExecQuery(null));
  await assert.rejects(
    () => resolveExchangeContext({ accountId: "missing" }),
    /Trading account not found: missing/,
  );

  sharedMocks.accountFind.mockReturnValueOnce(createExecQuery([]));
  await assert.rejects(
    () => resolveExchangeContext({}),
    /No active trading accounts found/,
  );

  sharedMocks.accountFind.mockReturnValueOnce(
    createExecQuery([
      { _id: "acc-1", name: "A", tradingPlatform: "bybit" },
      { _id: "acc-2", name: "B", tradingPlatform: "okx" },
    ]),
  );
  await assert.rejects(
    () => resolveExchangeContext({}),
    /Multiple trading accounts are active/,
  );

  sharedMocks.accountFind.mockReturnValueOnce(
    createExecQuery([
      { _id: "acc-3", name: "Solo", tradingPlatform: "binance" },
    ]),
  );
  const single = await resolveExchangeContext({});
  assert.equal(single.accountId, "acc-3");
  assert.equal(single.provider, "binance");
});

test("getLivePositionSnapshot prefers live exchange mark price and falls back to ticker price", async () => {
  const exchange = {
    getOpenPositions: vi.fn()
      .mockResolvedValueOnce([
        { symbol: "BTCUSDT", side: "LONG", markPrice: 111 },
      ])
      .mockResolvedValueOnce([{ symbol: "ETHUSDT", side: "LONG", markPrice: 50 }]),
    getTickerPrice: vi.fn().mockResolvedValue(222),
  };
  sharedMocks.getClientForAccount.mockReturnValue(exchange);
  sharedMocks.accountFindById.mockReturnValue(
    createExecQuery({ _id: "acc-1", name: "VIP", tradingPlatform: "bybit" }),
  );

  const matched = await getLivePositionSnapshot({
    accountId: "acc-1",
    symbol: "BTCUSDT",
    side: "LONG",
    entryPrice: 100,
    leverage: 10,
  } as never);
  assert.equal(matched.currentPrice, 111);
  assert.equal(matched.pnlPercent, 110);
  assert.equal(matched.exchangePosition?.symbol, "BTCUSDT");

  const fallback = await getLivePositionSnapshot({
    accountId: "acc-1",
    symbol: "SOLUSDT",
    side: "SHORT",
    entryPrice: 200,
    leverage: 5,
  } as never);
  assert.equal(fallback.currentPrice, 222);
  assert.equal(fallback.exchangePosition, null);
  assert.equal(fallback.pnlPercent, -55);
});

test("serializeSourceMessages keeps the expected source metadata fields", () => {
  const result = serializeSourceMessages([
    {
      messageId: "msg-1",
      channelId: "chan-1",
      author: "Trader",
      content: "buy",
      originalContent: "buy now",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      messageUrl: "https://discord.com/channels/test/1",
      imageUrls: ["https://cdn.example.com/1.png"],
      isReply: true,
      sourceId: "acc-1",
      sourceName: "VIP",
    },
  ] as never);

  assert.deepEqual(result, [
    {
      messageId: "msg-1",
      channelId: "chan-1",
      author: "Trader",
      content: "buy",
      originalContent: "buy now",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      messageUrl: "https://discord.com/channels/test/1",
      imageUrls: ["https://cdn.example.com/1.png"],
      isReply: true,
      sourceId: "acc-1",
      sourceName: "VIP",
    },
  ]);
});
