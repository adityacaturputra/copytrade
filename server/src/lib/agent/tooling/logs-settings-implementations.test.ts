import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const logsMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  getAllPositions: vi.fn(),
  getRecentLogs: vi.fn(),
  getRecentMessages: vi.fn(),
  getStats: vi.fn(),
  getTradingMode: vi.fn(),
  setTradingMode: vi.fn(),
  calculateRisk: vi.fn(),
  getRiskConfig: vi.fn(),
  resolveExchangeContext: vi.fn(),
  roundPrice: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/database/index", () => ({
  connectDB: logsMocks.connectDB,
  getAllPositions: logsMocks.getAllPositions,
  getRecentLogs: logsMocks.getRecentLogs,
  getRecentMessages: logsMocks.getRecentMessages,
  getStats: logsMocks.getStats,
  getTradingMode: logsMocks.getTradingMode,
  setTradingMode: logsMocks.setTradingMode,
}));

vi.mock("@copytrade/shared/lib/risk/calc", () => ({
  calculateRisk: logsMocks.calculateRisk,
}));

vi.mock("@copytrade/shared/lib/risk/index", () => ({
  getRiskConfig: logsMocks.getRiskConfig,
}));

vi.mock("./shared", () => ({
  resolveExchangeContext: logsMocks.resolveExchangeContext,
  roundPrice: logsMocks.roundPrice,
}));

import { logsSettingsToolImplementations } from "./logs-settings-implementations";

beforeEach(() => {
  logsMocks.connectDB.mockReset();
  logsMocks.getAllPositions.mockReset();
  logsMocks.getRecentLogs.mockReset();
  logsMocks.getRecentMessages.mockReset();
  logsMocks.getStats.mockReset();
  logsMocks.getTradingMode.mockReset();
  logsMocks.setTradingMode.mockReset();
  logsMocks.calculateRisk.mockReset();
  logsMocks.getRiskConfig.mockReset();
  logsMocks.resolveExchangeContext.mockReset();
  logsMocks.roundPrice.mockReset();

  logsMocks.connectDB.mockResolvedValue(undefined);
  logsMocks.roundPrice.mockImplementation((value: number) =>
    Math.round(value * 100) / 100,
  );
});

test("logs/settings implementations expose stats, logs, signals, history, and mode controls", async () => {
  logsMocks.getStats.mockResolvedValue({ totalSignals: 9 });
  logsMocks.getRecentLogs.mockResolvedValue([
    {
      type: "executor",
      action: "BUY",
      symbol: "BTCUSDT",
      details: "placed",
      result: "ok",
      error: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  logsMocks.getRecentMessages.mockResolvedValue([
    {
      accountId: "acc-1",
      processId: "proc-1",
      messageId: "msg-1",
      channelId: "chan-1",
      author: "Trader",
      content: "buy",
      signalType: "BUY",
      parsedSignal: "{}",
      status: "processed",
      sourceTimestamp: null,
      processedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  logsMocks.getAllPositions.mockResolvedValue([
    {
      _id: "pos-1",
      symbol: "BTCUSDT",
      side: "LONG",
      entryPrice: 100,
      quantity: 1,
      leverage: 10,
      pnl: 15,
      status: "closed",
      closeReason: "tp",
      openedAt: "2026-01-01T00:00:00.000Z",
      closedAt: "2026-01-02T00:00:00.000Z",
    },
  ]);
  logsMocks.getTradingMode.mockResolvedValue("manual");

  const stats = JSON.parse(await logsSettingsToolImplementations.get_stats({}));
  const recentLogs = JSON.parse(
    await logsSettingsToolImplementations.get_recent_logs({ limit: 5 }),
  );
  const recentSignals = JSON.parse(
    await logsSettingsToolImplementations.get_recent_signals({ limit: 5 }),
  );
  const history = JSON.parse(
    await logsSettingsToolImplementations.get_all_positions_history({ limit: 5 }),
  );
  const mode = JSON.parse(
    await logsSettingsToolImplementations.get_trading_mode({}),
  );
  const setMode = JSON.parse(
    await logsSettingsToolImplementations.set_trading_mode({ mode: "auto" }),
  );

  assert.deepEqual(stats, { totalSignals: 9 });
  assert.equal(recentLogs[0].symbol, "BTCUSDT");
  assert.equal(recentSignals[0].messageId, "msg-1");
  assert.equal(history[0]._id, "pos-1");
  assert.deepEqual(mode, { mode: "manual" });
  assert.deepEqual(setMode, { success: true, mode: "auto" });
  assert.deepEqual(logsMocks.setTradingMode.mock.calls[0], ["auto"]);
});

test("logs/settings implementations expose risk settings and build risk previews from exchange context", async () => {
  logsMocks.getRiskConfig.mockResolvedValue({
    riskPerTradePercent: 1,
    minLeverage: 2,
    maxLeverage: 10,
  });
  logsMocks.resolveExchangeContext.mockResolvedValue({
    provider: "bybit",
    accountId: "acc-1",
    accountName: "VIP",
    exchange: {
      getAccountInfo: vi.fn().mockResolvedValue({
        totalBalance: 1000,
        availableBalance: 700,
      }),
    },
  });
  logsMocks.calculateRisk.mockReturnValue({
    recommendedQuantity: 0.5,
    recommendedLeverage: 5,
  });

  const settings = JSON.parse(
    await logsSettingsToolImplementations.get_risk_settings({}),
  );
  const preview = JSON.parse(
    await logsSettingsToolImplementations.calculate_risk_preview({
      entryPrice: 100.129,
      stopLossPrice: 95.876,
      side: "LONG",
      accountId: "acc-1",
    }),
  );

  assert.equal(settings.riskPerTradePercent, 1);
  assert.equal(preview.provider, "bybit");
  assert.equal(preview.accountBalance, 700);
  assert.equal(preview.entryPrice, 100.13);
  assert.equal(preview.stopLossPrice, 95.88);
  assert.equal(preview.recommendedQuantity, 0.5);
  assert.deepEqual(logsMocks.calculateRisk.mock.calls[0][0], {
    accountBalance: 700,
    riskPerTradePercent: 1,
    entryPrice: 100.129,
    stopLossPrice: 95.876,
    minLeverage: 2,
    maxLeverage: 10,
  });
});
