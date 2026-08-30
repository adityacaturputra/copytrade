import {
  Position,
  connectDB,
  type IPosition,
} from "@copytrade/shared/lib/database/index";
import { getSignalConfig } from "@copytrade/shared/lib/signal/config";
import {
  logExecutorError,
  logExecutorInfo,
} from "@copytrade/shared/lib/process/log";
import { createTradeLog } from "@copytrade/shared/lib/trade-log/store";
import { toolImplementations } from "./tools";
import {
  getAccountPositionKey,
  getErrorMessage,
} from "./position-monitor-agent/helpers";
import {
  cleanupOrphanProtectionForAccounts,
} from "./position-monitor-agent/sync";
import { runPositionAgentForDoc } from "./position-monitor-agent/runtime";

type PositionDocLike = IPosition;

export async function runPositionMonitorAgent(): Promise<{
  checked: number;
  actions: number;
  errors: string[];
  syncedClosed: number;
}> {
  await connectDB();

  const result = {
    checked: 0,
    actions: 0,
    errors: [] as string[],
    syncedClosed: 0,
  };

  try {
    const initialOpenPositions = (await Position.find({
      status: "open",
    })) as PositionDocLike[];
    result.checked = initialOpenPositions.length;

    if (initialOpenPositions.length === 0) {
      return result;
    }

    await logExecutorInfo(
      `🤖 Monitoring ${initialOpenPositions.length} open positions with autonomous agent`,
      {
        type: "monitor",
        action: "monitor_started",
        level: "debug",
      },
    );

    const activePositions = (await Position.find({
      status: "open",
    })) as PositionDocLike[];
    await cleanupOrphanProtectionForAccounts(
      activePositions,
      result,
      toolImplementations.cleanup_orphan_protection_orders,
      getErrorMessage,
    );

    // Read DB settings for vision image support in position monitor
    const signalCfg = await getSignalConfig();
    const visionImagesEnabled = signalCfg.monitorVisionImages;

    for (const position of activePositions) {
      try {
        const agentResult = await runPositionAgentForDoc(
          position,
          visionImagesEnabled,
        );
        const mutatingActions = agentResult.toolTraces.filter(
          (trace) => trace.mode === "mutating" && trace.status === "executed",
        ).length;
        const readActions = agentResult.toolTraces.filter(
          (trace) => trace.mode === "read" && trace.status === "executed",
        ).length;
        const failedActions = agentResult.toolTraces.filter(
          (trace) => trace.status === "failed",
        ).length;

        // Parse the agent's final decision for logging
        let decisionSummary = "unknown";
        let agentStatus = "unknown";
        try {
          const parsed = JSON.parse(agentResult.response);
          decisionSummary = parsed.decisionSummary || decisionSummary;
          agentStatus = parsed.status || agentStatus;
        } catch {
          // use defaults
        }

        console.log(
          `[PositionMonitor] 📋 ${position.symbol} ${position.side} agent done: status=${agentStatus}, tools=[${readActions} read, ${mutatingActions} mutate${failedActions > 0 ? `, ${failedActions} failed` : ""}], iterations=${agentResult.iterations}, decision="${decisionSummary}"`,
        );

        const toolSummary = agentResult.toolTraces
          .map((t) => `${t.toolName}:${t.status}`)
          .join(", ");

        await createTradeLog({
          accountId: position.accountId,
          processId: `posagent-${position.symbol}`,
          type: "position_monitor",
          action: "agent_decision",
          symbol: position.symbol,
          details: `${position.side} ${position.symbol} agent: status=${agentStatus}, iterations=${agentResult.iterations}, tools=[${toolSummary}], decision="${decisionSummary}"`,
          level: "info",
          result: agentStatus,
        }).catch(() => {});

        result.actions += mutatingActions;
      } catch (error) {
        const errMsg = getErrorMessage(error);
        result.errors.push(`${position.symbol}: ${errMsg}`);

        await createTradeLog({
          accountId: position.accountId,
          type: "position_monitor",
          action: "agent_error",
          symbol: position.symbol,
          details: `${position.side} ${position.symbol} agent failed: ${errMsg}`,
          level: "error",
          result: "error",
          error: errMsg,
        }).catch(() => {});

        await logExecutorError(
          `Position monitor agent failed for ${position.symbol}: ${errMsg}`,
          {
            accountId: position.accountId,
            symbol: position.symbol,
            type: "monitor",
            action: "position_monitor_agent_error",
          },
        );
      }
    }
  } catch (error) {
    const errMsg = getErrorMessage(error);
    result.errors.push(errMsg);
    await logExecutorError(`Position monitor agent error: ${errMsg}`, {
      type: "monitor",
      action: "monitor_error",
    });
  }

  console.log(
    `[PositionMonitor] ✅ Summary: checked=${result.checked}, syncedClosed=${result.syncedClosed}, actions=${result.actions}, errors=${result.errors.length}${result.errors.length > 0 ? ` [${result.errors.join(", ")}]` : ""}`,
  );

  await createTradeLog({
    type: "position_monitor",
    action: "monitor_summary",
    details: `checked=${result.checked}, syncedClosed=${result.syncedClosed}, actions=${result.actions}, errors=${result.errors.length}${result.errors.length > 0 ? ` [${result.errors.join(", ")}]` : ""}`,
    level: "info",
    result: result.errors.length > 0 ? "partial" : "success",
  }).catch(() => {});

  return result;
}
