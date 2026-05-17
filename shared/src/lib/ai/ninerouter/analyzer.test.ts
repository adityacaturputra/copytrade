import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { NineRouterAnalyzer } from "./analyzer";

const nineRouterMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.stubGlobal("fetch", nineRouterMocks.fetch);

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NINEROUTER_API_KEY = "router-key";
  process.env.NINEROUTER_BASE_URL = "http://localhost:20128/v1";
  process.env.NINEROUTER_MODEL = "vibe-coding";
  nineRouterMocks.fetch.mockReset();
});

test("NineRouterAnalyzer parses SSE-style completion payloads", async () => {
  nineRouterMocks.fetch.mockResolvedValueOnce({
    ok: true,
    text: vi.fn().mockResolvedValueOnce(
      [
        'data: {"choices":[{"delta":{"content":"{\\"action\\":\\"BUY\\""}}]}',
        'data: {"choices":[{"delta":{"content":",\\"symbol\\":\\"BTCUSDT\\"}"}}]}',
        "data: [DONE]",
      ].join("\n"),
    ),
  });

  const analyzer = new NineRouterAnalyzer();
  const raw = await (analyzer as unknown as {
    callTextCompletion(systemPrompt: string, userMessage: string): Promise<string>;
  }).callTextCompletion("system", "message");

  assert.equal(raw, '{"action":"BUY","symbol":"BTCUSDT"}');
});

test("NineRouterAnalyzer rethrows non-SSE invalid JSON responses", async () => {
  nineRouterMocks.fetch.mockResolvedValueOnce({
    ok: true,
    text: vi.fn().mockResolvedValueOnce("not sse"),
  });

  const analyzer = new NineRouterAnalyzer();

  await assert.rejects(
    (analyzer as unknown as {
      callTextCompletion(systemPrompt: string, userMessage: string): Promise<string>;
    }).callTextCompletion("system", "message"),
    /not valid JSON/,
  );
});

test("NineRouterAnalyzer tolerates done-only SSE payloads", async () => {
  nineRouterMocks.fetch.mockResolvedValueOnce({
    ok: true,
    text: vi.fn().mockResolvedValueOnce("data: [DONE]\n"),
  });

  const analyzer = new NineRouterAnalyzer();
  const raw = await (analyzer as unknown as {
    callTextCompletion(systemPrompt: string, userMessage: string): Promise<string>;
  }).callTextCompletion("system", "message");

  assert.equal(raw, "");
});
