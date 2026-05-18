import { Position } from "@copytrade/shared/lib/database/index";
import {
  type PositionDocLike,
} from "@copytrade/shared/lib/monitor/position-sync";
import {
  logExecutorWarn,
} from "@copytrade/shared/lib/process/log";

export async function cleanupOrphanProtectionForAccounts(
  positions: PositionDocLike[],
  result: { actions: number; errors: string[] },
  cleanupOrphanProtectionOrders: (args: {
    accountId: string;
    dryRun: boolean;
  }) => Promise<string>,
  getErrorMessage: (error: unknown) => string,
) {
  const uniqueAccountIds = [
    ...new Set(
      positions
        .map((position) => position.accountId)
        .filter((accountId): accountId is string => Boolean(accountId)),
    ),
  ];

  for (const accountId of uniqueAccountIds) {
    try {
      const raw = await cleanupOrphanProtectionOrders({
        accountId,
        dryRun: false,
      });
      const parsed = JSON.parse(raw) as {
        cleanupResults?: Array<{ cancelled?: string[] }>;
      };
      const cancelledCount =
        parsed.cleanupResults?.reduce(
          (sum, item) => sum + (item.cancelled?.length || 0),
          0,
        ) || 0;
      result.actions += cancelledCount;
    } catch (error) {
      result.errors.push(`Cleanup ${accountId}: ${getErrorMessage(error)}`);
    }
  }
}
