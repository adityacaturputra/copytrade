import {
  Account,
  DraftTrade,
  Position,
  ProcessedMessage,
} from "@copytrade/shared/lib/database/index";
import { logProcessStep } from "@copytrade/shared/lib/process/log";
import { DiscordSourceProvider } from "@copytrade/shared/lib/source/DiscordSourceProvider";
import { SourceType } from "@copytrade/shared/lib/enums/index";
import { getProcessTradeLogs } from "@copytrade/shared/lib/trade-log/store";
import type { ToolExecutor } from "../shared";
import {
  type AccountRecord,
  getAccountIdFromArgs,
  getSourceContextForAccount,
  normalizePositiveNumber,
  normalizeSortOrder,
  normalizeSourceType,
  parseOptionalString,
  serializeSourceMessages,
} from "../shared";

import { analyzePositionContext } from "./actions/analyze";
import { getPositionProtection } from "./actions/protection";
import { managePosition } from "./actions/manage";
import { syncPositionWithExchange } from "./actions/sync";

export const positionOpsToolImplementations: Record<string, ToolExecutor> = {
  analyze_position_context: analyzePositionContext,
  get_position_protection: getPositionProtection,
  sync_position_with_exchange: syncPositionWithExchange,
  manage_position: managePosition,

  get_process_logs: async (args) => {
    const processId = parseOptionalString(args.processId);
    if (!processId) throw new Error("get_process_logs requires processId");
    const limit = normalizePositiveNumber(args.limit, 50, 200);
    const order = normalizeSortOrder(args.order);
    const logs = await getProcessTradeLogs({ processId, limit, order });
    return JSON.stringify({ success: true, processId, count: logs.length, order, logs });
  },

  review_signal_thread: async (args) => {
    const accountId = getAccountIdFromArgs(args);
    const messageId = parseOptionalString(args.messageId);
    const channelId = parseOptionalString(args.channelId);
    const positionIdArg = parseOptionalString(args.positionId);
    const processIdArg = parseOptionalString(args.processId);
    const limit = normalizePositiveNumber(args.limit, 10, 50);

    const position = positionIdArg ? await Position.findById(positionIdArg).lean().exec() : null;
    const drafts = await DraftTrade.find({ $or: [{ positionId: positionIdArg }, { processId: processIdArg }] }).lean().exec();
    const processedMessages = await ProcessedMessage.find({ $or: [{ messageId }, { processId: processIdArg }] }).lean().exec();
    const linkedPositions = await Position.find({ $or: [{ messageId }, { processId: processIdArg }] }).lean().exec();

    const inferredProcessId = processIdArg || position?.processId || processedMessages.find((item) => item.processId)?.processId || drafts.find((item) => item.processId)?.processId;
    const processLogs = inferredProcessId ? await getProcessTradeLogs({ processId: inferredProcessId as string, limit, order: "asc" }) : [];

    let sourceContextMessages: any[] = [];
    if (accountId && messageId && channelId) {
      const account = await Account.findById(accountId).lean().exec() as AccountRecord | null;
      if (account && normalizeSourceType(account.sourceType) === SourceType.DISCORD) {
        try {
          const sourceCtx = getSourceContextForAccount(account);
          const messages = await new DiscordSourceProvider().fetchMessageContext(sourceCtx.config, channelId, messageId, limit);
          sourceContextMessages = serializeSourceMessages(messages);
        } catch (error) {
          sourceContextMessages = [{ error: error instanceof Error ? error.message : String(error) }];
        }
      }
    }
    return JSON.stringify({ success: true, anchor: { positionId: position ? String(position._id) : positionIdArg || null, accountId: accountId || null, messageId: messageId || null, processId: inferredProcessId || null }, position: position || null, sourceContextMessages, processedMessages, drafts, linkedPositions, processLogs });
  },

  cleanup_orphan_protection_orders: async (args) => {
    // This tool is usually imported or implemented in a specific shared lib
    // For now keeping a placeholder or using toolImplementations if available
    return JSON.stringify({ success: false, error: "Tool cleanup_orphan_protection_orders not yet implemented in this module" });
  },

  adjust_position_protection: async (args) => {
    return JSON.stringify({ success: false, error: "Tool adjust_position_protection is being refactored into its own module" });
  },
};
