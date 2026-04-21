import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const analyzerMocks = vi.hoisted(() => {
  class FakeGLMAnalyzer {
    readonly provider = "glm";
    parseSignal = vi.fn();
    parseBulkSignals = vi.fn();
    analyzePosition = vi.fn();
  }

  class FakeKimiAnalyzer {
    readonly provider = "kimi";
    parseSignal = vi.fn();
    parseBulkSignals = vi.fn();
    analyzePosition = vi.fn();
  }

  class FakeOpenAIAnalyzer {
    readonly provider = "openai";
    parseSignal = vi.fn();
    parseBulkSignals = vi.fn();
    analyzePosition = vi.fn();
  }

  class FakeCodexPatunginAnalyzer {
    readonly provider = "codex";
    parseSignal = vi.fn();
    parseBulkSignals = vi.fn();
    analyzePosition = vi.fn();
  }

  return {
    FakeGLMAnalyzer,
    FakeKimiAnalyzer,
    FakeOpenAIAnalyzer,
    FakeCodexPatunginAnalyzer,
    hasCodexPatunginCredentials: vi.fn(() => false),
  };
});

vi.mock("./GLMAnalyzer", () => ({
  GLMAnalyzer: analyzerMocks.FakeGLMAnalyzer,
}));
vi.mock("./KimiAnalyzer", () => ({
  KimiAnalyzer: analyzerMocks.FakeKimiAnalyzer,
}));
vi.mock("./OpenAIAnalyzer", () => ({
  OpenAIAnalyzer: analyzerMocks.FakeOpenAIAnalyzer,
}));
vi.mock("./CodexPatunginAnalyzer", () => ({
  CodexPatunginAnalyzer: analyzerMocks.FakeCodexPatunginAnalyzer,
}));
vi.mock("./CodexPatunginConfig", () => ({
  hasCodexPatunginCredentials: analyzerMocks.hasCodexPatunginCredentials,
}));

import { AIFactory } from "./AIFactory";

beforeEach(() => {
  AIFactory.reset();
  analyzerMocks.hasCodexPatunginCredentials.mockReset();
  analyzerMocks.hasCodexPatunginCredentials.mockReturnValue(false);
  delete process.env.AI_PROVIDER;
});

test("AIFactory uses the explicit provider and caches the instance", () => {
  const first = AIFactory.getAnalyzer("kimi") as { provider: string };
  const second = AIFactory.getAnalyzer("glm") as { provider: string };

  assert.equal(first.provider, "kimi");
  assert.strictEqual(first, second);
});

test("AIFactory falls back to env provider then patungin credentials", () => {
  process.env.AI_PROVIDER = "openai";
  const envAnalyzer = AIFactory.getAnalyzer() as { provider: string };
  assert.equal(envAnalyzer.provider, "openai");

  AIFactory.reset();
  delete process.env.AI_PROVIDER;
  analyzerMocks.hasCodexPatunginCredentials.mockReturnValue(true);

  const credsAnalyzer = AIFactory.getAnalyzer() as { provider: string };
  assert.equal(credsAnalyzer.provider, "codex");
});

test("AIFactory warns and falls back to GLM for unknown providers", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const analyzer = (AIFactory as unknown as {
    createAnalyzer(provider: string): unknown;
  }).createAnalyzer("invalid");

  assert.equal((analyzer as { provider: string }).provider, "glm");
  assert.equal(warnSpy.mock.calls.length, 1);

  warnSpy.mockRestore();
});

test("AIFactory reset clears the cached instance", () => {
  const first = AIFactory.getAnalyzer("glm");
  AIFactory.reset();
  const second = AIFactory.getAnalyzer("glm");

  assert.notStrictEqual(first, second);
});
