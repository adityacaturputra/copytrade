import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const riskMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  riskFindOne: vi.fn(),
  riskFindOneAndUpdate: vi.fn(),
  accountFindById: vi.fn(),
  calculateRisk: vi.fn(),
}));

vi.mock("./database", () => ({
  connectDB: riskMocks.connectDB,
  RiskSettings: {
    findOne: riskMocks.riskFindOne,
    findOneAndUpdate: riskMocks.riskFindOneAndUpdate,
  },
  Account: {
    findById: riskMocks.accountFindById,
  },
}));

vi.mock("./risk-calc", () => ({
  calculateRisk: riskMocks.calculateRisk,
}));

import {
  calculateRiskBasedPosition,
  getRiskConfig,
  resolveEffectiveRiskConfig,
  setRiskConfig,
} from "./risk";

beforeEach(() => {
  riskMocks.connectDB.mockReset();
  riskMocks.riskFindOne.mockReset();
  riskMocks.riskFindOneAndUpdate.mockReset();
  riskMocks.accountFindById.mockReset();
  riskMocks.calculateRisk.mockReset();
});

test("getRiskConfig returns DB-backed settings and falls back to defaults on failure", async () => {
  riskMocks.riskFindOne.mockReturnValueOnce({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        riskPerTradePercent: 2,
        maxLeverage: 50,
        minLeverage: 2,
        skipNoSL: false,
        defaultRR: 4,
        defaultPositionSize: 100,
        defaultLeverage: 12,
        maxPositions: 7,
      }),
    }),
  });

  const fromDb = await getRiskConfig();
  assert.deepEqual(fromDb, {
    riskPerTradePercent: 2,
    maxLeverage: 50,
    minLeverage: 2,
    skipNoSL: false,
    defaultRR: 4,
    defaultPositionSize: 100,
    defaultLeverage: 12,
    maxPositions: 7,
  });

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  riskMocks.connectDB.mockRejectedValueOnce(new Error("db down"));

  const fallback = await getRiskConfig();
  assert.deepEqual(fallback, {
    riskPerTradePercent: 1,
    maxLeverage: 100,
    minLeverage: 1,
    skipNoSL: true,
    defaultRR: 3,
    defaultPositionSize: 50,
    defaultLeverage: 10,
    maxPositions: 5,
  });
  assert.equal(warnSpy.mock.calls.length, 1);

  warnSpy.mockRestore();
});

test("setRiskConfig persists provided fields and normalizes missing optional values", async () => {
  riskMocks.riskFindOneAndUpdate.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      riskPerTradePercent: 3,
      maxLeverage: 25,
      minLeverage: 1,
      skipNoSL: undefined,
      defaultRR: undefined,
      defaultPositionSize: undefined,
      defaultLeverage: undefined,
      maxPositions: undefined,
    }),
  });

  const config = await setRiskConfig({
    riskPerTradePercent: 3,
    maxLeverage: 25,
  });

  assert.deepEqual(riskMocks.riskFindOneAndUpdate.mock.calls[0], [
    {},
    {
      riskPerTradePercent: 3,
      maxLeverage: 25,
    },
    { upsert: true, new: true },
  ]);
  assert.deepEqual(config, {
    riskPerTradePercent: 3,
    maxLeverage: 25,
    minLeverage: 1,
    skipNoSL: true,
    defaultRR: 3,
    defaultPositionSize: 50,
    defaultLeverage: 10,
    maxPositions: 5,
  });
});

test("resolveEffectiveRiskConfig merges global, account, and channel overrides", async () => {
  riskMocks.riskFindOne.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        riskPerTradePercent: 1,
        maxLeverage: 100,
        minLeverage: 1,
        skipNoSL: true,
        defaultRR: 3,
        defaultPositionSize: 50,
        defaultLeverage: 10,
        maxPositions: 5,
      }),
    }),
  });

  riskMocks.accountFindById.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          riskOverrides: {
            riskPerTradePercent: 2,
            skipNoSL: false,
            bad: "ignored",
          },
          channelConfigs: {
            chan1: {
              riskOverrides: {
                defaultLeverage: 15,
                maxPositions: 2,
              },
            },
          },
        }),
      }),
    }),
  });

  const merged = await resolveEffectiveRiskConfig({
    accountId: "acc1",
    channelId: " chan1 ",
  });

  assert.equal(merged.riskPerTradePercent, 2);
  assert.equal(merged.skipNoSL, false);
  assert.equal(merged.defaultLeverage, 15);
  assert.equal(merged.maxPositions, 2);
  assert.equal(merged.sources.riskPerTradePercent, "account");
  assert.equal(merged.sources.defaultLeverage, "source_chat");
  assert.equal(merged.sources.maxPositions, "source_chat");
});

