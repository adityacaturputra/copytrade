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
import type { AlgoOrderInfo, ExchangeClient } from "@copytrade/shared/lib/exchange/types";
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
  resolveExchangeContext,
  roundPrice,
  serializeSourceMessages,
  toClosingSide,
  type PositionRecord,
} from "./shared";

const PRICE_MATCH_ABSOLUTE_TOLERANCE = 0.01;
const PRICE_MATCH_RELATIVE_TOLERANCE = 0.001;

type ProtectionOrderSummary = {
  orderId: string | null;
  type: "tp" | "sl";
  price: number;
  quantity: number;
  side?: string;
  status?: string;
};

type ProtectionSnapshot = {
  liveStopLossOrders: ProtectionOrderSummary[];
  liveTakeProfitOrders: ProtectionOrderSummary[];
  dbStopLossPrice: number | null;
  dbTakeProfitTargets: Array<{
    price: number;
    quantity: number;
    percentage: number;
    status?: string;
    orderId?: string | null;
  }>;
  missingLiveStopLoss: boolean;
  extraLiveStopLossOrders: ProtectionOrderSummary[];
  missingLiveTakeProfits: Array<{
    price: number;
    quantity: number;
    percentage: number;
    status?: string;
    orderId?: string | null;
  }>;
  extraLiveTakeProfitOrders: ProtectionOrderSummary[];
  hasMismatch: boolean;
};

function pricesRoughlyEqual(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const absoluteDiff = Math.abs(left - right);
  if (absoluteDiff <= PRICE_MATCH_ABSOLUTE_TOLERANCE) return true;
  const base = Math.max(Math.abs(left), Math.abs(right), 1);
  return absoluteDiff / base <= PRICE_MATCH_RELATIVE_TOLERANCE;
}

function normalizeAlgoOrdersForPosition(
  position: PositionRecord,
  algoOrders: AlgoOrderInfo[],
): ProtectionOrderSummary[] {
  const closingSide = toClosingSide(position.side);

  return algoOrders
    .filter(
      (order) =>
        order.symbol === position.symbol &&
        (!order.side || order.side === closingSide),
    )
    .map((order) => ({
      orderId: order.orderId || null,
      type: (order.type === "sl" ? "sl" : "tp") as "sl" | "tp",
      price: order.triggerPrice,
      quantity: order.quantity,
      side: order.side,
      status: order.status,
    }))
    .sort((left, right) => left.price - right.price);
}

function getDbTakeProfitTargets(position: PositionRecord) {
  return (position.takeProfitTargets || []).map((target) => ({
    price: target.price,
    quantity: target.quantity,
    percentage: target.percentage,
    status: target.status,
    orderId: target.orderId || null,
  }));
}

async function buildProtectionSnapshot(
  position: PositionRecord,
  exchange: ExchangeClient,
): Promise<ProtectionSnapshot> {
  const algoOrders = await exchange.getAlgoOrders(position.symbol);
  const normalizedOrders = normalizeAlgoOrdersForPosition(position, algoOrders);
  const liveStopLossOrders = normalizedOrders.filter((order) => order.type === "sl");
  const liveTakeProfitOrders = normalizedOrders.filter((order) => order.type === "tp");
  const dbStopLossPrice = position.stopLossPrice ?? null;
  const dbTakeProfitTargets = getDbTakeProfitTargets(position);
  const pendingDbTakeProfits = dbTakeProfitTargets.filter(
    (target) => target.status !== "cancelled" && target.status !== "hit",
  );

  const missingLiveStopLoss = Boolean(
    dbStopLossPrice &&
      !liveStopLossOrders.some((order) => pricesRoughlyEqual(order.price, dbStopLossPrice)),
  );
  const extraLiveStopLossOrders = liveStopLossOrders.filter(
    (order) =>
      !dbStopLossPrice || !pricesRoughlyEqual(order.price, dbStopLossPrice),
  );

  const missingLiveTakeProfits = pendingDbTakeProfits.filter(
    (target) =>
      !liveTakeProfitOrders.some(
        (order) =>
          pricesRoughlyEqual(order.price, target.price) &&
          pricesRoughlyEqual(order.quantity, target.quantity),
      ),
  );

  const extraLiveTakeProfitOrders = liveTakeProfitOrders.filter(
    (order) =>
      !pendingDbTakeProfits.some(
        (target) =>
          pricesRoughlyEqual(order.price, target.price) &&
          pricesRoughlyEqual(order.quantity, target.quantity),
      ),
  );

  return {
    liveStopLossOrders,
    liveTakeProfitOrders,
    dbStopLossPrice,
    dbTakeProfitTargets,
    missingLiveStopLoss,
    extraLiveStopLossOrders,
    missingLiveTakeProfits,
    extraLiveTakeProfitOrders,
    hasMismatch:
      missingLiveStopLoss ||
      extraLiveStopLossOrders.length > 0 ||
      missingLiveTakeProfits.length > 0 ||
      extraLiveTakeProfitOrders.length > 0,
  };
}

