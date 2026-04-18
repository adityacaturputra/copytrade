import { AIFactory } from "./ai/AIFactory";
import { preprocessImagesWithVision } from "./ai/ImageAIFactory";
import type { BulkMessageInput } from "./ai/types";
import { buildMessageAnalysisContext } from "./executor-analysis-context";
import type {
  MessageAnalysisResult,
  ProcessTrackedMessage,
} from "./executor-types";
import { logExecutorInfo, logExecutorWarn, logProcessStep } from "./process-log";
import { getSignalConfig } from "./signal-config";

async function buildBulkInputForMessage(
  msg: ProcessTrackedMessage,
  signalConfig: Awaited<ReturnType<typeof getSignalConfig>>,
  accountContextCache: Map<string, Promise<string>>,
): Promise<BulkMessageInput> {
  let content = msg.originalContent || msg.content;
  const imageUrls = msg.imageUrls || [];

  if (signalConfig.visionAIEnabled && imageUrls.length > 0) {
    if (msg.processId) {
      await logProcessStep({
        accountId: msg.sourceId,
        processId: msg.processId,
        type: "draft_process",
        action: "vision_analysis_started",
        details: {
          messageId: msg.messageId,
          imageCount: imageUrls.length,
        },
        result: "processing",
      });
    }

    try {
      const { enhancedContent } = await preprocessImagesWithVision(
        content,
        imageUrls,
      );

      if (enhancedContent !== content) {
        await logExecutorInfo(
          `👁️ Vision AI enhanced message ${msg.messageId} with chart data`,
          {
            accountId: msg.sourceId,
            processId: msg.processId,
            action: "console_vision_enhanced",
          },
        );

        if (msg.processId) {
          await logProcessStep({
            accountId: msg.sourceId,
            processId: msg.processId,
            type: "draft_process",
            action: "vision_analysis_completed",
            details: {
              messageId: msg.messageId,
              imageCount: imageUrls.length,
              enhanced: true,
            },
            result: "enhanced",
          });
        }
      } else if (msg.processId) {
        await logProcessStep({
          accountId: msg.sourceId,
          processId: msg.processId,
          type: "draft_process",
          action: "vision_analysis_completed",
          details: {
            messageId: msg.messageId,
            imageCount: imageUrls.length,
            enhanced: false,
          },
          result: "unchanged",
        });
      }

      content = enhancedContent;
    } catch (visionErr) {
      const errorMessage =
        visionErr instanceof Error ? visionErr.message : String(visionErr);

      await logExecutorWarn(
        `⚠️ Vision AI failed for ${msg.messageId}, using original content: ${errorMessage}`,
        {
          accountId: msg.sourceId,
          processId: msg.processId,
          action: "console_vision_failed",
        },
      );

      if (msg.processId) {
        await logProcessStep({
          accountId: msg.sourceId,
          processId: msg.processId,
          type: "draft_process",
          action: "vision_analysis_failed",
          details: {
            messageId: msg.messageId,
            imageCount: imageUrls.length,
          },
          result: "failed",
          error: errorMessage,
        });
      }
    }
  }

  const contextKey = msg.sourceId || "__no_source__";
  let contextPromise = accountContextCache.get(contextKey);
  if (!contextPromise) {
    contextPromise = buildMessageAnalysisContext(msg);
    accountContextCache.set(contextKey, contextPromise);
  }

  const liveContextBlock = await contextPromise;
  content = `${content}\n\n${liveContextBlock}`;

  return {
    messageId: msg.messageId,
    content,
    ...(signalConfig.includeImageUrls && imageUrls.length > 0
      ? { imageUrls }
      : {}),
  };
}

export async function analyzeMessagesWithAI(
  messages: ProcessTrackedMessage[],
): Promise<MessageAnalysisResult[]> {
  if (messages.length === 0) return [];

  const signalConfig = await getSignalConfig();
  const analyzer = AIFactory.getAnalyzer();

  await Promise.all(
    messages
      .filter((msg) => msg.processId)
      .map((msg) =>
        logProcessStep({
          accountId: msg.sourceId,
          processId: msg.processId,
          type: "draft_process",
          action: "ai_analysis_started",
          details: {
            messageId: msg.messageId,
            hasImages: (msg.imageUrls || []).length > 0,
          },
          result: "processing",
        }),
      ),
  );

  const accountContextCache = new Map<string, Promise<string>>();
  const bulkInputs = await Promise.all(
    messages.map((msg) =>
      buildBulkInputForMessage(msg, signalConfig, accountContextCache),
    ),
  );

  try {
    const results = await analyzer.parseBulkSignals(bulkInputs);

    await Promise.all(
      results.map((result) => {
        const msg = messages.find((item) => item.messageId === result.messageId);
        if (!msg?.processId) return Promise.resolve();

        return logProcessStep({
          accountId: msg.sourceId,
          processId: msg.processId,
          type: "draft_process",
          action: "ai_analysis_completed",
          symbol: result.signal?.symbol,
          details: {
            messageId: result.messageId,
            action: result.signal?.action || null,
            confidence: result.signal?.confidence || null,
          },
          result: result.signal?.action || "no_signal",
        });
      }),
    );

    return results;
  } catch (bulkErr) {
    const bulkErrorMessage =
      bulkErr instanceof Error ? bulkErr.message : String(bulkErr);

    await logExecutorWarn(
      `⚠️ Bulk AI call failed, falling back to individual: ${bulkErrorMessage}`,
      {
        action: "console_bulk_ai_fallback",
      },
    );

    await Promise.all(
      messages
        .filter((msg) => msg.processId)
        .map((msg) =>
          logProcessStep({
            accountId: msg.sourceId,
            processId: msg.processId,
            type: "draft_process",
            action: "ai_analysis_bulk_fallback",
            details: {
              messageId: msg.messageId,
            },
            result: "fallback_to_individual",
            error: bulkErrorMessage,
          }),
        ),
    );

    const results: MessageAnalysisResult[] = [];
    for (let index = 0; index < bulkInputs.length; index++) {
      const input = bulkInputs[index];
      const msg = messages[index];

      try {
        const signal = await analyzer.parseSignal(input.content);
        results.push({ messageId: input.messageId, signal });

        if (msg?.processId) {
          await logProcessStep({
            accountId: msg.sourceId,
            processId: msg.processId,
            type: "draft_process",
            action: "ai_analysis_completed",
            symbol: signal?.symbol,
            details: {
              messageId: input.messageId,
              action: signal?.action || null,
              confidence: signal?.confidence || null,
              mode: "individual",
            },
            result: signal?.action || "no_signal",
          });
        }
      } catch (parseErr) {
        const parseError =
          parseErr instanceof Error
            ? parseErr.message
            : String(parseErr || "Unknown parse error");

        results.push({
          messageId: input.messageId,
          signal: null,
          parseError,
        });

        if (msg?.processId) {
          await logProcessStep({
            accountId: msg.sourceId,
            processId: msg.processId,
            type: "draft_process",
            action: "ai_analysis_failed",
            details: {
              messageId: input.messageId,
              mode: "individual",
            },
            result: "parse_failed",
            error: parseError,
          });
        }
      }
    }

    return results;
  }
}