test("resolveEffectiveRiskConfig returns global config when no accountId is provided", async () => {
  riskMocks.riskFindOne.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        riskPerTradePercent: 1.5,
        maxLeverage: 30,
        minLeverage: 2,
        skipNoSL: true,
        defaultRR: 2,
        defaultPositionSize: 80,
        defaultLeverage: 5,
        maxPositions: 1,
      }),
    }),
  });

  const merged = await resolveEffectiveRiskConfig();
  assert.equal(merged.riskPerTradePercent, 1.5);
  assert.equal(merged.sources.riskPerTradePercent, "global");
  assert.equal(riskMocks.accountFindById.mock.calls.length, 0);
});

test("calculateRiskBasedPosition handles invalid balances and missing stop losses", async () => {
  riskMocks.riskFindOne.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        riskPerTradePercent: 1,
        maxLeverage: 100,
        minLeverage: 1,
        skipNoSL: true,
        defaultRR: 3,
        defaultPositionSize: 50,
        defaultLeverage: 10,
        maxPositions: 5,
      }),
    }),
  });

  const invalidBalance = await calculateRiskBasedPosition(
    100,
    90,
    "LONG",
    1,
    10,
    0,
  );
  assert.equal(invalidBalance.applied, false);
  assert.match(
    invalidBalance.skipReason || "",
    /No valid account balance provided/,
  );

  const skipNoSl = await calculateRiskBasedPosition(
    100,
    null,
    "LONG",
    1,
    10,
    1000,
  );
  assert.equal(skipNoSl.quantity, 0);
  assert.match(skipNoSl.skipReason || "", /trade skipped/);

  riskMocks.riskFindOne.mockReturnValueOnce({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        riskPerTradePercent: 1,
        maxLeverage: 100,
        minLeverage: 1,
        skipNoSL: false,
        defaultRR: 3,
        defaultPositionSize: 50,
        defaultLeverage: 10,
        maxPositions: 5,
      }),
    }),
  });

  const noSlButAllowed = await calculateRiskBasedPosition(
    100,
    undefined,
    "SHORT",
    2,
    20,
    1000,
  );
  assert.equal(noSlButAllowed.quantity, 2);
  assert.equal(noSlButAllowed.leverage, 20);
  assert.match(noSlButAllowed.skipReason || "", /cannot calculate risk-based/);
});

test("calculateRiskBasedPosition rejects very tight stop losses and returns the shared risk calc result", async () => {
  riskMocks.riskFindOne.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        riskPerTradePercent: 1,
        maxLeverage: 50,
        minLeverage: 2,
        skipNoSL: true,
        defaultRR: 3,
        defaultPositionSize: 50,
        defaultLeverage: 10,
        maxPositions: 5,
      }),
    }),
  });

  const tooClose = await calculateRiskBasedPosition(
    100,
    99.999,
    "LONG",
    1,
    8,
    1000,
  );
  assert.equal(tooClose.applied, false);
  assert.match(tooClose.skipReason || "", /too close/);

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  riskMocks.calculateRisk.mockReturnValue({
    marginUsdt: 10,
    slDistancePercent: 0.05,
    notionalSize: 200,
    quantity: 2,
    leverage: 20,
  });

  const applied = await calculateRiskBasedPosition(
    100,
    95,
    "LONG",
    1,
    8,
    1000,
    { accountId: null, channelId: null },
  );

  assert.equal(applied.applied, true);
  assert.equal(applied.accountBalance, 1000);
  assert.equal(applied.marginUsdt, 10);
  assert.equal(applied.quantity, 2);
  assert.deepEqual(riskMocks.calculateRisk.mock.calls[0][0], {
    accountBalance: 1000,
    riskPerTradePercent: 1,
    entryPrice: 100,
    stopLossPrice: 95,
    minLeverage: 2,
    maxLeverage: 50,
  });
  assert.equal(logSpy.mock.calls.length, 2);

  logSpy.mockRestore();
});
