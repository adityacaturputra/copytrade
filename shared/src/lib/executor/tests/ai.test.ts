import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  parseBulkSignals: vi.fn(),
  parseSignal: vi.fn(),
  preprocessImagesWithVision: vi.fn(),
  buildMessageAnalysisContext: vi.fn(),
  buildNearbySourceContext: vi.fn(),
  logExecutorInfo: vi.fn(),
  logExecutorWarn: vi.fn(),
  logProcessStep: vi.fn(),
  getSignalConfig: vi.fn(),
}));

vi.mock("./ai/AIFactory", () => ({
  AIFactory: {
    getAnalyzer: () => ({
      parseBulkSignals: aiMocks.parseBulkSignals,
      parseSignal: aiMocks.parseSignal,
    }),
  },
}));

vi.mock("./ai/ImageAIFactory", () => ({
  preprocessImagesWithVision: aiMocks.preprocessImagesWithVision,
}));

vi.mock("./executor/analysis-context", () => ({
  buildMessageAnalysisContext: aiMocks.buildMessageAnalysisContext,
}));

vi.mock("./executor/source-context", () => ({
  buildNearbySourceContext: aiMocks.buildNearbySourceContext,
}));

vi.mock("../process/log", () => ({
  logExecutorInfo: aiMocks.logExecutorInfo,
  logExecutorWarn: aiMocks.logExecutorWarn,
  logProcessStep: aiMocks.logProcessStep,
}));

vi.mock("../signal/config", () => ({
  getSignalConfig: aiMocks.getSignalConfig,
}));

import { analyzeMessagesWithAI } from "./executor/ai";

beforeEach(() => {
  aiMocks.parseBulkSignals.mockReset();
  aiMocks.parseSignal.mockReset();
  aiMocks.preprocessImagesWithVision.mockReset();
  aiMocks.buildMessageAnalysisContext.mockReset();
  aiMocks.buildNearbySourceContext.mockReset();
  aiMocks.logExecutorInfo.mockReset();
  aiMocks.logExecutorWarn.mockReset();
  aiMocks.logProcessStep.mockReset();
  aiMocks.getSignalConfig.mockReset();

  aiMocks.getSignalConfig.mockResolvedValue({
    includeImageUrls: true,
  });
  aiMocks.buildMessageAnalysisContext.mockResolvedValue("LIVE_CONTEXT");
  aiMocks.buildNearbySourceContext.mockResolvedValue("");
  aiMocks.logExecutorInfo.mockResolvedValue(undefined);
  aiMocks.logExecutorWarn.mockResolvedValue(undefined);
  aiMocks.logProcessStep.mockResolvedValue(undefined);
});

test("analyzeMessagesWithAI returns early for empty inputs", async () => {
  const results = await analyzeMessagesWithAI([]);

  assert.deepEqual(results, []);
  assert.equal(aiMocks.getSignalConfig.mock.calls.length, 0);
});

test("analyzeMessagesWithAI reuses account context, handles unchanged vision content, and omits imageUrls when disabled", async () => {
  aiMocks.getSignalConfig.mockResolvedValue({
    includeImageUrls: false,
  });
  aiMocks.preprocessImagesWithVision.mockImplementation(async (content: string) => ({
    enhancedContent: content,
  }));
  aiMocks.parseBulkSignals.mockResolvedValue([
    {
      messageId: "msg-1",
      signal: { action: "BUY", symbol: "BTCUSDT", confidence: 0.8 },
    },
    {
      messageId: "msg-2",
      signal: { action: null, symbol: null, confidence: null },
    },
  ]);

  const results = await analyzeMessagesWithAI([
    {
      messageId: "msg-1",
      channelId: "chan-1",
      author: "Trader",
      content: "buy btc",
      imageUrls: ["https://img/1"],
      sourceId: "acc-1",
      processId: "proc-1",
    },
    {
      messageId: "msg-2",
      channelId: "chan-1",
      author: "Trader",
      content: "hold",
      imageUrls: [],
      sourceId: "acc-1",
    },
  ] as never);

  assert.equal(aiMocks.preprocessImagesWithVision.mock.calls.length, 1);
  assert.equal(aiMocks.buildMessageAnalysisContext.mock.calls.length, 1);
  assert.deepEqual(aiMocks.parseBulkSignals.mock.calls[0]?.[0], [
    {
      messageId: "msg-1",
      content: "buy btc\n\nLIVE_CONTEXT",
    },
    {
      messageId: "msg-2",
      content: "hold\n\nLIVE_CONTEXT",
    },
  ]);
  assert.deepEqual(results, [
    {
      messageId: "msg-1",
      signal: { action: "BUY", symbol: "BTCUSDT", confidence: 0.8 },
    },
    {
      messageId: "msg-2",
      signal: { action: null, symbol: null, confidence: null },
    },
  ]);
});

