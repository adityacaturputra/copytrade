import { Position } from "@copytrade/shared/lib/database/index";
import { inspectPendingLimitOrder } from "@copytrade/shared/lib/monitor/pending-order-sync";
import {
  getExchangeForPosition,
  type PositionDocLike,
} from "@copytrade/shared/lib/monitor/position-sync";
import {
  logExecutorError,
  logExecutorInfo,
  logExecutorWarn,
  logProcessStep,
} from "@copytrade/shared/lib/process/log";
import { getHttpErrorDetails } from "@copytrade/shared/lib/http/error";
import { ensurePersistedProcessId } from "@copytrade/shared/lib/process/id";

export async function syncPendingPositions(
  result: { actions: number; errors: string[]; syncedClosed: number },
  getErrorMessage: (error: unknown) => string,
) {
  const pendingPositions = (await Position.find({ status: "pending" })) as PositionDocLike[];
  if (pendingPositions.length === 0) {
    return;
  }

  await logExecutorInfo(
    `⏳ Position monitor agent checking ${pendingPositions.length} pending positions`,
    {
      type: "monitor",
      action: "pending_positions_check",
      level: "debug",
    },
  );

  for (const position of pendingPositions) {
    const processId = await ensurePersistedProcessId(position, "pendmon");

    try {
      const exchange = await getExchangeForPosition(position);
      const inspection = await inspectPendingLimitOrder(exchange, position);

      if (inspection.type === "live") continue;

      if (inspection.type === "cancelled") {
        position.status = "closed";
        position.closedAt = new Date();
        position.closeReason = inspection.reason;
        await position.save();
        result.syncedClosed++;
        continue;
      }

      position.status = "open";
      if (inspection.fillPrice && inspection.fillPrice > 0) {
        position.entryPrice = inspection.fillPrice;
      }
      await position.save();
      result.actions++;

      await logProcessStep({
        accountId: position.accountId,
        processId,
        type: "monitor",
        action: "limit_filled",
        symbol: position.symbol,
        details: `Limit order filled on exchange. Promoted to open. Fill price: ${position.entryPrice}. ${inspection.reason}`,
        result: "success",
      });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      const httpDetails = getHttpErrorDetails(error);
      const responseSuffix = httpDetails.responseBody
        ? ` | response=${httpDetails.responseBody}`
        : "";
      result.errors.push(`Pending ${position.symbol}: ${errMsg}`);
      await logExecutorError(
        `Error checking pending position ${position.symbol}: ${errMsg}${responseSuffix}`,
        {
          accountId: position.accountId,
          processId,
          symbol: position.symbol,
          type: "monitor",
          action: "pending_position_check_error",
        },
      );
    }
  }
}


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
