import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const databaseMocks = vi.hoisted(() => {
  const connect = vi.fn();
  const disconnect = vi.fn();
  const models = {};
  const connection = {
    readyState: 0,
    host: "db-host",
    db: null as
      | null
      | {
          collection: ReturnType<typeof vi.fn>;
        },
  };

  const makeQuery = (result: unknown) => {
    const query = {
      sort: vi.fn(),
      limit: vi.fn(),
      lean: vi.fn(),
    };
    query.sort.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.lean.mockResolvedValue(result);
    return query;
  };

  const processedMessageModel = {
    countDocuments: vi.fn(),
    find: vi.fn(),
  };
  const positionModel = {
    countDocuments: vi.fn(),
    find: vi.fn(),
  };
  const draftTradeModel = {
    countDocuments: vi.fn(),
    find: vi.fn(),
  };
  const tradingModeModel = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  };
  const discordSourceModel = {
    find: vi.fn(),
  };
  const accountModel = {};
  const riskSettingsModel = {};
  const signalConfigModel = {};
  const agentSessionModel = {};
  const agentTurnModel = {};
  const tradeLogModel = {};

  const modelMap: Record<string, unknown> = {
    ProcessedMessage: processedMessageModel,
    Position: positionModel,
    TradeLog: tradeLogModel,
    DraftTrade: draftTradeModel,
    TradingMode: tradingModeModel,
    DiscordSource: discordSourceModel,
    Account: accountModel,
    RiskSettings: riskSettingsModel,
    SignalConfig: signalConfigModel,
    AgentSession: agentSessionModel,
    AgentTurn: agentTurnModel,
  };

  class SchemaMock {
    static Types = { Mixed: "Mixed" };
    index = vi.fn();
    constructor(_definition: unknown, _options?: unknown) {}
  }

  return {
    connect,
    disconnect,
    connection,
    models,
    SchemaMock,
    modelMap,
    makeQuery,
    processedMessageModel,
    positionModel,
    draftTradeModel,
    tradingModeModel,
    discordSourceModel,
  };
});

vi.mock("mongoose", () => {
  const mongooseDefault = {
    connect: databaseMocks.connect,
    disconnect: databaseMocks.disconnect,
    connection: databaseMocks.connection,
    model: vi.fn((name: string) => databaseMocks.modelMap[name]),
  };

  return {
    default: mongooseDefault,
    Schema: databaseMocks.SchemaMock,
    Document: class {},
    models: databaseMocks.models,
    Model: class {},
  };
});

vi.mock("../trade-log/store", () => ({
  countTradeLogs: vi.fn(),
  getRecentTradeLogs: vi.fn(),
}));

import {
  ProcessedMessage,
  Position,
  DraftTrade,
  TradingMode,
  DiscordSource,
  buildTPTargets,
  calculateTPPercentages,
  connectDB,
  disconnectDB,
  getActiveDiscordSources,
  getAllDiscordSources,
  getAllPositions,
  getOpenPositions,
  getPendingDrafts,
  getRecentDrafts,
  getRecentLogs,
  getRecentMessages,
  getStats,
  getTradingMode,
  recalculateTPAllocation,
  resetDBConnectionState,
  setTradingMode,
} from "./index";
import { countTradeLogs, getRecentTradeLogs } from "../trade-log/store";

beforeEach(() => {
  databaseMocks.connect.mockReset();
  databaseMocks.disconnect.mockReset();
  databaseMocks.connection.readyState = 0;
  databaseMocks.connection.db = null;
  databaseMocks.processedMessageModel.countDocuments.mockReset();
  databaseMocks.processedMessageModel.find.mockReset();
  databaseMocks.positionModel.countDocuments.mockReset();
  databaseMocks.positionModel.find.mockReset();
  databaseMocks.draftTradeModel.countDocuments.mockReset();
  databaseMocks.draftTradeModel.find.mockReset();
  databaseMocks.tradingModeModel.findOne.mockReset();
  databaseMocks.tradingModeModel.findOneAndUpdate.mockReset();
  databaseMocks.discordSourceModel.find.mockReset();
  vi.mocked(countTradeLogs).mockReset();
  vi.mocked(getRecentTradeLogs).mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetDBConnectionState();

  databaseMocks.connect.mockResolvedValue({
    connection: { host: "mongo-test" },
  });
  databaseMocks.disconnect.mockResolvedValue(undefined);
  databaseMocks.tradingModeModel.findOne.mockReturnValue(
    databaseMocks.makeQuery({ mode: "auto" }),
  );
  databaseMocks.tradingModeModel.findOneAndUpdate.mockResolvedValue(undefined);
  vi.mocked(countTradeLogs).mockResolvedValue(12);
  vi.mocked(getRecentTradeLogs).mockResolvedValue([{ _id: "log-1" }] as never);
});

