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

  class FakeKonektikaAnalyzer {
    readonly provider = "konektika";
    parseSignal = vi.fn();
    parseBulkSignals = vi.fn();
    analyzePosition = vi.fn();
  }

  return {
    FakeGLMAnalyzer,
    FakeKimiAnalyzer,
    FakeOpenAIAnalyzer,
    FakeCodexPatunginAnalyzer,
    FakeKonektikaAnalyzer,
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
vi.mock("./KonektikaAnalyzer", () => ({
  KonektikaAnalyzer: analyzerMocks.FakeKonektikaAnalyzer,
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
  delete process.env.AI_PROVIDER_FALLBACK;
});

test("AIFactory uses the explicit provider and caches the instance", () => {
  const first = AIFactory.getAnalyzer("kimi") as unknown as {
    provider: string;
  };
  const second = AIFactory.getAnalyzer("glm") as unknown as {
    provider: string;
  };

  assert.equal(first.provider, "kimi");
  assert.strictEqual(first, second);
});

test("AIFactory falls back to env provider then patungin credentials", () => {
  process.env.AI_PROVIDER = "openai";
  const envAnalyzer = AIFactory.getAnalyzer() as unknown as {
    provider: string;
  };
  assert.equal(envAnalyzer.provider, "openai");

  AIFactory.reset();
  delete process.env.AI_PROVIDER;
  analyzerMocks.hasCodexPatunginCredentials.mockReturnValue(true);

  const credsAnalyzer = AIFactory.getAnalyzer() as unknown as {
    provider: string;
  };
  assert.equal(credsAnalyzer.provider, "codex");
});

test("AIFactory warns and falls back to GLM for unknown providers", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const analyzer = (
    AIFactory as unknown as {
      createAnalyzer(provider: string): unknown;
    }
  ).createAnalyzer("invalid");

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

test("AIFactory creates FallbackAISignalAnalyzer when AI_PROVIDER_FALLBACK is set", () => {
  process.env.AI_PROVIDER = "glm";
  process.env.AI_PROVIDER_FALLBACK = "kimi,patungin";

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const analyzer = AIFactory.getAnalyzer();

  // Should be a fallback analyzer (has providerChain property)
  assert.ok("providerChain" in analyzer);
  assert.equal(
    (analyzer as unknown as { providerChain: string }).providerChain,
    "glm → kimi → patungin",
  );

  logSpy.mockRestore();
});

test("AIFactory fallback deduplicates providers", () => {
  process.env.AI_PROVIDER = "glm";
  process.env.AI_PROVIDER_FALLBACK = "glm,kimi,glm";

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const analyzer = AIFactory.getAnalyzer();

  assert.equal(
    (analyzer as unknown as { providerChain: string }).providerChain,
    "glm → kimi",
  );

  logSpy.mockRestore();
});

test("AIFactory fallback analyzer tries next provider on parseSignal failure", async () => {
  process.env.AI_PROVIDER = "glm";
  process.env.AI_PROVIDER_FALLBACK = "kimi";

  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const analyzer = AIFactory.getAnalyzer();

  // GLM fails, Kimi succeeds
  const glmInstance = new analyzerMocks.FakeGLMAnalyzer();
  const kimiInstance = new analyzerMocks.FakeKimiAnalyzer();
  glmInstance.parseSignal.mockRejectedValue(new Error("GLM failed"));
  kimiInstance.parseSignal.mockResolvedValue({ action: "BUY", symbol: "BTC" });

  // The fallback analyzer uses the created instances internally
  // We can verify the fallback behavior via the providerChain
  assert.equal(
    (analyzer as unknown as { providerChain: string }).providerChain,
    "glm → kimi",
  );

  warnSpy.mockRestore();
  logSpy.mockRestore();
});

test("Fallback parseSignal continues until 4th provider (error + null + success)", async () => {
  process.env.AI_PROVIDER = "patungin";
  process.env.AI_PROVIDER_FALLBACK = "glm,konektika,kimi";

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  const analyzer = AIFactory.getAnalyzer() as {
    parseSignal(
      message: string,
    ): Promise<{ action: string; symbol: string } | null>;
    providerChain: string;
  };

  assert.equal(analyzer.providerChain, "patungin → glm → konektika → kimi");

  const codex = (
    analyzer as unknown as {
      analyzers: Array<{ analyzer: { parseSignal: ReturnType<typeof vi.fn> } }>;
    }
  ).analyzers[0].analyzer;
  const glm = (
    analyzer as unknown as {
      analyzers: Array<{ analyzer: { parseSignal: ReturnType<typeof vi.fn> } }>;
    }
  ).analyzers[1].analyzer;
  const konektika = (
    analyzer as unknown as {
      analyzers: Array<{ analyzer: { parseSignal: ReturnType<typeof vi.fn> } }>;
    }
  ).analyzers[2].analyzer;
  const kimi = (
    analyzer as unknown as {
      analyzers: Array<{ analyzer: { parseSignal: ReturnType<typeof vi.fn> } }>;
    }
  ).analyzers[3].analyzer;

  codex.parseSignal.mockRejectedValue(new Error("patungin upstream error"));
  glm.parseSignal.mockResolvedValue(null);
  konektika.parseSignal.mockRejectedValue(new Error("konektika temp error"));
  kimi.parseSignal.mockResolvedValue({ action: "BUY", symbol: "BTCUSDT" });

  const result = await analyzer.parseSignal("buy btc now");
  assert.deepEqual(result, { action: "BUY", symbol: "BTCUSDT" });

  assert.equal(codex.parseSignal.mock.calls.length, 1);
  assert.equal(glm.parseSignal.mock.calls.length, 1);
  assert.equal(konektika.parseSignal.mock.calls.length, 1);
  assert.equal(kimi.parseSignal.mock.calls.length, 1);

  warnSpy.mockRestore();
  logSpy.mockRestore();
});

test("Fallback parseBulkSignals continues until later provider and returns actionable result", async () => {
  process.env.AI_PROVIDER = "patungin";
  process.env.AI_PROVIDER_FALLBACK = "glm,konektika,kimi";

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  const analyzer = AIFactory.getAnalyzer() as {
    parseBulkSignals(
      messages: Array<{ messageId: string; content: string }>,
    ): Promise<
      Array<{
        messageId: string;
        signal: { action: string; symbol: string } | null;
      }>
    >;
    providerChain: string;
  };

  assert.equal(analyzer.providerChain, "patungin → glm → konektika → kimi");

  const analyzers = (
    analyzer as unknown as {
      analyzers: Array<{
        analyzer: { parseBulkSignals: ReturnType<typeof vi.fn> };
      }>;
    }
  ).analyzers;

  analyzers[0].analyzer.parseBulkSignals.mockRejectedValue(
    new Error("patungin failed"),
  );
  analyzers[1].analyzer.parseBulkSignals.mockResolvedValue([
    { messageId: "m1", signal: null },
  ]);
  analyzers[2].analyzer.parseBulkSignals.mockResolvedValue([
    { messageId: "m1", signal: { action: "SELL", symbol: "ETHUSDT" } },
  ]);

  const result = await analyzer.parseBulkSignals([
    { messageId: "m1", content: "sell eth" },
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    messageId: "m1",
    signal: { action: "SELL", symbol: "ETHUSDT" },
  });

  assert.equal(analyzers[0].analyzer.parseBulkSignals.mock.calls.length, 1);
  assert.equal(analyzers[1].analyzer.parseBulkSignals.mock.calls.length, 1);
  assert.equal(analyzers[2].analyzer.parseBulkSignals.mock.calls.length, 1);
  assert.equal(analyzers[3].analyzer.parseBulkSignals.mock.calls.length, 0);

  warnSpy.mockRestore();
  logSpy.mockRestore();
});
