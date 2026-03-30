/**
 * Agent Tools — definitions + implementations for the agentic AI loop.
 *
 * Each tool has:
 *   1. An OpenAI function-calling definition (name, description, parameters)
 *   2. An async implementation function
 *
 * Tools are organized by category:
 *   - 📊 Account & Market Data
 *   - 📈 Positions & Orders
 *   - 📝 Drafts
 *   - 💬 Discord
 *   - 🗄️ Database / Logs
 *   - ⚙️ Settings
 */

import OpenAI from "openai";
import {
  connectDB,
  getTradingMode,
  setTradingMode,
  getStats,
  getOpenPositions,
  getPendingDrafts,
  getRecentMessages,
  getRecentLogs,
  getAllPositions,
  getAllDiscordSources,
} from "@/lib/database";
import { ExchangeFactory } from "@/lib/exchange/ExchangeFactory";
import { calculateRisk } from "@/lib/risk-calc";
import { getRiskConfig } from "@/lib/risk";

// ==================== Tool Definitions ====================

export const agentTools: OpenAI.ChatCompletionTool[] = [
  // ─── Account & Market ──────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_account_info",
      description:
        "Get exchange account info: total balance, available balance, unrealized PnL, and which exchange is active (OKX/MEXC/Paper).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ticker_price",
      description:
        "Get the current price of a trading pair. Symbol must be in exchange format (e.g., BTC-USDT-SWAP for OKX, BTCUSDT for MEXC).",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "Trading pair symbol (exchange format)",
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_open_positions",
      description:
        "Get all currently open positions from both the exchange and the database. Returns symbol, side, entry, PnL, leverage, TP/SL.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_exchange_positions",
      description:
        "Get real-time positions directly from the exchange API (not database). Useful for verifying actual exchange state.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },

  // ─── Orders & Trading ──────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "place_order",
      description:
        "Place a market or limit order on the exchange. IMPORTANT: Use with caution — this executes real trades! The exchange is determined by EXCHANGE_PROVIDER env var.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "Symbol in exchange format (e.g., BTC-USDT-SWAP for OKX)",
          },
          side: {
            type: "string",
            enum: ["BUY", "SELL"],
            description: "Order side: BUY for long, SELL for short",
          },
          type: {
            type: "string",
            enum: ["MARKET", "LIMIT"],
            description: "Order type",
          },
          quantity: { type: "number", description: "Position size/quantity" },
          price: {
            type: "number",
            description: "Limit price (required for LIMIT orders)",
          },
          leverage: {
            type: "number",
            description: "Leverage (e.g., 10 for 10x)",
          },
        },
        required: ["symbol", "side", "type", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_position",
      description:
        "Close a specific position on the exchange by symbol. This executes a real close order!",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Symbol to close" },
          quantity: {
            type: "number",
            description: "Quantity to close (optional, defaults to full)",
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_all_positions",
      description:
        "Close ALL open positions on the exchange. Use with extreme caution!",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_leverage",
      description: "Set leverage for a symbol on the exchange.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading pair symbol" },
          leverage: {
            type: "number",
            description: "Leverage value (e.g., 20 for 20x)",
          },
        },
        required: ["symbol", "leverage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_stop_loss",
      description:
        "Place a stop-loss order for a position. Side should be the CLOSING direction (SELL for LONG, BUY for SHORT).",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading pair symbol" },
          triggerPrice: {
            type: "number",
            description: "Price that triggers the SL",
          },
          executePrice: {
            type: "number",
            description: "Price to execute the SL order",
          },
          side: {
            type: "string",
            enum: ["BUY", "SELL"],
            description: "Closing direction",
          },
          quantity: { type: "number", description: "Quantity" },
        },
        required: [
          "symbol",
          "triggerPrice",
          "executePrice",
          "side",
          "quantity",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_take_profit",
      description:
        "Place a take-profit order for a position. Side should be the CLOSING direction.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading pair symbol" },
          triggerPrice: {
            type: "number",
            description: "Price that triggers the TP",
          },
          executePrice: {
            type: "number",
            description: "Price to execute the TP order",
          },
          side: {
            type: "string",
            enum: ["BUY", "SELL"],
            description: "Closing direction",
          },
          quantity: { type: "number", description: "Quantity" },
        },
        required: [
          "symbol",
          "triggerPrice",
          "executePrice",
          "side",
          "quantity",
        ],
      },
    },
  },

  // ─── Drafts ────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_pending_drafts",
      description:
        "Get all pending draft trades waiting for review. Includes signal details, symbol, side, entry, TP/SL, confidence.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "accept_draft",
      description:
        "Accept a pending draft trade, which executes the order on the exchange.",
      parameters: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description: "The draft trade ID to accept",
          },
        },
        required: ["draftId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_draft",
      description: "Reject a pending draft trade.",
      parameters: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description: "The draft trade ID to reject",
          },
        },
        required: ["draftId"],
      },
    },
  },

  // ─── Discord ───────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_discord_sources",
      description:
        "Get all configured Discord sources (bot/user) with their status, channels, and health.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_signal_now",
      description:
        "Trigger a manual signal check — fetches latest Discord messages, runs AI analysis, and creates drafts or executes trades depending on trading mode.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },

  // ─── Database & Logs ───────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_stats",
      description:
        "Get system statistics: total messages, executed signals, open/closed positions, pending drafts, total logs.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_logs",
      description:
        "Get recent activity logs including signal processing, trade execution, errors.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of logs to return (default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_signals",
      description:
        "Get recently processed Discord messages/signals with their parse status.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of signals to return (default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_all_positions_history",
      description:
        "Get position history (both open and closed) from the database.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of positions to return (default 50)",
          },
        },
      },
    },
  },

  // ─── Settings ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_trading_mode",
      description:
        "Get the current trading mode: 'auto' (signals execute immediately) or 'manual' (signals become drafts for review).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_trading_mode",
      description:
        "Switch between 'auto' and 'manual' trading mode. In auto mode, signals are executed immediately. In manual mode, signals become drafts.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["auto", "manual"],
            description: "Trading mode to set",
          },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_risk_settings",
      description:
        "Get current risk management settings: risk per trade %, max/min leverage, skip-no-SL setting.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_risk_preview",
      description:
        "Calculate risk for a potential trade: margin needed, leverage, notional size, quantity based on current risk settings.",
      parameters: {
        type: "object",
        properties: {
          entryPrice: { type: "number", description: "Entry price" },
          stopLossPrice: { type: "number", description: "Stop loss price" },
          side: {
            type: "string",
            enum: ["LONG", "SHORT"],
            description: "Trade direction",
          },
        },
        required: ["entryPrice", "stopLossPrice", "side"],
      },
    },
  },
];

