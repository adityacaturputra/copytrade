import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { NextRequest } from "next/server";

const cleanupRouteMocks = vi.hoisted(() => ({
  cleanupTradeLogs: vi.fn(),
}));

vi.mock("@copytrade/shared/lib/trade-log-store", () => ({
  cleanupTradeLogs: cleanupRouteMocks.cleanupTradeLogs,
}));

beforeEach(() => {
  cleanupRouteMocks.cleanupTradeLogs.mockReset();
});

test("cleanup route deletes noisy logs by default", async () => {
  cleanupRouteMocks.cleanupTradeLogs.mockResolvedValueOnce({
    mode: "noisy-json",
    scannedCount: 10,
    deletedCount: 4,
    remainingCount: 6,
  });

  const request = {
    json: vi.fn().mockResolvedValue({}),
  } as unknown as NextRequest;
  const { POST } = await import("./route");

  const response = await POST(request);
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(cleanupRouteMocks.cleanupTradeLogs.mock.calls[0]?.[0], {
    mode: "noisy-json",
    keepDays: undefined,
  });
  assert.deepEqual(json, {
    success: true,
    data: {
      mode: "noisy-json",
      scannedCount: 10,
      deletedCount: 4,
      remainingCount: 6,
    },
  });
});

test("cleanup route validates retention keepDays", async () => {
  const request = {
    json: vi.fn().mockResolvedValue({ mode: "retention", keepDays: 0 }),
  } as unknown as NextRequest;
  const { POST } = await import("./route");

  const response = await POST(request);
  const json = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(json, {
    success: false,
    error: "keepDays must be a number greater than or equal to 1",
  });
  assert.equal(cleanupRouteMocks.cleanupTradeLogs.mock.calls.length, 0);
});

test("cleanup route runs retention cleanup and handles failures", async () => {
  cleanupRouteMocks.cleanupTradeLogs
    .mockResolvedValueOnce({
      mode: "retention",
      keepDays: 3,
      scannedCount: 10,
      deletedCount: 7,
      remainingCount: 3,
    })
    .mockRejectedValueOnce(new Error("cleanup failed"));

  const { POST } = await import("./route");

  const successRequest = {
    json: vi.fn().mockResolvedValue({ mode: "retention", keepDays: "3" }),
  } as unknown as NextRequest;
  const successResponse = await POST(successRequest);
  const successJson = await successResponse.json();

  assert.equal(successResponse.status, 200);
  assert.deepEqual(cleanupRouteMocks.cleanupTradeLogs.mock.calls[0]?.[0], {
    mode: "retention",
    keepDays: 3,
  });
  assert.equal(successJson.success, true);

  const failedRequest = {
    json: vi.fn().mockResolvedValue({ mode: "retention", keepDays: 5 }),
  } as unknown as NextRequest;
  const failedResponse = await POST(failedRequest);
  const failedJson = await failedResponse.json();

  assert.equal(failedResponse.status, 500);
  assert.deepEqual(failedJson, {
    success: false,
    error: "cleanup failed",
  });
});