function normalizeProtectionTargets(
  rawTargets: unknown,
  liveQuantity: number,
): Array<{
  price: number;
  quantity: number;
  percentage: number;
}> {
  if (!Array.isArray(rawTargets)) {
    throw new Error("takeProfits must be an array when provided");
  }

  if (rawTargets.length === 0) {
    return [];
  }

  const fallbackPercentage = 100 / rawTargets.length;
  const normalized = rawTargets.map((target, index) => {
    if (!target || typeof target !== "object") {
      throw new Error(`takeProfits[${index}] must be an object`);
    }

    const price = (target as { price?: unknown }).price;
    const quantity = (target as { quantity?: unknown }).quantity;
    const percentage = (target as { percentage?: unknown }).percentage;

    if (typeof price !== "number" || Number.isNaN(price) || price <= 0) {
      throw new Error(`takeProfits[${index}].price must be a positive number`);
    }

    let resolvedPercentage =
      typeof percentage === "number" && percentage > 0
        ? percentage
        : fallbackPercentage;
    let resolvedQuantity =
      typeof quantity === "number" && quantity > 0
        ? quantity
        : (liveQuantity * resolvedPercentage) / 100;

    if (!(resolvedQuantity > 0)) {
      throw new Error(
        `takeProfits[${index}] produced a non-positive quantity; provide quantity or percentage`,
      );
    }

    if (
      !(typeof percentage === "number" && percentage > 0) &&
      typeof quantity === "number" &&
      quantity > 0 &&
      liveQuantity > 0
    ) {
      resolvedPercentage = (resolvedQuantity / liveQuantity) * 100;
    }

    return {
      price: roundPrice(price),
      quantity: resolvedQuantity,
      percentage: resolvedPercentage,
    };
  });

  const totalQuantity = normalized.reduce((sum, target) => sum + target.quantity, 0);
  if (totalQuantity > liveQuantity * 1.001) {
    throw new Error(
      `takeProfits total quantity ${totalQuantity} exceeds live position quantity ${liveQuantity}`,
    );
  }

  return normalized;
}