// ==================== Tool Implementations ====================

type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

export const toolImplementations: Record<string, ToolExecutor> = {
  // ─── Account & Market ──────────────────────────────────────────

  get_account_info: async () => {
    await connectDB();
    const exchange = ExchangeFactory.getClient();
    const info = await exchange.getAccountInfo();
    const provider = ExchangeFactory.getProviderName();
    return JSON.stringify({
      provider,
      ...info,
    });
  },

  get_ticker_price: async (args) => {
    const symbol = args.symbol as string;
    const exchange = ExchangeFactory.getClient();
    const price = await exchange.getTickerPrice(symbol);
    return JSON.stringify({ symbol, price });
  },

  get_open_positions: async () => {
    await connectDB();
    const positions = await getOpenPositions();
    return JSON.stringify(
      positions.map((p) => ({
        _id: p._id,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        quantity: p.quantity,
        leverage: p.leverage,
        takeProfitPrice: p.takeProfitPrice,
        stopLossPrice: p.stopLossPrice,
        pnl: p.pnl,
        status: p.status,
        openedAt: p.openedAt,
      })),
    );
  },

  get_exchange_positions: async () => {
    const exchange = ExchangeFactory.getClient();
    const positions = await exchange.getOpenPositions();
    return JSON.stringify(
      positions.map((p) => ({
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        leverage: p.leverage,
        margin: p.margin,
        unrealizedPnl: p.unrealizedPnl,
        liquidationPrice: p.liquidationPrice,
        markPrice: p.markPrice,
      })),
    );
  },

  // ─── Orders & Trading ──────────────────────────────────────────

  place_order: async (args) => {
    const { symbol, side, type, quantity, price, leverage } = args as {
      symbol: string;
      side: "BUY" | "SELL";
      type: "MARKET" | "LIMIT";
      quantity: number;
      price?: number;
      leverage?: number;
    };
    const exchange = ExchangeFactory.getClient();

    if (leverage) {
      try {
        await exchange.setLeverage(symbol, leverage);
      } catch (err) {
        // Leverage might already be set
      }
    }

    const result = await exchange.placeOrder({
      symbol,
      side,
      type,
      quantity,
      price,
      leverage,
    });
    return JSON.stringify(result);
  },

  close_position: async (args) => {
    const { symbol, quantity } = args as {
      symbol: string;
      quantity?: number;
    };
    const exchange = ExchangeFactory.getClient();
    await exchange.closePosition(symbol, undefined, quantity);
    return JSON.stringify({
      success: true,
      symbol,
      quantity: quantity || "all",
    });
  },

  close_all_positions: async () => {
    const exchange = ExchangeFactory.getClient();
    const result = await exchange.closeAllPositions();
    return JSON.stringify(result);
  },

  set_leverage: async (args) => {
    const { symbol, leverage } = args as {
      symbol: string;
      leverage: number;
    };
    const exchange = ExchangeFactory.getClient();
    await exchange.setLeverage(symbol, leverage);
    return JSON.stringify({ success: true, symbol, leverage });
  },

  set_stop_loss: async (args) => {
    const { symbol, triggerPrice, executePrice, side, quantity } = args as {
      symbol: string;
      triggerPrice: number;
      executePrice: number;
      side: "BUY" | "SELL";
      quantity: number;
    };
    const exchange = ExchangeFactory.getClient();
    const id = await exchange.placeStopLoss(
      symbol,
      triggerPrice,
      executePrice,
      side,
      quantity,
    );
    return JSON.stringify({ success: true, orderId: id });
  },

  set_take_profit: async (args) => {
    const { symbol, triggerPrice, executePrice, side, quantity } = args as {
      symbol: string;
      triggerPrice: number;
      executePrice: number;
      side: "BUY" | "SELL";
      quantity: number;
    };
    const exchange = ExchangeFactory.getClient();
    const id = await exchange.placeTakeProfit(
      symbol,
      triggerPrice,
      executePrice,
      side,
      quantity,
    );
    return JSON.stringify({ success: true, orderId: id });
  },

  // ─── Drafts ────────────────────────────────────────────────────

  get_pending_drafts: async () => {
    await connectDB();
    const drafts = await getPendingDrafts();
    return JSON.stringify(
      drafts.map((d) => ({
        _id: d._id,
        action: d.action,
        symbol: d.symbol,
        side: d.side,
        entryPrice: d.entryPrice,
        takeProfitTargets: d.takeProfitTargets,
        stopLoss: d.stopLoss,
        leverage: d.leverage,
        quantity: d.quantity,
        confidence: d.confidence,
        reasoning: d.reasoning,
        author: d.author,
        status: d.status,
        originalContent: d.originalContent,
        createdAt: d.createdAt,
      })),
    );
  },

  accept_draft: async (args) => {
    const { draftId } = args as { draftId: string };
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/drafts/${draftId}/accept`, {
      method: "POST",
    });
    const data = await res.json();
    return JSON.stringify(data);
  },

  reject_draft: async (args) => {
    const { draftId } = args as { draftId: string };
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/drafts/${draftId}/reject`, {
      method: "POST",
    });
    const data = await res.json();
    return JSON.stringify(data);
  },

  // ─── Discord ───────────────────────────────────────────────────

  get_discord_sources: async () => {
    await connectDB();
    const sources = await getAllDiscordSources();
    return JSON.stringify(
      sources.map((s) => ({
        name: s.name,
        method: s.method,
        channelIds: s.channelIds,
        isActive: s.isActive,
        lastFetchedAt: s.lastFetchedAt,
        lastError: s.lastError,
        autoRefresh: s.autoRefresh,
      })),
    );
  },

  check_signal_now: async () => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/cron/signal-check`, {
      method: "POST",
    });
    const data = await res.json();
    return JSON.stringify(data);
  },

  // ─── Database & Logs ───────────────────────────────────────────

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
    return JSON.stringify(messages);
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

  // ─── Settings ──────────────────────────────────────────────────

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
    const exchange = ExchangeFactory.getClient();
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
      entryPrice,
      stopLossPrice,
      ...result,
      accountBalance: account.availableBalance || account.totalBalance,
    });
  },
};
