import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestMongo, clearTestMongo, stopTestMongo } from "../../../tests/helpers/mongo.ts";

const {
  parseBulkSignalsMock,
  parseSignalMock,
  preprocessImagesWithVisionMock,
  buildMessageAnalysisContextMock,
  logExecutorInfoMock,
  logExecutorWarnMock,
  logProcessStepMock,
} = vi.hoisted(() => ({
  parseBulkSignalsMock: vi.fn(),
  parseSignalMock: vi.fn(),
  preprocessImagesWithVisionMock: vi.fn(),
  buildMessageAnalysisContextMock: vi.fn(),
  logExecutorInfoMock: vi.fn(),
  logExecutorWarnMock: vi.fn(),
  logProcessStepMock: vi.fn(),
}));

vi.mock("./ai/AIFactory", () => ({
  AIFactory: {
    getAnalyzer: () => ({
      parseBulkSignals: parseBulkSignalsMock,
      parseSignal: parseSignalMock,
      analyzePosition: vi.fn(),
    }),
    reset: vi.fn(),
  },
}));

vi.mock("./ai/ImageAIFactory", () => ({
  preprocessImagesWithVision: preprocessImagesWithVisionMock,
}));

vi.mock("./executor/analysis-context", () => ({
  buildMessageAnalysisContext: buildMessageAnalysisContextMock,
}));

vi.mock("../process/log", () => ({
  logExecutorInfo: logExecutorInfoMock,
  logExecutorWarn: logExecutorWarnMock,
  logProcessStep: logProcessStepMock,
}));

import { analyzeMessagesWithAI } from "./executor/ai";
import { SignalConfig } from "../database/index";

describe("analyzeMessagesWithAI integration", () => {
  beforeAll(async () => {
    await startTestMongo();
  });

  afterAll(async () => {
    await stopTestMongo();
  });

  beforeEach(async () => {
    await clearTestMongo();
    parseBulkSignalsMock.mockReset();
    parseSignalMock.mockReset();
    preprocessImagesWithVisionMock.mockReset();
    buildMessageAnalysisContextMock.mockReset();
    logExecutorInfoMock.mockReset();
    logExecutorWarnMock.mockReset();
    logProcessStepMock.mockReset();

    buildMessageAnalysisContextMock.mockResolvedValue("LIVE_CONTEXT_BLOCK");
    preprocessImagesWithVisionMock.mockImplementation(async (content: string) => ({
      enhancedContent: `${content}\n[Vision Extracted]`,
    }));
    logExecutorInfoMock.mockResolvedValue(undefined);
    logExecutorWarnMock.mockResolvedValue(undefined);
    logProcessStepMock.mockResolvedValue(undefined);
  });

  it("reads DB signal config, enhances image messages, and forwards image URLs", async () => {
    await SignalConfig.create({
      fetchLimit: 10,
      timeWindowHours: 24,
      batchSize: 5,
      includeImageUrls: true,
    });

    parseBulkSignalsMock.mockImplementation(async (messages) =>
      messages.map((message: { messageId: string }) => ({
        messageId: message.messageId,
        signal: {
          action: "BUY",
          symbol: "BTCUSDT",
          orderType: "limit",
        },
      })),
    );

    const results = await analyzeMessagesWithAI([
      {
        messageId: "msg-1",
        channelId: "channel-1",
        author: "signal-bot",
        content: "Buy BTCUSDT limit 62000",
        imageUrls: ["https://example.com/chart.png"],
        sourceId: "acct-1",
        sourceName: "VIP Discord",
        processId: "proc-1",
      },
    ]);

    expect(preprocessImagesWithVisionMock).toHaveBeenCalledWith(
      "Buy BTCUSDT limit 62000",
      ["https://example.com/chart.png"],
    );
    expect(buildMessageAnalysisContextMock).toHaveBeenCalledTimes(1);
    expect(parseBulkSignalsMock).toHaveBeenCalledWith([
      {
        messageId: "msg-1",
        content: expect.stringContaining("[Vision Extracted]"),
        imageUrls: ["https://example.com/chart.png"],
      },
    ]);
    expect(parseBulkSignalsMock.mock.calls[0]?.[0]?.[0]?.content).toContain(
      "LIVE_CONTEXT_BLOCK",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.signal).toMatchObject({
      action: "BUY",
      symbol: "BTCUSDT",
      orderType: "limit",
    });
  });

  it("falls back to per-message parsing when bulk parsing fails", async () => {
    parseBulkSignalsMock.mockRejectedValue(new Error("bulk endpoint unavailable"));
    parseSignalMock.mockResolvedValue({
      action: "CLOSE",
      symbol: "BTCUSDT",
      messageType: "close_cancel",
    });

    const results = await analyzeMessagesWithAI([
      {
        messageId: "msg-2",
        channelId: "channel-1",
        author: "signal-bot",
        content: "Close BTCUSDT now",
        imageUrls: [],
        sourceId: "acct-1",
        sourceName: "VIP Discord",
        processId: "proc-2",
      },
    ]);

    expect(parseBulkSignalsMock).toHaveBeenCalledTimes(1);
    expect(parseSignalMock).toHaveBeenCalledWith(
      expect.stringContaining("Close BTCUSDT now"),
    );
    expect(logExecutorWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Bulk AI call failed"),
      { action: "console_bulk_ai_fallback" },
    );
    expect(results).toEqual([
      {
        messageId: "msg-2",
        signal: {
          action: "CLOSE",
          symbol: "BTCUSDT",
          messageType: "close_cancel",
        },
      },
    ]);
  });
});
