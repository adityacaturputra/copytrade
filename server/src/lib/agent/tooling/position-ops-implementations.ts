import {
  Account,
  DraftTrade,
  Position,
  ProcessedMessage,
} from "@copytrade/shared/lib/database";
import { AIFactory } from "@copytrade/shared/lib/ai/AIFactory";
import { buildPositionAnalysisInput } from "@copytrade/shared/lib/ai/PositionMonitorContext";
import { logProcessStep } from "@copytrade/shared/lib/process-log";
import {
  ensurePersistedProcessId,
  getResolvedProcessId,
} from "@copytrade/shared/lib/process-id";
import { DiscordSourceProvider } from "@copytrade/shared/lib/source/DiscordSourceProvider";
import { SourceType } from "@copytrade/shared/lib/enums";
import { getProcessTradeLogs } from "@copytrade/shared/lib/trade-log-store";
import type { ToolExecutor } from "./shared";
import {
  cancelAlgoOrdersByTypes,
  type AccountRecord,
  findPositionRecord,
  getAccountIdFromArgs,
  getLivePositionSnapshot,
  getSourceContextForAccount,
  normalizePositiveNumber,
  normalizeSortOrder,
  normalizeSourceType,
  parseOptionalString,
  roundPrice,
  serializeSourceMessages,
  toClosingSide,
  type PositionRecord,
} from "./shared";

