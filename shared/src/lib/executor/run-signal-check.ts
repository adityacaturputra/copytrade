import { connectDB, getTradingMode } from "../database/index";
import { getSignalConfig } from "../signal/config";
import { logExecutorError, logExecutorInfo } from "../process/log";
import {
  fetchMessagesForActiveAccounts,
  loadProcessedMessages,
  processTrackedMessages,
} from "./run-signal-check-helpers";
import type { ProcessTrackedMessage } from "./types";

export async function runSignalCheck(): Promise<{
  checked: number;
  newSignals: number;
  executed: number;
  drafted: number;
  errors: string[];
  sources: { name: string; channels: number; healthy: boolean }[];
}> {
  await connectDB();

  const result = {
    checked: 0,
    newSignals: 0,
    executed: 0,
    drafted: 0,
    errors: [] as string[],
    sources: [] as { name: string; channels: number; healthy: boolean }[],
  };

  try {
    const mode = await getTradingMode();
    await logExecutorInfo(`🔧 Trading mode: ${mode}`, { level: "debug" });

    const signalConfig = await getSignalConfig();
    await logExecutorInfo(
      `🔧 Signal config: pageSize=${signalConfig.fetchLimit}, timeWindowHours=${signalConfig.timeWindowHours}`,
      { level: "debug" },
    );

    const { processedByAccount, allProcessedIds } = await loadProcessedMessages();
    await logExecutorInfo(
      `📦 Found ${allProcessedIds.size} previously processed messages in DB (${processedByAccount.size} accounts)`,
      { level: "debug" },
    );

    const allMessages = await fetchMessagesForActiveAccounts({
      processedByAccount,
      fetchLimit: signalConfig.fetchLimit,
      timeWindowHours: signalConfig.timeWindowHours,
      result,
    });

    const trackedMessages = allMessages
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((message) => ({ ...message, processId: undefined })) as ProcessTrackedMessage[];

    await processTrackedMessages({ messages: trackedMessages, mode, result });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`General: ${errMsg}`);
    await logExecutorError(`Signal check error: ${errMsg}`, {
      action: "console_signal_check_error",
    });
  }

  await logExecutorInfo(
    `✅ Signal check complete: ${result.checked} checked, ${result.newSignals} signals, ${result.executed} executed, ${result.drafted} drafted`,
    { level: "debug" },
  );
  return result;
}
