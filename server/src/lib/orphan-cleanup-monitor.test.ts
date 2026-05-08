import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const orphanCleanupMocks = vi.hoisted(() => ({
  accountFind: vi.fn(),
  positionFind: vi.fn(),
  getClientForAccount: vi.fn(),
  toExchangeCredentials: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/database", () => ({
  Account: {
    find: orphanCleanupMocks.accountFind,
  },
  Position: {
    find: orphanCleanupMocks.positionFind,
  },
}));

vi.mock("@copytrade/shared/lib/exchange/ExchangeFactory", () => ({
  ExchangeFactory: {
    getClientForAccount: orphanCleanupMocks.getClientForAccount,
  },
}));

vi.mock("./agent/tooling/shared", () => ({
  toExchangeCredentials: orphanCleanupMocks.toExchangeCredentials,
}));

import { runOrphanCleanupMonitor } from "./orphan-cleanup-monitor";

function createExecQuery(result: unknown) {
  const exec = vi.fn().mockResolvedValue(result);
  return { exec };
}

function createLeanExecQuery(result: unknown) {
  const exec = vi.fn().mockResolvedValue(result);
  const lean = vi.fn().mockReturnValue({ exec });
  return { lean };
}

beforeEach(() => {
  orphanCleanupMocks.accountFind.mockReset();
  orphanCleanupMocks.positionFind.mockReset();
  orphanCleanupMocks.getClientForAccount.mockReset();
  orphanCleanupMocks.toExchangeCredentials.mockReset();

  orphanCleanupMocks.toExchangeCredentials.mockReturnValue({ provider: "bybit" });
});

test("orphan cleanup monitor removes stale TP/SL based only on tracked and live positions", async () => {
  const exchange = {
    getAlgoOrders: vi.fn().mockResolvedValue([
      {
        orderId: "algo-flock",
        symbol: "FLOCKUSDT",
        type: "tp",
      },
      {
        orderId: "algo-bch",
        symbol: "BCHUSDT",
        type: "sl",
      },
    ]),
    getOpenPositions: vi.fn().mockResolvedValue([{ symbol: "BCHUSDT" }]),
    getOpenOrders: vi.fn().mockResolvedValue([
      {
        orderId: "limit-flock",
        symbol: "FLOCKUSDT",
        type: "limit",
      },
    ]),
    cancelAlgoOrders: vi
      .fn()
      .mockResolvedValue({ cancelled: ["algo-flock"], errors: [] }),
  };

  orphanCleanupMocks.accountFind.mockReturnValue(
    createExecQuery([
      {
        _id: "acc-1",
        name: "VIP",
        isActive: true,
        tradingPlatform: "bybit",
        exchangeData: { apiKey: "x" },
      },
    ]),
  );
  orphanCleanupMocks.positionFind.mockReturnValue(createLeanExecQuery([]));
  orphanCleanupMocks.getClientForAccount.mockReturnValue(exchange);

  const result = await runOrphanCleanupMonitor();

  assert.equal(result.accountsChecked, 1);
  assert.equal(result.algoOrdersChecked, 2);
  assert.equal(result.orphansCancelled, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(exchange.cancelAlgoOrders.mock.calls.length, 1);
  assert.deepEqual(exchange.cancelAlgoOrders.mock.calls[0], ["FLOCKUSDT"]);
  assert.equal(exchange.getOpenOrders.mock.calls.length, 0);
});
