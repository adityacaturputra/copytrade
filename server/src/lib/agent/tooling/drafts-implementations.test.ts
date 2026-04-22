import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const draftsMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  getPendingDrafts: vi.fn(),
  getFrontendBaseUrl: vi.fn(),
  getErrorMessage: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/database", () => ({
  connectDB: draftsMocks.connectDB,
  getPendingDrafts: draftsMocks.getPendingDrafts,
}));

vi.mock("./shared", () => ({
  getFrontendBaseUrl: draftsMocks.getFrontendBaseUrl,
  getErrorMessage: draftsMocks.getErrorMessage,
}));

import { draftsToolImplementations } from "./drafts-implementations";

beforeEach(() => {
  draftsMocks.connectDB.mockReset();
  draftsMocks.getPendingDrafts.mockReset();
  draftsMocks.getFrontendBaseUrl.mockReset();
  draftsMocks.getErrorMessage.mockReset();
  draftsMocks.fetchMock.mockReset();

  draftsMocks.connectDB.mockResolvedValue(undefined);
  draftsMocks.getFrontendBaseUrl.mockReturnValue("http://frontend.test");
  draftsMocks.getErrorMessage.mockImplementation((data) => data?.error);
  vi.stubGlobal("fetch", draftsMocks.fetchMock);
});

test("draft implementations list pending drafts and validate direct accept/reject ids", async () => {
  draftsMocks.getPendingDrafts.mockResolvedValue([
    {
      _id: "draft-1",
      action: "BUY",
      symbol: "BTCUSDT",
      side: "LONG",
      entryPrice: 100,
      takeProfitTargets: [110],
      stopLoss: 95,
      leverage: 10,
      quantity: 1,
      confidence: 80,
      reasoning: "breakout",
      author: "Trader",
      status: "pending",
      originalContent: "buy",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  draftsMocks.fetchMock.mockResolvedValue({
    json: async () => ({ success: true }),
  });

  const listed = JSON.parse(
    await draftsToolImplementations.get_pending_drafts({}),
  );
  const invalid = JSON.parse(
    await draftsToolImplementations.accept_draft({ draftId: "bad-id" }),
  );
  const accepted = JSON.parse(
    await draftsToolImplementations.accept_draft({
      draftId: "6810a1b2c3d4e5f6a7b8c9d0",
    }),
  );
  const rejected = JSON.parse(
    await draftsToolImplementations.reject_draft({
      draftId: "6810a1b2c3d4e5f6a7b8c9d1",
    }),
  );

  assert.equal(listed[0].symbol, "BTCUSDT");
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /Invalid draft ID/);
  assert.deepEqual(accepted, { success: true });
  assert.deepEqual(rejected, { success: true });
  assert.deepEqual(draftsMocks.fetchMock.mock.calls.map((call) => call[0]), [
    "http://frontend.test/api/drafts/6810a1b2c3d4e5f6a7b8c9d0/accept",
    "http://frontend.test/api/drafts/6810a1b2c3d4e5f6a7b8c9d1/reject",
  ]);
});

test("draft implementations bulk accept and reject drafts, including empty and error cases", async () => {
  draftsMocks.getPendingDrafts
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: "6810a1b2c3d4e5f6a7b8c9d0" },
      { _id: "6810a1b2c3d4e5f6a7b8c9d1" },
    ])
    .mockResolvedValueOnce([
      { _id: "6810a1b2c3d4e5f6a7b8c9d2" },
      { _id: "6810a1b2c3d4e5f6a7b8c9d3" },
    ]);
  draftsMocks.fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "blocked" }),
    })
    .mockRejectedValueOnce(new Error("network failed"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

  const empty = JSON.parse(await draftsToolImplementations.accept_all_drafts({}));
  const accepted = JSON.parse(await draftsToolImplementations.accept_all_drafts({}));
  const rejected = JSON.parse(await draftsToolImplementations.reject_all_drafts({}));

  assert.deepEqual(empty, {
    success: true,
    message: "No pending drafts to accept.",
    accepted: 0,
  });
  assert.equal(accepted.accepted, 1);
  assert.equal(accepted.failed, 1);
  assert.deepEqual(accepted.results, [
    { id: "6810a1b2c3d4e5f6a7b8c9d0", success: true },
    { id: "6810a1b2c3d4e5f6a7b8c9d1", success: false, error: "blocked" },
  ]);
  assert.equal(rejected.rejected, 1);
  assert.equal(rejected.failed, 1);
  assert.deepEqual(rejected.results, [
    { id: "6810a1b2c3d4e5f6a7b8c9d2", success: false, error: "network failed" },
    { id: "6810a1b2c3d4e5f6a7b8c9d3", success: true },
  ]);
});
