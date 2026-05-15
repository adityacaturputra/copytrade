import { logExecutorWarn, logProcessStep } from "../process/log";
import type { ProcessTrackedMessage } from "./types";
import {
  buildAnalysisContextErrorBlock,
  formatAnalysisContextBlock,
} from "./analysis-context-format";
import { buildAnalysisContextSnapshot } from "./analysis-context-build";

export async function buildMessageAnalysisContext(
  msg: ProcessTrackedMessage,
): Promise<string> {
  try {
    const snapshot = await buildAnalysisContextSnapshot(msg);
    return formatAnalysisContextBlock(snapshot);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || "Unknown error");

    if (msg.processId) {
      await logProcessStep({
        accountId: msg.sourceId,
        processId: msg.processId,
        type: "draft_process",
        action: "analysis_context_failed",
        details: { messageId: msg.messageId, sourceId: msg.sourceId },
        result: "failed",
        error: errorMessage,
      });
    }

    await logExecutorWarn(
      `⚠️ Failed to build live account analysis context for ${msg.messageId}: ${errorMessage}`,
      {
        accountId: msg.sourceId,
        processId: msg.processId,
        action: "console_analysis_context_failed",
      },
    );

    return buildAnalysisContextErrorBlock(errorMessage);
  }
}
