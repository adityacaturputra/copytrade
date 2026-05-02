import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { NextRequest } from "next/server";

const cleanupRouteMocks = vi.hoisted(() => ({
  proxyToBackend: vi.fn(),
}));

vi.mock("../../_lib/backend-proxy", () => ({
  proxyToBackend: cleanupRouteMocks.proxyToBackend,
}));

vi.mock("../../_lib/action-auth", () => ({
  verifyActionAuth: vi.fn().mockReturnValue(null),
}));

beforeEach(() => {
  cleanupRouteMocks.proxyToBackend.mockReset();
  cleanupRouteMocks.proxyToBackend.mockResolvedValue("proxied");
});

test("cleanup route proxies POST requests to backend cleanup endpoint", async () => {
  const request = { method: "POST" } as NextRequest;
  const { POST } = await import("./route");

  const response = await POST(request);

  assert.equal(response, "proxied");
  assert.deepEqual(cleanupRouteMocks.proxyToBackend.mock.calls[0], [
    request,
    "/api/logs/cleanup",
    { method: "POST" },
  ]);
});
