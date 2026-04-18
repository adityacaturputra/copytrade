import {
  connectDB,
  getAllPositions,
  getRecentLogs,
  getRecentMessages,
  getStats,
  getTradingMode,
  setTradingMode,
} from "@copytrade/shared/lib/database";
import { calculateRisk } from "@copytrade/shared/lib/risk-calc";
import { getRiskConfig } from "@copytrade/shared/lib/risk";
import type { ToolExecutor } from "./shared";
import { resolveExchangeContext, roundPrice } from "./shared";

export const logsSettingsToolImplementations: Record<string, ToolExecutor> = {
  get_stats: async () => {
    await connectDB();
    const stats = await getStats();
    return JSON.stringify(stats);
  },

  get_recent_logs: async (args) => {
    await connectDB();
    const limit = (args.limit as number) || 20;
    const logs = await getRecentLogs(limit);
    return JSON.stringify(
      logs.map((l) => ({
        type: l.type,
        action: l.action,
        symbol: l.symbol,
        details: l.details,
        result: l.result,
        error: l.error,
        createdAt: l.createdAt,
      })),
    );
  },

  get_recent_signals: async (args) => {
    await connectDB();
    const limit = (args.limit as number) || 20;
    const messages = await getRecentMessages(limit);
    return JSON.stringify(
      messages.map((message) => ({
        accountId: message.accountId || null,
        processId: message.processId || null,
        messageId: message.messageId,
        channelId: message.channelId,
        author: message.author,
        content: message.content,
        signalType: message.signalType,
        parsedSignal: message.parsedSignal,
        status: message.status,
        sourceTimestamp: message.sourceTimestamp || null,
        processedAt: message.processedAt || null,
        createdAt: message.createdAt,
      })),
    );
  },

  get_all_positions_history: async (args) => {
    await connectDB();
    const limit = (args.limit as number) || 50;
    const positions = await getAllPositions(limit);
    return JSON.stringify(
      positions.map((p) => ({
        _id: p._id,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        leverage: p.leverage,
        pnl: p.pnl,
        status: p.status,
        closeReason: p.closeReason,
        openedAt: p.openedAt,
        closedAt: p.closedAt,
      })),
    );
  },

  get_trading_mode: async () => {
    await connectDB();
    const mode = await getTradingMode();
    return JSON.stringify({ mode });
  },

  set_trading_mode: async (args) => {
    const { mode } = args as { mode: "auto" | "manual" };
    await connectDB();
    await setTradingMode(mode);
    return JSON.stringify({ success: true, mode });
  },

  get_risk_settings: async () => {
    await connectDB();
    const config = await getRiskConfig();
    return JSON.stringify(config);
  },

  calculate_risk_preview: async (args) => {
    const { entryPrice, stopLossPrice, side } = args as {
      entryPrice: number;
      stopLossPrice: number;
      side: "LONG" | "SHORT";
    };
    await connectDB();
    const riskConfig = await getRiskConfig();
    const ctx = await resolveExchangeContext(args);
    const exchange = ctx.exchange;
    const account = await exchange.getAccountInfo();

    const result = calculateRisk({
      accountBalance: account.availableBalance || account.totalBalance,
      riskPerTradePercent: riskConfig.riskPerTradePercent,
      entryPrice,
      stopLossPrice,
      minLeverage: riskConfig.minLeverage,
      maxLeverage: riskConfig.maxLeverage,
    });

    return JSON.stringify({
      side,
      entryPrice: roundPrice(entryPrice),
      stopLossPrice: roundPrice(stopLossPrice),
      ...result,
      accountBalance: account.availableBalance || account.totalBalance,
      provider: ctx.provider,
      accountId: ctx.accountId,
      accountName: ctx.accountName,
    });
  },
};