test("connectDB connects once, manages indexes, and disconnectDB resets state", async () => {
  const indexes = vi
    .fn()
    .mockResolvedValue([{ name: "messageId_1", unique: true }]);
  const dropIndex = vi.fn().mockResolvedValue(undefined);
  const createIndex = vi.fn().mockResolvedValue(undefined);
  const collection = vi.fn().mockReturnValue({
    indexes,
    dropIndex,
    createIndex,
  });

  databaseMocks.connection.db = { collection };
  databaseMocks.connection.readyState = 1;

  await connectDB();
  await connectDB();

  assert.equal(databaseMocks.connect.mock.calls.length, 1);
  assert.equal(collection.mock.calls[0]?.[0], "processedmessages");
  assert.equal(dropIndex.mock.calls[0]?.[0], "messageId_1");
  assert.deepEqual(createIndex.mock.calls[0], [
    { messageId: 1, accountId: 1 },
    { name: "messageId_1_accountId_1", unique: true },
  ]);

  databaseMocks.connection.readyState = 1;
  await disconnectDB();
  assert.equal(databaseMocks.disconnect.mock.calls.length, 1);
});

test("connectDB logs and rethrows connection failures while index setup failures only warn", async () => {
  const failingCollection = vi.fn().mockReturnValue({
    indexes: vi.fn().mockRejectedValue(new Error("ns missing")),
    dropIndex: vi.fn(),
    createIndex: vi.fn(),
  });
  databaseMocks.connection.db = { collection: failingCollection };
  databaseMocks.connection.readyState = 1;

  await connectDB();
  assert.ok(
    vi.mocked(console.warn).mock.calls.some((call) =>
      String(call[0]).includes("Failed to ensure processedmessages indexes"),
    ),
  );

  resetDBConnectionState();
  databaseMocks.connect.mockRejectedValueOnce(new Error("mongo down"));

  await assert.rejects(() => connectDB(), /mongo down/);
  assert.ok(
    vi.mocked(console.error).mock.calls.some((call) =>
      String(call[0]).includes("MongoDB connection error:"),
    ),
  );
});

test("database query helpers delegate to the expected models", async () => {
  const activeQuery = databaseMocks.makeQuery([{ _id: "discord-1" }]);
  const allQuery = databaseMocks.makeQuery([{ _id: "discord-2" }]);
  const openPositionsQuery = databaseMocks.makeQuery([{ _id: "open-1" }]);
  const recentMessagesQuery = databaseMocks.makeQuery([{ _id: "msg-1" }]);
  const allPositionsQuery = databaseMocks.makeQuery([{ _id: "pos-1" }]);
  const pendingDraftsQuery = databaseMocks.makeQuery([{ _id: "draft-pending" }]);
  const recentDraftsQuery = databaseMocks.makeQuery([{ _id: "draft-1" }]);

  databaseMocks.discordSourceModel.find
    .mockReturnValueOnce(activeQuery)
    .mockReturnValueOnce(allQuery);
  databaseMocks.positionModel.find
    .mockReturnValueOnce(openPositionsQuery)
    .mockReturnValueOnce(allPositionsQuery);
  databaseMocks.processedMessageModel.find.mockReturnValue(recentMessagesQuery);
  databaseMocks.draftTradeModel.find
    .mockReturnValueOnce(pendingDraftsQuery)
    .mockReturnValueOnce(recentDraftsQuery);

  assert.deepEqual(await getActiveDiscordSources(), [{ _id: "discord-1" }]);
  assert.deepEqual(await getAllDiscordSources(), [{ _id: "discord-2" }]);
  assert.deepEqual(await getOpenPositions(), [{ _id: "open-1" }]);
  assert.deepEqual(await getRecentMessages(7), [{ _id: "msg-1" }]);
  assert.deepEqual(await getAllPositions(3), [{ _id: "pos-1" }]);
  assert.deepEqual(await getPendingDrafts(), [{ _id: "draft-pending" }]);
  assert.deepEqual(await getRecentDrafts(4), [{ _id: "draft-1" }]);
  assert.deepEqual(await getRecentLogs(6), [{ _id: "log-1" }]);

  assert.deepEqual(databaseMocks.discordSourceModel.find.mock.calls[0], [
    { isActive: true },
  ]);
  assert.deepEqual(databaseMocks.positionModel.find.mock.calls[0], [
    { status: "open" },
  ]);
  assert.equal(recentMessagesQuery.limit.mock.calls[0]?.[0], 7);
  assert.equal(allPositionsQuery.limit.mock.calls[0]?.[0], 3);
  assert.deepEqual(databaseMocks.draftTradeModel.find.mock.calls[0], [
    { status: "pending" },
  ]);
  assert.equal(recentDraftsQuery.limit.mock.calls[0]?.[0], 4);
  assert.equal(vi.mocked(getRecentTradeLogs).mock.calls[0]?.[0], 6);
});