export const positionOpsToolImplementations: Record<string, ToolExecutor> = {
  analyze_position_context: async (args) => {
    const position = await findPositionRecord(args);
    const positionDoc = await Position.findById(String(position._id)).exec();
    const processId = positionDoc
      ? await ensurePersistedProcessId(positionDoc, "agentpos")
      : getResolvedProcessId(position.processId, "agentpos");
    const { currentPrice, pnlPercent, exchangePosition } =
      await getLivePositionSnapshot(position);
    const aiInput = await buildPositionAnalysisInput(
      position,
      currentPrice,
      pnlPercent,
      processId,
    );
    const analysis = await AIFactory.getAnalyzer().analyzePosition(aiInput);

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "agent_tool",
      action: "analyze_position_context",
      symbol: position.symbol,
      details: {
        positionId: String(position._id),
        currentPrice,
        pnlPercent,
        decision: analysis.decision,
        confidence: analysis.confidence,
      },
      result: "success",
    });

    return JSON.stringify({
      success: true,
      processId,
      positionId: String(position._id),
      symbol: position.symbol,
      accountId: position.accountId || null,
      liveSnapshot: {
        currentPrice,
        pnlPercent,
        exchangePosition,
      },
      aiInput,
      analysis,
    });
  },

  manage_position: async (args) => {
    const position = await findPositionRecord(args);
    const positionDoc = await Position.findById(String(position._id)).exec();
    if (!positionDoc) {
      throw new Error(`Position document not found: ${String(position._id)}`);
    }

    const action = parseOptionalString(args.action);
    if (!action) {
      throw new Error("manage_position requires an action");
    }

    const processId = await ensurePersistedProcessId(positionDoc, "agentmgr");
    const { exchange, currentPrice, exchangePosition } =
      await getLivePositionSnapshot(position);
    const exchangePositionId = exchangePosition?.positionId;

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "agent_tool",
      action: "manage_position_started",
      symbol: position.symbol,
      details: {
        positionId: String(position._id),
        requestedAction: action,
        currentPrice,
      },
      result: "processing",
    });

    let response: Record<string, unknown> | null = null;
    const applyStopLossUpdate = async (
      targetStopLoss: number,
      actionName: string,
    ) => {
      const roundedStopLoss = roundPrice(targetStopLoss);
      const quantity = position.quantity;
      const closingSide = toClosingSide(position.side);

      await cancelAlgoOrdersByTypes(exchange, position.symbol, ["sl"]);
      const orderId = await exchange.placeStopLoss(
        position.symbol,
        roundedStopLoss,
        roundedStopLoss,
        closingSide,
        quantity,
      );

      positionDoc.stopLossPrice = roundedStopLoss;
      await positionDoc.save();

      response = {
        success: true,
        processId,
        action: actionName,
        positionId: String(position._id),
        symbol: position.symbol,
        stopLossPrice: roundedStopLoss,
        orderId,
      };
    };

    switch (action) {
      case "close": {
        await exchange.closePosition(
          position.symbol,
          exchangePositionId,
          position.quantity,
        );
        positionDoc.status = "closed";
        positionDoc.closedAt = new Date();
        positionDoc.closeReason = "Closed by agent manage_position tool";
        positionDoc.currentPrice = currentPrice;
        await positionDoc.save();

        response = {
          success: true,
          processId,
          action,
          positionId: String(position._id),
          symbol: position.symbol,
          currentPrice,
          status: "closed",
        };
        break;
      }

      case "partial_close": {
        const requestedQuantity =
          typeof args.quantity === "number" && args.quantity > 0
            ? args.quantity
            : position.quantity / 2;
        const closeQuantity = Math.min(requestedQuantity, position.quantity);

        await exchange.closePosition(
          position.symbol,
          exchangePositionId,
          closeQuantity,
        );

        const remainingQuantity = Math.max(position.quantity - closeQuantity, 0);
        positionDoc.quantity = remainingQuantity;
        positionDoc.currentPrice = currentPrice;
        if (remainingQuantity === 0) {
          positionDoc.status = "closed";
          positionDoc.closedAt = new Date();
          positionDoc.closeReason = "Fully closed by partial_close agent action";
        }
        await positionDoc.save();

        response = {
          success: true,
          processId,
          action,
          positionId: String(position._id),
          symbol: position.symbol,
          closedQuantity: closeQuantity,
          remainingQuantity,
          currentPrice,
          status: remainingQuantity === 0 ? "closed" : "open",
        };
        break;
      }

      case "move_stop_loss": {
        if (typeof args.newPrice !== "number" || Number.isNaN(args.newPrice)) {
          throw new Error("move_stop_loss requires newPrice");
        }
        await applyStopLossUpdate(args.newPrice, action);
        break;
      }

      case "move_stop_loss_to_breakeven": {
        await applyStopLossUpdate(position.entryPrice, action);
        break;
      }

      case "trail_stop": {
        if (typeof args.newPrice !== "number" || Number.isNaN(args.newPrice)) {
          throw new Error("trail_stop requires newPrice");
        }
        await applyStopLossUpdate(args.newPrice, action);
        break;
      }

      case "move_take_profit": {
        if (typeof args.newPrice !== "number" || Number.isNaN(args.newPrice)) {
          throw new Error("move_take_profit requires newPrice");
        }
        const newPrice = roundPrice(args.newPrice);
        const quantity = position.quantity;
        const closingSide = toClosingSide(position.side);

        await cancelAlgoOrdersByTypes(exchange, position.symbol, ["tp"]);
        const orderId = await exchange.placeTakeProfit(
          position.symbol,
          newPrice,
          newPrice,
          closingSide,
          quantity,
        );

        const firstPendingIndex = positionDoc.takeProfitTargets.findIndex(
          (target) => target.status === "pending",
        );
        if (firstPendingIndex >= 0) {
          positionDoc.takeProfitTargets[firstPendingIndex].price = newPrice;
        } else {
          positionDoc.takeProfitTargets.push({
            price: newPrice,
            quantity,
            percentage: 100,
            status: "pending",
          });
        }
        await positionDoc.save();

        response = {
          success: true,
          processId,
          action,
          positionId: String(position._id),
          symbol: position.symbol,
          takeProfitPrice: newPrice,
          orderId,
        };
        break;
      }

      case "cancel_all_orders": {
        const openOrders = await exchange.getOpenOrders(position.symbol);
        const results = [];

        for (const order of openOrders) {
          try {
            const success = await exchange.cancelOrder(order.orderId, order.symbol);
            results.push({
              orderId: order.orderId,
              symbol: order.symbol,
              success,
            });
          } catch (error) {
            results.push({
              orderId: order.orderId,
              symbol: order.symbol,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        response = {
          success: true,
          processId,
          action,
          positionId: String(position._id),
          symbol: position.symbol,
          cancelled: results.filter((item) => item.success).length,
          failed: results.filter((item) => !item.success).length,
          results,
        };
        break;
      }

      default:
        throw new Error(
          `Unsupported manage_position action: ${action}. Supported: close, partial_close, move_stop_loss, move_stop_loss_to_breakeven, trail_stop, move_take_profit, cancel_all_orders`,
        );
    }

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "agent_tool",
      action: "manage_position_completed",
      symbol: position.symbol,
      details: response || {},
      result: "success",
    });

    if (!response) {
      throw new Error(`manage_position produced no response for action ${action}`);
    }

    return JSON.stringify(response);
  },

  review_signal_thread: async (args) => {
    const limit = normalizePositiveNumber(args.limit, 20, 100);
    const processIdArg = parseOptionalString(args.processId);
    const messageIdArg = parseOptionalString(args.messageId);
    const accountIdArg = getAccountIdFromArgs(args);
    const positionIdArg = parseOptionalString(args.positionId);

    const position = positionIdArg
      ? ((await Position.findById(positionIdArg).lean().exec()) as
          | PositionRecord
          | null)
      : null;

    const accountId = position?.accountId || accountIdArg;
    const messageId = position?.messageId || messageIdArg;
    const channelId = position?.channelId || undefined;

    const processedMessages = messageId
      ? await ProcessedMessage.find({
          messageId,
          ...(accountId ? { accountId } : {}),
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean()
          .exec()
      : [];

    const drafts = messageId
      ? await DraftTrade.find({
          messageId,
          ...(accountId ? { accountId } : {}),
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean()
          .exec()
      : [];

    const linkedPositions = messageId
      ? await Position.find({
          messageId,
          ...(accountId ? { accountId } : {}),
        })
          .sort({ openedAt: -1 })
          .limit(limit)
          .lean()
          .exec()
      : position
        ? [position]
        : [];

    const inferredProcessId =
      processIdArg ||
      position?.processId ||
      (processedMessages.find((item) => item.processId)?.processId as
        | string
        | undefined) ||
      (drafts.find((item) => item.processId)?.processId as string | undefined);

    const processLogs = inferredProcessId
      ? await getProcessTradeLogs({
          processId: inferredProcessId,
          limit,
          order: "asc",
        })
      : [];

    let sourceContextMessages: Array<Record<string, unknown>> = [];
    if (accountId && messageId && channelId) {
      const account = (await Account.findById(accountId).lean().exec()) as
        | AccountRecord
        | null;

      if (account && normalizeSourceType(account.sourceType) === SourceType.DISCORD) {
        try {
          const sourceCtx = getSourceContextForAccount(account);
          const messages = await new DiscordSourceProvider().fetchMessageContext(
            sourceCtx.config,
            channelId,
            messageId,
            limit,
          );
          sourceContextMessages = serializeSourceMessages(messages);
        } catch (error) {
          sourceContextMessages = [
            {
              error: error instanceof Error ? error.message : String(error),
            },
          ];
        }
      }
    }

    return JSON.stringify({
      success: true,
      anchor: {
        positionId: position ? String(position._id) : positionIdArg || null,
        accountId: accountId || null,
        messageId: messageId || null,
        processId: inferredProcessId || null,
      },
      position: position || null,
      sourceContextMessages,
      processedMessages,
      drafts,
      linkedPositions,
      processLogs,
    });
  },

  get_process_logs: async (args) => {
    const processId = parseOptionalString(args.processId);
    if (!processId) {
      throw new Error("get_process_logs requires processId");
    }

    const limit = normalizePositiveNumber(args.limit, 50, 200);
    const order = normalizeSortOrder(args.order);

    const logs = await getProcessTradeLogs({
      processId,
      limit,
      order,
    });

    return JSON.stringify({
      success: true,
      processId,
      count: logs.length,
      order,
      logs,
    });
  },

  sync_position_with_exchange: async (args) => {
    const position = await findPositionRecord(args);
    const positionDoc = await Position.findById(String(position._id)).exec();
    if (!positionDoc) {
      throw new Error(`Position document not found: ${String(position._id)}`);
    }

    const processId = await ensurePersistedProcessId(positionDoc, "agentsync");
    const { exchange, currentPrice, pnlPercent, exchangePosition } =
      await getLivePositionSnapshot(position);
    const openOrders = await exchange.getOpenOrders(position.symbol);
    const algoOrders = await exchange.getAlgoOrders(position.symbol);

    positionDoc.currentPrice = currentPrice;
    positionDoc.pnl = pnlPercent;

    let syncedStatus: "open" | "closed" = "open";
    let syncReason = "Position remains open on exchange";

    if (exchangePosition) {
      positionDoc.quantity = exchangePosition.quantity;
      if (positionDoc.status !== "open") {
        positionDoc.status = "open";
        positionDoc.closedAt = undefined;
        positionDoc.closeReason = undefined;
      }
    } else {
      syncedStatus = "closed";
      syncReason = "Position not found on exchange during agent sync";
      positionDoc.status = "closed";
      positionDoc.closedAt = new Date();
      positionDoc.closeReason = syncReason;
    }

    await positionDoc.save();

    const response = {
      success: true,
      processId,
      positionId: String(position._id),
      accountId: position.accountId || null,
      symbol: position.symbol,
      syncedStatus,
      syncReason,
      databaseSnapshot: {
        currentPrice: positionDoc.currentPrice,
        pnl: positionDoc.pnl,
        quantity: positionDoc.quantity,
        status: positionDoc.status,
        stopLossPrice: positionDoc.stopLossPrice,
        takeProfitTargets: positionDoc.takeProfitTargets,
      },
      exchangeSnapshot: exchangePosition
        ? {
            symbol: exchangePosition.symbol,
            side: exchangePosition.side,
            entryPrice: exchangePosition.entryPrice,
            quantity: exchangePosition.quantity,
            leverage: exchangePosition.leverage,
            markPrice: exchangePosition.markPrice,
            unrealizedPnl: exchangePosition.unrealizedPnl,
            liquidationPrice: exchangePosition.liquidationPrice,
          }
        : null,
      openOrders,
      algoOrders,
    };

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "agent_tool",
      action: "sync_position_with_exchange",
      symbol: position.symbol,
      details: response,
      result: "success",
    });

    return JSON.stringify(response);
  },
};
