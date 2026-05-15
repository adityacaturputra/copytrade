import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const marketMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  getOpenPositions: vi.fn(),
  accountFind: vi.fn(),
  isPaperExchangeProvider: vi.fn(),
  validateExchangeCredentials: vi.fn(),
  normalizeExchangeProvider: vi.fn(),
  resolveExchangeContext: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/database/index", () => ({
  connectDB: marketMocks.connectDB,
  getOpenPositions: marketMocks.getOpenPositions,
  Account: {
    find: marketMocks.accountFind,
  },
}));

vi.mock("@copytrade/shared/lib/exchange/ExchangeFactory", () => ({
  isPaperExchangeProvider: marketMocks.isPaperExchangeProvider,
  validateExchangeCredentials: marketMocks.validateExchangeCredentials,
}));

vi.mock("./shared", () => ({
  normalizeExchangeProvider: marketMocks.normalizeExchangeProvider,
  resolveExchangeContext: marketMocks.resolveExchangeContext,
}));

import { accountMarketToolImplementations } from "./account-market-implementations";

function createExecQuery(result: unknown) {
  const sort = vi.fn();
  const lean = vi.fn();
  const exec = vi.fn();
  const query = { sort, lean, exec };
  sort.mockReturnValue(query);
  lean.mockReturnValue(query);
  exec.mockResolvedValue(result);
  return query;
}

beforeEach(() => {
  marketMocks.connectDB.mockReset();
  marketMocks.getOpenPositions.mockReset();
  marketMocks.accountFind.mockReset();
  marketMocks.isPaperExchangeProvider.mockReset();
  marketMocks.validateExchangeCredentials.mockReset();
  marketMocks.normalizeExchangeProvider.mockReset();
  marketMocks.resolveExchangeContext.mockReset();

  marketMocks.connectDB.mockResolvedValue(undefined);
  marketMocks.normalizeExchangeProvider.mockImplementation((value) =>
    typeof value === "string" ? value.toLowerCase() : null,
  );
  marketMocks.isPaperExchangeProvider.mockImplementation(
    (provider) => provider === "paper",
  );
  marketMocks.validateExchangeCredentials.mockReturnValue({ valid: true });
});

test("account market implementations summarize trading accounts and DB positions", async () => {
  marketMocks.accountFind.mockReturnValue(
    createExecQuery([
      {
        _id: "acc-1",
        name: "Paper",
        sourceType: "discord",
        channelIds: ["c1"],
        tradingPlatform: "paper",
        exchangeData: {},
      },
      {
        _id: "acc-2",
        name: "Bybit",
        sourceType: "telegram",
        channelIds: ["c2"],
        tradingPlatform: "bybit",
        exchangeData: { apiKey: "x" },
      },
      {
        _id: "acc-3",
        name: "Ignored",
        sourceType: "discord",
        channelIds: [],
        tradingPlatform: null,
      },
    ]),
  );
  marketMocks.getOpenPositions.mockResolvedValue([
    {
      _id: "pos-1",
      symbol: "BTCUSDT",
      side: "LONG",
      entryPrice: 100,
      currentPrice: 110,
      quantity: 1,
      leverage: 10,
      takeProfitTargets: [120],
      stopLossPrice: 95,
      pnl: 10,
      status: "open",
      openedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  const accounts = JSON.parse(
    await accountMarketToolImplementations.get_trading_accounts({}),
  );
  const positions = JSON.parse(
    await accountMarketToolImplementations.get_open_positions({}),
  );

  assert.deepEqual(accounts, [
    {
      accountId: "acc-1",
      name: "Paper",
      provider: "paper",
      sourceType: "discord",
      channelIds: ["c1"],
      hasCredentials: true,
    },
    {
      accountId: "acc-2",
      name: "Bybit",
      provider: "bybit",
      sourceType: "telegram",
      channelIds: ["c2"],
      hasCredentials: true,
    },
  ]);
  assert.equal(positions[0].symbol, "BTCUSDT");
});

test("account market implementations proxy exchange account, ticker, and exchange positions", async () => {
  const exchange = {
    getAccountInfo: vi.fn().mockResolvedValue({
      totalBalance: 1000,
      availableBalance: 800,
      unrealizedPnl: 12,
      currency: "USDT",
    }),
    getTickerPrice: vi.fn().mockResolvedValue(123.45),
    getOpenPositions: vi.fn().mockResolvedValue([
      {
        symbol: "ETHUSDT",
        side: "SHORT",
        entryPrice: 2500,
        quantity: 2,
        leverage: 5,
        margin: 100,
        unrealizedPnl: 20,
        liquidationPrice: 3000,
        markPrice: 2400,
      },
    ]),
  };
  marketMocks.resolveExchangeContext.mockResolvedValue({
    exchange,
    provider: "okx",
    accountId: "acc-9",
    accountName: "OKX main",
  });

  const info = JSON.parse(
    await accountMarketToolImplementations.get_account_info({ accountId: "acc-9" }),
  );
  const ticker = JSON.parse(
    await accountMarketToolImplementations.get_ticker_price({
      accountId: "acc-9",
      symbol: "BTCUSDT",
    }),
  );
  const positions = JSON.parse(
    await accountMarketToolImplementations.get_exchange_positions({
      accountId: "acc-9",
    }),
  );

  assert.equal(info.provider, "okx");
  assert.equal(info.accountName, "OKX main");
  assert.deepEqual(ticker, { symbol: "BTCUSDT", price: 123.45 });
  assert.equal(positions[0].symbol, "ETHUSDT");
  assert.equal(exchange.getOpenPositions.mock.calls.length, 1);
});
