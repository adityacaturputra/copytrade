import OpenAI from "openai";
import { positionOpsExtraTools } from "./position-ops-extra";

export const position_opsTools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "analyze_position_context",
      description:
        "High-level position analysis tool. Loads a tracked position from the database, refetches live exchange price, builds full AI context (current price, SL/TP, account positions, Discord context when available), and returns the AI decision summary plus the input context used.",
      parameters: {
        type: "object",
        properties: {
          positionId: {
            type: "string",
            description: "Preferred tracked position ID from the database.",
          },
          accountId: {
            type: "string",
            description:
              "Optional trading account ID when using symbol lookup instead of positionId.",
          },
          symbol: {
            type: "string",
            description:
              "Optional symbol to find a tracked position when positionId is not provided.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_position_protection",
      description:
        "Inspect a tracked position's live TP/SL protection. It resolves the database position, fetches the live exchange position snapshot plus the current exchange algo orders for that symbol, and returns a mismatch summary between database TP/SL targets and live exchange TP/SL orders.",
      parameters: {
        type: "object",
        properties: {
          positionId: {
            type: "string",
            description: "Preferred tracked position ID from the database.",
          },
          accountId: {
            type: "string",
            description:
              "Optional trading account ID when using symbol lookup instead of positionId.",
          },
          symbol: {
            type: "string",
            description:
              "Optional symbol to find a tracked position when positionId is not provided.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_position",
      description:
        "High-level position management tool. It resolves a tracked position, checks live exchange context, then performs one action: close, partial_close, move_stop_loss, move_stop_loss_to_breakeven, trail_stop, move_take_profit, or cancel_all_orders. Returns a structured summary with the generated processId.",
      parameters: {
        type: "object",
        properties: {
          positionId: {
            type: "string",
            description: "Preferred tracked position ID from the database.",
          },
          accountId: {
            type: "string",
            description:
              "Optional trading account ID when using symbol lookup instead of positionId.",
          },
          symbol: {
            type: "string",
            description:
              "Optional symbol to find a tracked position when positionId is not provided.",
          },
          action: {
            type: "string",
            enum: [
              "close",
              "partial_close",
              "move_stop_loss",
              "move_stop_loss_to_breakeven",
              "trail_stop",
              "move_take_profit",
              "cancel_all_orders",
            ],
            description: "The management action to execute.",
          },
          reason: {
            type: "string",
            description:
              "REQUIRED for close and partial_close actions. A clear, specific reason explaining WHY this action is being taken (e.g., 'Exchange position no longer exists after sync', 'TP1 hit on exchange'). Must reference concrete evidence — do NOT close merely because price is near SL.",
          },
          quantity: {
            type: "number",
            description:
              "Optional quantity for partial_close. If omitted, defaults to half of the tracked position quantity.",
          },
          newPrice: {
            type: "number",
            description:
              "Required for move_stop_loss, trail_stop, or move_take_profit. The new trigger/execute price to use.",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "adjust_position_protection",
      description:
        "Replace or update a tracked position's TP/SL protection on both the live exchange and the database. Use this when the AI needs to move/clear stop loss, replace the TP ladder, or reapply protection after detecting mismatches. takeProfits should be an array of { price, quantity?, percentage? }.",
      parameters: {
        type: "object",
        properties: {
          positionId: {
            type: "string",
            description: "Preferred tracked position ID from the database.",
          },
          accountId: {
            type: "string",
            description:
              "Optional trading account ID when using symbol lookup instead of positionId.",
          },
          symbol: {
            type: "string",
            description:
              "Optional symbol to find a tracked position when positionId is not provided.",
          },
          stopLossPrice: {
            type: "number",
            description:
              "Optional new stop-loss trigger price. If provided, existing SL orders are replaced.",
          },
          clearStopLoss: {
            type: "boolean",
            description:
              "Set true to remove the current stop-loss without setting a new one.",
          },
          takeProfits: {
            type: "array",
            description:
              "Optional replacement or appended TP ladder. Each item should include price and may include quantity or percentage.",
            items: {
              type: "object",
              properties: {
                price: {
                  type: "number",
                },
                quantity: {
                  type: "number",
                },
                percentage: {
                  type: "number",
                },
              },
              required: ["price"],
            },
          },
          replaceTakeProfits: {
            type: "boolean",
            description:
              "Defaults to true. When true, existing live/database TP targets are replaced before creating the new ladder.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "review_signal_thread",
      description:
        "Review the context around a trading signal thread. It can start from a tracked position, messageId, or processId, then returns related Discord context messages when available, processed-message records, drafts, linked positions, and process logs.",
      parameters: {
        type: "object",
        properties: {
          positionId: {
            type: "string",
            description: "Optional tracked position ID to anchor the review.",
          },
          accountId: {
            type: "string",
            description:
              "Optional account ID when reviewing by messageId without a positionId.",
          },
          messageId: {
            type: "string",
            description:
              "Optional source message ID when reviewing by raw signal message.",
          },
          processId: {
            type: "string",
            description:
              "Optional process ID to include linked process logs directly.",
          },
          limit: {
            type: "number",
            description:
              "Optional result limit for logs/messages. Default 20, max 100.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_process_logs",
      description:
        "Get process-aware logs filtered by processId. Returns chronological or reverse-chronological TradeLog entries, including action, symbol, details, result, error, and timestamp.",
      parameters: {
        type: "object",
        properties: {
          processId: {
            type: "string",
            description: "Required process ID to inspect.",
          },
          limit: {
            type: "number",
            description:
              "Optional max number of log entries. Default 50, max 200.",
          },
          order: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort order by createdAt. Default desc.",
          },
        },
        required: ["processId"],
      },
    },
  },
  ...positionOpsExtraTools,
];
