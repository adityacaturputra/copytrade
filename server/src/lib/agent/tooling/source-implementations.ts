import { SourceType } from "@copytrade/shared/lib/enums";
import type { ToolExecutor } from "./shared";
import {
  buildSourceSummary,
  getBackendBaseUrl,
  getAccountIdFromArgs,
  getSourceContextForAccount,
  loadSourceAccounts,
  normalizePositiveNumber,
  normalizeSourceType,
  serializeSourceMessages,
} from "./shared";

async function checkSourceHealthImpl(args: Record<string, unknown>) {
  const sourceAccounts = await loadSourceAccounts(args);

  if (sourceAccounts.length === 0) {
    const requestedAccountId = getAccountIdFromArgs(args);
    const requestedSourceType = normalizeSourceType(args.sourceType);

    return JSON.stringify({
      success: false,
      error: requestedAccountId
        ? `Source account not found: ${requestedAccountId}`
        : requestedSourceType
          ? `No ${requestedSourceType} source accounts found`
          : "No source accounts found",
    });
  }

  const results = [];

  for (const account of sourceAccounts) {
    const ctx = getSourceContextForAccount(account);
    const health = await ctx.provider.checkHealth(ctx.config);
    results.push({
      accountId: ctx.accountId,
      name: ctx.accountName,
      sourceType: ctx.sourceType,
      health,
    });
  }

  return JSON.stringify({
    success: true,
    checked: results.length,
    results,
  });
}

export const sourceToolImplementations: Record<string, ToolExecutor> = {
  get_signal_sources: async (args) => {
    const sourceAccounts = await loadSourceAccounts(args);
    return JSON.stringify(sourceAccounts.map(buildSourceSummary));
  },

  check_source_health: async (args) => checkSourceHealthImpl(args),

  fetch_source_messages: async (args) => {
    const sourceAccounts = await loadSourceAccounts(args, { activeOnly: true });
    const fetchLimit = normalizePositiveNumber(args.fetchLimit, 10, 50);
    const timeWindowHours =
      typeof args.timeWindowHours === "number" && args.timeWindowHours > 0
        ? args.timeWindowHours
        : undefined;

    if (sourceAccounts.length === 0) {
      const requestedAccountId = getAccountIdFromArgs(args);
      const requestedSourceType = normalizeSourceType(args.sourceType);

      return JSON.stringify({
        success: false,
        error: requestedAccountId
          ? `Active source account not found: ${requestedAccountId}`
          : requestedSourceType
            ? `No active ${requestedSourceType} source accounts found`
            : "No active source accounts found",
      });
    }

    const results = [];

    for (const account of sourceAccounts) {
      const ctx = getSourceContextForAccount(account);

      try {
        const messages = await ctx.provider.fetchMessages(
          ctx.config,
          fetchLimit,
          timeWindowHours,
        );

        results.push({
          accountId: ctx.accountId,
          name: ctx.accountName,
          sourceType: ctx.sourceType,
          fetched: messages.length,
          messages: serializeSourceMessages(messages),
        });
      } catch (error) {
        results.push({
          accountId: ctx.accountId,
          name: ctx.accountName,
          sourceType: ctx.sourceType,
          fetched: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return JSON.stringify({
      success: true,
      checked: results.length,
      fetchLimit,
      timeWindowHours: timeWindowHours || null,
      results,
    });
  },

  get_discord_sources: async () => {
    const sourceAccounts = await loadSourceAccounts(
      { sourceType: SourceType.DISCORD },
      { fallbackSourceType: SourceType.DISCORD },
    );
    return JSON.stringify(sourceAccounts.map(buildSourceSummary));
  },

  check_signal_now: async () => {
    const baseUrl = getBackendBaseUrl();
    const cronSecret = process.env.CRON_SECRET?.trim();
    const headers: Record<string, string> = {};
    if (cronSecret) {
      headers.authorization = `Bearer ${cronSecret}`;
    }
    const res = await fetch(`${baseUrl}/api/cron/signal-check`, {
      method: "POST",
      headers,
    });
    const data = await res.json();
    return JSON.stringify(data);
  },

  get_telegram_sources: async () => {
    const sourceAccounts = await loadSourceAccounts(
      { sourceType: SourceType.TELEGRAM },
      { fallbackSourceType: SourceType.TELEGRAM },
    );
    return JSON.stringify(sourceAccounts.map(buildSourceSummary));
  },

  check_telegram_source_health: async (args) =>
    checkSourceHealthImpl({
      ...args,
      sourceType: SourceType.TELEGRAM,
    }),
};