test("analyzeMessagesWithAI appends nearby source messages when available", async () => {
  aiMocks.buildNearbySourceContext.mockResolvedValueOnce(
    "[NEARBY SOURCE MESSAGES]\n- nearby_before 8s | content=caption text\n[END NEARBY SOURCE MESSAGES]",
  );
  aiMocks.parseBulkSignals.mockResolvedValue([
    {
      messageId: "msg-nearby",
      signal: { action: "BUY", symbol: "ETHUSDT", confidence: 0.7 },
    },
  ]);

  await analyzeMessagesWithAI([
    {
      messageId: "msg-nearby",
      channelId: "chan-nearby",
      author: "Trader",
      content: "entry signal",
      imageUrls: [],
      sourceId: "acc-nearby",
      processId: "proc-nearby",
    },
  ] as never);

  assert.deepEqual(aiMocks.parseBulkSignals.mock.calls[0]?.[0], [
    {
      messageId: "msg-nearby",
      content:
        "entry signal\n\n[NEARBY SOURCE MESSAGES]\n- nearby_before 8s | content=caption text\n[END NEARBY SOURCE MESSAGES]\n\nLIVE_CONTEXT",
    },
  ]);
});

test("analyzeMessagesWithAI falls back to per-message parsing and records vision and parse failures", async () => {
  aiMocks.getSignalConfig.mockResolvedValue({
    includeImageUrls: true,
  });
  aiMocks.preprocessImagesWithVision
    .mockRejectedValueOnce("vision boom")
    .mockResolvedValueOnce({ enhancedContent: "second enhanced" });
  aiMocks.buildMessageAnalysisContext
    .mockResolvedValueOnce("CTX_ONE")
    .mockResolvedValueOnce("CTX_TWO");
  aiMocks.parseBulkSignals.mockRejectedValue(new Error("bulk offline"));
  aiMocks.parseSignal
    .mockResolvedValueOnce({ action: "CLOSE", symbol: "BTCUSDT", confidence: 0.6 })
    .mockRejectedValueOnce(undefined);

  const results = await analyzeMessagesWithAI([
    {
      messageId: "msg-3",
      channelId: "chan-2",
      author: "Trader",
      content: "close btc",
      imageUrls: ["https://img/2"],
      sourceId: "acc-2",
      processId: "proc-3",
    },
    {
      messageId: "msg-4",
      channelId: "chan-3",
      author: "Trader",
      content: "second",
      imageUrls: ["https://img/3"],
      sourceId: "acc-3",
      processId: "proc-4",
    },
  ] as never);

  assert.deepEqual(aiMocks.parseBulkSignals.mock.calls[0]?.[0], [
    {
      messageId: "msg-3",
      content: "close btc\n\nCTX_ONE",
      imageUrls: ["https://img/2"],
    },
    {
      messageId: "msg-4",
      content: "second enhanced\n\nCTX_TWO",
      imageUrls: ["https://img/3"],
    },
  ]);
  assert.deepEqual(results, [
    {
      messageId: "msg-3",
      signal: { action: "CLOSE", symbol: "BTCUSDT", confidence: 0.6 },
    },
    {
      messageId: "msg-4",
      signal: null,
      parseError: "Unknown parse error",
    },
  ]);
  assert.equal(aiMocks.logExecutorWarn.mock.calls.length, 2);
  assert.match(String(aiMocks.logExecutorWarn.mock.calls[0]?.[0]), /Vision AI failed/);
  assert.match(String(aiMocks.logExecutorWarn.mock.calls[1]?.[0]), /Bulk AI call failed/);
});

test("analyzeMessagesWithAI records Error parse messages during individual fallback", async () => {
  aiMocks.parseBulkSignals.mockRejectedValue(new Error("bulk offline"));
  aiMocks.buildMessageAnalysisContext.mockResolvedValueOnce("CTX_ERROR");
  aiMocks.parseSignal.mockRejectedValueOnce(new Error("parse exploded"));

  const results = await analyzeMessagesWithAI([
    {
      messageId: "msg-err",
      channelId: "chan-err",
      author: "Trader",
      content: "bad parse",
      imageUrls: [],
      sourceId: "acc-err",
      processId: "proc-err",
    },
  ] as never);

  assert.deepEqual(results, [
    {
      messageId: "msg-err",
      signal: null,
      parseError: "parse exploded",
    },
  ]);
});
