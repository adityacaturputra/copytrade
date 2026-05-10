import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const dbMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock("./database", () => ({
  connectDB: dbMocks.connectDB,
  SignalConfig: {
    findOne: dbMocks.findOne,
    findOneAndUpdate: dbMocks.findOneAndUpdate,
  },
}));

import { getSignalConfig, setSignalConfig } from "./signal-config";

beforeEach(() => {
  dbMocks.connectDB.mockReset();
  dbMocks.findOne.mockReset();
  dbMocks.findOneAndUpdate.mockReset();
});

test("getSignalConfig returns DB values and default booleans when missing", async () => {
  dbMocks.findOne.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        fetchLimit: 20,
        timeWindowHours: 48,
        batchSize: 10,
      }),
    }),
  });

  const config = await getSignalConfig();

  assert.deepEqual(config, {
    fetchLimit: 20,
    timeWindowHours: 48,
    batchSize: 10,
    includeImageUrls: false,
  });
});

test("getSignalConfig falls back to defaults and warns on DB failure", async () => {
  dbMocks.connectDB.mockRejectedValue(new Error("db down"));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const config = await getSignalConfig();

  assert.deepEqual(config, {
    fetchLimit: 10,
    timeWindowHours: 24,
    batchSize: 5,
    includeImageUrls: false,
  });
  assert.equal(warnSpy.mock.calls.length, 1);

  warnSpy.mockRestore();
});

test("setSignalConfig persists only provided fields and normalizes optional flags", async () => {
  const leanMock = vi.fn().mockResolvedValue({
    fetchLimit: 15,
    timeWindowHours: 12,
    batchSize: 7,
    includeImageUrls: true,
  });
  dbMocks.findOneAndUpdate.mockReturnValue({ lean: leanMock });

  const config = await setSignalConfig({
    fetchLimit: 15,
    batchSize: 7,
    includeImageUrls: true,
  });

  assert.deepEqual(dbMocks.findOneAndUpdate.mock.calls[0], [
    {},
    {
      fetchLimit: 15,
      batchSize: 7,
      includeImageUrls: true,
    },
    { upsert: true, new: true },
  ]);
  assert.deepEqual(config, {
    fetchLimit: 15,
    timeWindowHours: 12,
    batchSize: 7,
    includeImageUrls: true,
  });
});

test("setSignalConfig persists time window and vision flags when provided", async () => {
  const leanMock = vi.fn().mockResolvedValue({
    fetchLimit: 10,
    timeWindowHours: 6,
    batchSize: 5,
    includeImageUrls: false,
  });
  dbMocks.findOneAndUpdate.mockReturnValue({ lean: leanMock });

  const config = await setSignalConfig({
    timeWindowHours: 6,
  });

  assert.deepEqual(dbMocks.findOneAndUpdate.mock.calls[0], [
    {},
    {
      timeWindowHours: 6,
    },
    { upsert: true, new: true },
  ]);
  assert.deepEqual(config, {
    fetchLimit: 10,
    timeWindowHours: 6,
    batchSize: 5,
    includeImageUrls: false,
  });
});
