import OpenAI from "openai";

export const database_logsTools: OpenAI.ChatCompletionTool[] = [
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
        "Get recently processed source messages/signals from the database. Returns the raw message content, parsed signal data, source/account IDs, parse status (success/failed/skipped/executed/drafted), and timestamps. Use this to see what the system has received from Discord, Telegram, or other future providers.",
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
  }
];
