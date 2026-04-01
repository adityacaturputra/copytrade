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
        "Get exchange account info. Returns JSON: { provider: string ('okx'|'mexc'|'paper'), totalBalance: number (total equity in USDT), availableBalance: number (free margin in USDT), unrealizedPnl: number (unrealized profit/loss) }. Use this first to understand the account state before trading.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ticker_price",
      description:
        "Get the current mark price of a trading pair. Symbol MUST be in exchange-specific format: for OKX use 'BTC-USDT-SWAP' (instrument ID with dashes), for MEXC use 'BTCUSDT' (no dashes).",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format. OKX examples: 'BTC-USDT-SWAP', 'ETH-USDT-SWAP'. MEXC examples: 'BTCUSDT', 'ETHUSDT'.",
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
        "Get all currently open positions from the DATABASE. Returns JSON array: [{ _id: string (MongoDB ObjectId), symbol: string (e.g., 'BTC-USDT-SWAP'), side: string ('LONG'|'SHORT'), entryPrice: number, currentPrice: number, quantity: number, leverage: number, takeProfitTargets: array, stopLossPrice: number|null, pnl: number|null, status: string ('open'), openedAt: date }]. Use this to see what positions are tracked in the system.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_exchange_positions",
      description:
        "Get real-time positions directly from the EXCHANGE API (not database). Returns JSON array: [{ symbol: string (e.g., 'BTC-USDT-SWAP'), side: string ('LONG'|'SHORT'), entryPrice: number, quantity: number, leverage: number, margin: number (margin used in USDT), unrealizedPnl: number (unrealized profit/loss in USDT), liquidationPrice: number|null, markPrice: number }]. Use this to verify the actual exchange state — may differ from database.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },

  // ─── Orders & Trading ──────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "place_order",
      description:
        "Place a market or limit order on the exchange. ⚠️ EXECUTES REAL TRADES — use with caution! Always check account balance and current positions first. The exchange is determined by EXCHANGE_PROVIDER env var (OKX/MEXC/Paper).",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format. OKX: 'BTC-USDT-SWAP', MEXC: 'BTCUSDT'",
          },
          side: {
            type: "string",
            enum: ["BUY", "SELL"],
            description:
              "Order side: BUY to open long or close short, SELL to open short or close long",
          },
          type: {
            type: "string",
            enum: ["MARKET", "LIMIT"],
            description:
              "MARKET fills immediately at current price. LIMIT requires a 'price' parameter.",
          },
          quantity: {
            type: "number",
            description:
              "Position size in contracts or base units. For OKX swaps this is in contracts (e.g., 1.68 contracts). Use calculate_risk_preview to determine the right size.",
          },
          price: {
            type: "number",
            description:
              "Required for LIMIT orders only. The limit price at which the order should fill.",
          },
          leverage: {
            type: "number",
            description:
              "Optional leverage (e.g., 10 for 10x, 20 for 20x). Will be set before placing the order.",
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
        "Close a specific open position on the exchange by symbol. ⚠️ EXECUTES REAL CLOSE ORDER! Places a market order in the opposite direction to close the position.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "The symbol of the position to close (e.g., 'BTC-USDT-SWAP')",
          },
          quantity: {
            type: "number",
            description:
              "Quantity to close. If omitted, closes the entire position.",
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
        "Close ALL open positions on the exchange at once. Returns JSON: { results: [{ symbol, side, success, error? }] }. ⚠️ EXTREME CAUTION — this closes every position with market orders!",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_leverage",
      description:
        "Set the leverage for a specific trading pair on the exchange. Must be called before placing an order if you want non-default leverage.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format (e.g., 'BTC-USDT-SWAP')",
          },
          leverage: {
            type: "number",
            description:
              "Leverage multiplier (e.g., 1 for 1x, 10 for 10x, 50 for 50x)",
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
        "Place a stop-loss (SL) order for an open position. This creates a conditional order that triggers when the price hits 'triggerPrice' and executes at 'executePrice'. IMPORTANT: 'side' must be the CLOSING direction — use SELL for a LONG position, BUY for a SHORT position. For LONG: SL trigger must be BELOW current price. For SHORT: SL trigger must be ABOVE current price.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format (e.g., 'BTC-USDT-SWAP')",
          },
          triggerPrice: {
            type: "number",
            description:
              "The price that triggers the stop-loss. For LONG this is below entry, for SHORT above entry.",
          },
          executePrice: {
            type: "number",
            description:
              "The price at which the SL order executes. Usually same as triggerPrice for market-like fill, or slightly worse to ensure fill.",
          },
          side: {
            type: "string",
            enum: ["BUY", "SELL"],
            description:
              "CLOSING direction: SELL to close a LONG, BUY to close a SHORT",
          },
          quantity: {
            type: "number",
            description:
              "Quantity to close. Should match the position size. Get from get_exchange_positions.",
          },
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
        "Place a take-profit (TP) order for an open position. This creates a conditional order that triggers when price hits 'triggerPrice' and executes at 'executePrice'. IMPORTANT: 'side' must be the CLOSING direction — use SELL for a LONG position, BUY for a SHORT position. For LONG: TP trigger must be ABOVE current price. For SHORT: TP trigger must be BELOW current price.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format (e.g., 'BTC-USDT-SWAP')",
          },
          triggerPrice: {
            type: "number",
            description:
              "The price that triggers the take-profit. For LONG this is above entry, for SHORT below entry.",
          },
          executePrice: {
            type: "number",
            description:
              "The price at which the TP order executes. Usually same as triggerPrice for market-like fill, or slightly worse to ensure fill.",
          },
          side: {
            type: "string",
            enum: ["BUY", "SELL"],
            description:
              "CLOSING direction: SELL to close a LONG, BUY to close a SHORT",
          },
          quantity: {
            type: "number",
            description:
              "Quantity to close. Should match the position size. Get from get_exchange_positions.",
          },
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
        "Get all pending draft trades waiting for review. Returns JSON array: [{ _id: string (24-char MongoDB ObjectId — USE THIS as draftId for accept/reject), action: string ('BUY'|'SELL'), symbol: string (e.g., 'BTC-USDT-SWAP'), side: string ('LONG'|'SHORT'), entryPrice: number, takeProfitTargets: number[]|null, stopLoss: number|null, leverage: number|null, quantity: number|null, confidence: number (0-1), reasoning: string (AI explanation), author: string (signal source), status: string ('pending'), originalContent: string (raw Discord message), createdAt: date }]. IMPORTANT: Use the _id field exactly as-is when calling accept_draft or reject_draft.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "accept_draft",
      description:
        "Accept a pending draft trade, which executes the order on the exchange. IMPORTANT: draftId MUST be the exact _id string from get_pending_drafts (a 24-char MongoDB ObjectId like '6810a1b2c3d4e5f6a7b8c9d0'). Do NOT use numeric indices like '1' or '2'.",
      parameters: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description:
              "The exact MongoDB _id string from get_pending_drafts (e.g., '6810a1b2c3d4e5f6a7b8c9d0')",
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
      description:
        "Reject a pending draft trade. IMPORTANT: draftId MUST be the exact _id string from get_pending_drafts (a 24-char MongoDB ObjectId like '6810a1b2c3d4e5f6a7b8c9d0'). Do NOT use numeric indices like '1' or '2'.",
      parameters: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description:
              "The exact MongoDB _id string from get_pending_drafts (e.g., '6810a1b2c3d4e5f6a7b8c9d0')",
          },
        },
        required: ["draftId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "accept_all_drafts",
      description:
        "Accept ALL pending draft trades at once, executing each on the exchange. Returns JSON: { success: boolean, total: number, accepted: number (succeeded), failed: number, results: [{ id: string, success: boolean, error?: string }] }. Use this when the user wants to accept everything without reviewing individually.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_all_drafts",
      description:
        "Reject ALL pending draft trades at once. Returns JSON: { success: boolean, total: number, rejected: number (succeeded), failed: number, results: [{ id: string, success: boolean, error?: string }] }. Use this when the user wants to reject everything without reviewing individually.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },

  // ─── Discord ───────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_discord_sources",
      description:
        "Get all configured Discord signal sources. Returns JSON array: [{ name: string (source name), method: string ('bot'|'user'), channelIds: string[] (Discord channel IDs), isActive: boolean, lastFetchedAt: date|null, lastError: string|null, autoRefresh: boolean }]. Use to check if Discord monitoring is healthy.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_signal_now",
      description:
        "Manually trigger a signal check cycle: fetches latest Discord messages from all active sources, runs AI analysis to detect trading signals, then either creates draft trades (manual mode) or executes trades directly (auto mode). Returns JSON: { checked: number, signals: number, executed: number, drafts: number, errors: string[] }.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },

  // ─── Database & Logs ───────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_stats",
      description:
        "Get system overview statistics. Returns JSON: { totalMessages: number, totalSignals: number, openPositions: number, closedPositions: number, pendingDrafts: number, totalLogs: number }. Use for a quick system health overview.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_logs",
      description:
        "Get recent activity logs from the system. Returns entries with type (signal/trade/error), action, symbol, details, result, error messages, and timestamp. Useful for debugging issues or seeing what the system has been doing.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description:
              "Max number of log entries to return. Default 20, max 100.",
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
        "Get recently processed Discord messages/signals. Returns the raw message content, parsed signal data (symbol, side, entry, TP/SL), parse status (success/failed/skipped), and timestamp. Use to see what signals the system has received.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description:
              "Max number of signals to return. Default 20, max 100.",
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
        "Get position history from the database — both open and closed positions. Returns symbol, side, entryPrice, quantity, leverage, PnL, status (open/closed), closeReason, openedAt, closedAt. Use for performance analysis and trade history review.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description:
              "Max number of positions to return. Default 50, max 200.",
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
        "Get the current trading mode. Returns JSON: { mode: string ('auto'|'manual') }. 'auto' = signals execute immediately on exchange. 'manual' = signals become draft trades requiring accept_draft/reject_draft.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_trading_mode",
      description:
        "Change the trading mode. 'auto': signals execute immediately on exchange (risky, no review). 'manual': signals become pending drafts that must be individually accepted or rejected (safer, recommended).",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["auto", "manual"],
            description:
              "'auto' for immediate execution, 'manual' for draft review workflow",
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
        "Get current risk management configuration. Returns JSON: { riskPerTradePercent: number (e.g., 2 = 2% of balance risked per trade), minLeverage: number (minimum allowed leverage), maxLeverage: number (maximum allowed leverage), skipNoSL: boolean (skip signals without stop-loss) }. These settings control position sizing via calculate_risk_preview.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_risk_preview",
      description:
        "Calculate position sizing and risk for a potential trade BEFORE placing it. Returns: suggested quantity (contracts), required margin, notional value, leverage needed, and risk amount in USD. Uses current account balance and risk settings. ALWAYS call this before place_order to determine the correct quantity.",
      parameters: {
        type: "object",
        properties: {
          entryPrice: {
            type: "number",
            description:
              "Planned entry price for the trade (e.g., 65000 for BTC at $65,000)",
          },
          stopLossPrice: {
            type: "number",
            description:
              "Planned stop-loss price (e.g., 62000 for BTC LONG). The difference between entry and SL determines risk.",
          },
          side: {
            type: "string",
            enum: ["LONG", "SHORT"],
            description:
              "Trade direction: LONG (buy, profit from price increase) or SHORT (sell, profit from price decrease)",
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
        takeProfitTargets: p.takeProfitTargets,
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

    // Validate MongoDB ObjectId format (24 hex chars)
    if (!/^[0-9a-fA-F]{24}$/.test(draftId)) {
      return JSON.stringify({
        success: false,
        error: `Invalid draft ID '${draftId}'. You MUST use the exact _id string from get_pending_drafts (24-char hex string like '6810a1b2c3d4e5f6a7b8c9d0'). Call get_pending_drafts first to get the correct IDs.`,
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/drafts/${draftId}/accept`, {
      method: "POST",
    });
    const data = await res.json();
    return JSON.stringify(data);
  },

  reject_draft: async (args) => {
    const { draftId } = args as { draftId: string };

    // Validate MongoDB ObjectId format (24 hex chars)
    if (!/^[0-9a-fA-F]{24}$/.test(draftId)) {
      return JSON.stringify({
        success: false,
        error: `Invalid draft ID '${draftId}'. You MUST use the exact _id string from get_pending_drafts (24-char hex string like '6810a1b2c3d4e5f6a7b8c9d0'). Call get_pending_drafts first to get the correct IDs.`,
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/drafts/${draftId}/reject`, {
      method: "POST",
    });
    const data = await res.json();
    return JSON.stringify(data);
  },

  accept_all_drafts: async () => {
    await connectDB();
    const drafts = await getPendingDrafts();
    if (drafts.length === 0) {
      return JSON.stringify({
        success: true,
        message: "No pending drafts to accept.",
        accepted: 0,
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const draft of drafts) {
      try {
        const res = await fetch(`${baseUrl}/api/drafts/${draft._id}/accept`, {
          method: "POST",
        });
        const data = await res.json();
        results.push({
          id: String(draft._id),
          success: res.ok,
          error: data.error,
        });
      } catch (err) {
        results.push({
          id: String(draft._id),
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return JSON.stringify({
      success: true,
      total: drafts.length,
      accepted: succeeded,
      failed,
      results,
    });
  },

  reject_all_drafts: async () => {
    await connectDB();
    const drafts = await getPendingDrafts();
    if (drafts.length === 0) {
      return JSON.stringify({
        success: true,
        message: "No pending drafts to reject.",
        rejected: 0,
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const draft of drafts) {
      try {
        const res = await fetch(`${baseUrl}/api/drafts/${draft._id}/reject`, {
          method: "POST",
        });
        const data = await res.json();
        results.push({
          id: String(draft._id),
          success: res.ok,
          error: data.error,
        });
      } catch (err) {
        results.push({
          id: String(draft._id),
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return JSON.stringify({
      success: true,
      total: drafts.length,
      rejected: succeeded,
      failed,
      results,
    });
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