async function loadTrackedPositionDoc(args: Record<string, unknown>) {
  const position = await findPositionRecord(args);
  const positionDoc = await Position.findById(String(position._id)).exec();
  if (!positionDoc) {
    throw new Error(`Position document not found: ${String(position._id)}`);
  }

  return { position, positionDoc };
}

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

  get_position_protection: async (args) => {
    const { position, positionDoc } = await loadTrackedPositionDoc(args);
    const processId = await ensurePersistedProcessId(positionDoc, "agentprot");
    const { exchange, currentPrice, pnlPercent, exchangePosition } =
      await getLivePositionSnapshot(position);
    const protection = await buildProtectionSnapshot(positionDoc.toObject(), exchange);

    const response = {
      success: true,
      processId,
      positionId: String(position._id),
      accountId: position.accountId || null,
      symbol: position.symbol,
      side: position.side,
      liveSnapshot: {
        currentPrice,
        pnlPercent,
        exchangePosition,
      },
      protection,
    };

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "agent_tool",
      action: "get_position_protection",
      symbol: position.symbol,
      details: response,
      result: "success",
    });

    return JSON.stringify(response);
  },

  adjust_position_protection: async (args) => {
    const { position, positionDoc } = await loadTrackedPositionDoc(args);
    const processId = await ensurePersistedProcessId(positionDoc, "agentprot");
    const { exchange, exchangePosition } = await getLivePositionSnapshot(position);
    const liveQuantity = exchangePosition?.quantity || positionDoc.quantity;
    if (!(liveQuantity > 0)) {
      throw new Error(
        `Cannot adjust protection for ${position.symbol}: no live position quantity found`,
      );
    }

    const replaceTakeProfits = args.replaceTakeProfits !== false;
    const clearStopLoss = args.clearStopLoss === true;
    const hasStopLossUpdate = typeof args.stopLossPrice === "number";
    const hasTakeProfitUpdate = Array.isArray(args.takeProfits);
    if (!hasStopLossUpdate && !clearStopLoss && !hasTakeProfitUpdate) {
      throw new Error(
        "adjust_position_protection requires stopLossPrice, clearStopLoss=true, or takeProfits",
      );
    }

    const closingSide = toClosingSide(position.side);
    const mutationSummary: Record<string, unknown> = {
      replaceTakeProfits,
      clearStopLoss,
    };

    if (hasStopLossUpdate || clearStopLoss) {
      const cancelled = await cancelAlgoOrdersByTypes(exchange, position.symbol, ["sl"]);
      mutationSummary.cancelledStopLossOrders = cancelled;

      if (hasStopLossUpdate) {
        const roundedStopLoss = roundPrice(args.stopLossPrice as number);
        const orderId = await exchange.placeStopLoss(
          position.symbol,
          roundedStopLoss,
          roundedStopLoss,
          closingSide,
          liveQuantity,
        );
        positionDoc.stopLossPrice = roundedStopLoss;
        mutationSummary.stopLoss = {
          price: roundedStopLoss,
          orderId,
        };
      } else {
        positionDoc.stopLossPrice = undefined;
      }
    }

    if (hasTakeProfitUpdate) {
      const normalizedTargets = normalizeProtectionTargets(args.takeProfits, liveQuantity);

      if (replaceTakeProfits) {
        const cancelled = await cancelAlgoOrdersByTypes(exchange, position.symbol, ["tp"]);
        mutationSummary.cancelledTakeProfitOrders = cancelled;
      }

      const existingTargets = replaceTakeProfits
        ? []
        : getDbTakeProfitTargets(positionDoc.toObject() as PositionRecord).map(
            (target) => ({
              ...target,
              orderId: target.orderId || undefined,
              status: (target.status || "pending") as
                | "pending"
                | "hit"
                | "cancelled",
            }),
          );
      const createdTargets: Array<{
        price: number;
        quantity: number;
        percentage: number;
        status: "pending";
        orderId?: string;
      }> = [];

      for (const target of normalizedTargets) {
        const orderId = await exchange.placeTakeProfit(
          position.symbol,
          target.price,
          target.price,
          closingSide,
          target.quantity,
        );
        createdTargets.push({
          ...target,
          status: "pending",
          orderId: orderId || undefined,
        });
      }

      positionDoc.takeProfitTargets = [...existingTargets, ...createdTargets];
      mutationSummary.takeProfits = createdTargets;
    }

    positionDoc.tpSlPlaced =
      Boolean(positionDoc.stopLossPrice) || positionDoc.takeProfitTargets.length > 0;
    await positionDoc.save();

    const protection = await buildProtectionSnapshot(positionDoc.toObject(), exchange);
    const response = {
      success: true,
      processId,
      positionId: String(position._id),
      accountId: position.accountId || null,
      symbol: position.symbol,
      side: position.side,
      liveQuantity,
      mutationSummary,
      protection,
    };

    await logProcessStep({
      accountId: position.accountId,
      processId,
      type: "agent_tool",
      action: "adjust_position_protection",
      symbol: position.symbol,
      details: response,
      result: "success",
    });

    return JSON.stringify(response);
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

  cleanup_orphan_protection_orders: async (args) => {
    const { exchange, accountId, accountName, provider } =
      await resolveExchangeContext(args);
    const processId = `cleanup-${Date.now()}`;
    const symbol = parseOptionalString(args.symbol);
    const dryRun = args.dryRun !== false;

    const [algoOrders, openOrders, exchangePositions, trackedPositions] = await Promise.all([
      exchange.getAlgoOrders(symbol),
      exchange.getOpenOrders(symbol),
      exchange.getOpenPositions(),
      Position.find({
        accountId,
        status: { $in: ["open", "pending"] },
        ...(symbol ? { symbol } : {}),
      })
        .lean()
        .exec(),
    ]);

    const trackedSymbols = new Set(trackedPositions.map((position) => position.symbol));
    const livePositionSymbols = new Set(exchangePositions.map((position) => position.symbol));
    const openOrderSymbols = new Set(openOrders.map((order) => order.symbol));

    const orphanCandidates = algoOrders.filter((order) => {
      if (symbol && order.symbol !== symbol) return false;
      return (
        !trackedSymbols.has(order.symbol) &&
        !livePositionSymbols.has(order.symbol) &&
        !openOrderSymbols.has(order.symbol)
      );
    });

    const symbolsToCleanup = [...new Set(orphanCandidates.map((order) => order.symbol))];
    const cleanupResults: Array<{
      symbol: string;
      cancelled: string[];
      errors: string[];
    }> = [];

    if (!dryRun) {
      for (const targetSymbol of symbolsToCleanup) {
        const result = await exchange.cancelAlgoOrders(targetSymbol);
        cleanupResults.push({
          symbol: targetSymbol,
          cancelled: result.cancelled,
          errors: result.errors,
        });
      }
    }

    const response = {
      success: true,
      processId,
      accountId,
      accountName,
      provider,
      dryRun,
      requestedSymbol: symbol || null,
      orphanCandidates: orphanCandidates.map((order) => ({
        orderId: order.orderId,
        symbol: order.symbol,
        type: order.type,
        side: order.side,
        triggerPrice: order.triggerPrice,
        quantity: order.quantity,
        status: order.status,
      })),
      symbolsToCleanup,
      cleanupResults,
      trackedSymbols: [...trackedSymbols],
      livePositionSymbols: [...livePositionSymbols],
      openOrderSymbols: [...openOrderSymbols],
    };

    await logProcessStep({
      accountId,
      processId,
      type: "agent_tool",
      action: "cleanup_orphan_protection_orders",
      symbol: symbol || null,
      details: response,
      result: "success",
    });

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