test("trading mode and stats helpers use defaults and aggregate counts", async () => {
  databaseMocks.tradingModeModel.findOne.mockReturnValueOnce(
    databaseMocks.makeQuery(null),
  );
  assert.equal(await getTradingMode(), "manual");

  await setTradingMode("auto");
  assert.deepEqual(databaseMocks.tradingModeModel.findOneAndUpdate.mock.calls[0], [
    {},
    { mode: "auto" },
    { upsert: true, new: true },
  ]);

  databaseMocks.processedMessageModel.countDocuments
    .mockResolvedValueOnce(30)
    .mockResolvedValueOnce(5);
  databaseMocks.positionModel.countDocuments
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(8);
  databaseMocks.draftTradeModel.countDocuments.mockResolvedValueOnce(4);
  vi.mocked(countTradeLogs).mockResolvedValueOnce(19);

  assert.deepEqual(await getStats(), {
    totalMessages: 30,
    executedSignals: 5,
    openPositions: 2,
    closedPositions: 8,
    totalLogs: 19,
    pendingDrafts: 4,
  });
});

test("tp allocation helpers distribute quantities and percentages deterministically", () => {
  assert.deepEqual(calculateTPPercentages(0), []);
  assert.deepEqual(calculateTPPercentages(1), [100]);
  assert.deepEqual(calculateTPPercentages(3), [33.33, 33.33, 33.34]);

  assert.deepEqual(buildTPTargets([110, 120, 130], 1.5), [
    { price: 110, quantity: 0.4999, percentage: 33.33, status: "pending" },
    { price: 120, quantity: 0.4999, percentage: 33.33, status: "pending" },
    { price: 130, quantity: 0.5001, percentage: 33.34, status: "pending" },
  ]);

  assert.deepEqual(calculateTPPercentages(4, "halving"), [50, 25, 12.5, 12.5]);
  assert.deepEqual(buildTPTargets([110, 120, 130, 140], 100, "halving"), [
    { price: 110, quantity: 50, percentage: 50, status: "pending" },
    { price: 120, quantity: 25, percentage: 25, status: "pending" },
    { price: 130, quantity: 12.5, percentage: 12.5, status: "pending" },
    { price: 140, quantity: 12.5, percentage: 12.5, status: "pending" },
  ]);

  assert.deepEqual(
    recalculateTPAllocation(
      [
        { price: 110, quantity: 0, percentage: 0, status: "pending" },
        { price: 120, quantity: 0, percentage: 0, status: "hit" },
      ],
      2,
    ),
    [
      { price: 110, quantity: 1, percentage: 50, status: "pending" },
      { price: 120, quantity: 1, percentage: 50, status: "hit" },
    ],
  );
});

test("database models are exposed from the mocked mongoose registry", () => {
  assert.equal(ProcessedMessage, databaseMocks.processedMessageModel);
  assert.equal(Position, databaseMocks.positionModel);
  assert.equal(DraftTrade, databaseMocks.draftTradeModel);
  assert.equal(TradingMode, databaseMocks.tradingModeModel);
  assert.equal(DiscordSource, databaseMocks.discordSourceModel);
});
