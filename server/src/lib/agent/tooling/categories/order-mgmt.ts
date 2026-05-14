import OpenAI from "openai";

export const order_mgmtTools: OpenAI.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_open_orders",
      description:
        "Get all open/pending orders on the exchange. Returns JSON array: [{ orderId: string, symbol: string, side: 'BUY'|'SELL', type: string, price: number|null, quantity: number, filledQuantity: number, status: string, createdAt: number|null }]. Use to see unfilled limit orders or conditional orders waiting to trigger.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
          symbol: {
            type: "string",
            description:
              "Optional: filter by symbol (e.g., 'BTC-USDT-SWAP'). If omitted, returns all open orders.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_order",
      description:
        "Cancel a specific open order on the exchange. Use get_open_orders first to find the orderId. Returns JSON: { success: boolean, orderId: string }.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
          orderId: {
            type: "string",
            description: "The orderId from get_open_orders to cancel",
          },
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format (e.g., 'BTC-USDT-SWAP')",
          },
        },
        required: ["orderId", "symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_all_orders",
      description:
        "Cancel ALL open/pending orders on the exchange. Returns JSON: { results: [{ orderId, symbol, success, error? }] }. ⚠️ This cancels every unfilled order!",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
          symbol: {
            type: "string",
            description:
              "Optional: only cancel orders for this symbol. If omitted, cancels ALL open orders across all symbols.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_algo_orders",
      description:
        "Get all pending algo/conditional orders (TP/SL) on the exchange. Returns JSON array: [{ orderId: string, symbol: string, side: 'BUY'|'SELL', type: 'tp'|'sl', triggerPrice: number, executePrice: number|null, quantity: number, status: string, createdAt: number|null }]. Use to check existing TP/SL orders before modifying them.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
          symbol: {
            type: "string",
            description:
              "Optional: filter by symbol. If omitted, returns all pending algo orders.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_algo_orders",
      description:
        "Cancel all pending algo/conditional orders (TP/SL) for a specific symbol. Returns JSON: { cancelled: string[] (list of cancelled order IDs), errors: string[] }. Use this before setting new TP/SL levels to avoid conflicts.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format (e.g., 'BTC-USDT-SWAP'). Required.",
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_stop_loss",
      description:
        "Modify the stop-loss for an existing position. This cancels all existing SL orders for the symbol and places a new one. IMPORTANT: You must provide the current position details — call get_exchange_positions first to get the correct side and quantity.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format (e.g., 'BTC-USDT-SWAP')",
          },
          newTriggerPrice: {
            type: "number",
            description:
              "New stop-loss trigger price. For LONG this must be BELOW current price. For SHORT this must be ABOVE current price.",
          },
          newExecutePrice: {
            type: "number",
            description:
              "New stop-loss execution price. Usually same as triggerPrice for market-like fill.",
          },
          side: {
            type: "string",
            enum: ["BUY", "SELL"],
            description:
              "CLOSING direction: SELL to close a LONG, BUY to close a SHORT",
          },
          quantity: {
            type: "number",
            description: "Position quantity. Get from get_exchange_positions.",
          },
        },
        required: [
          "symbol",
          "newTriggerPrice",
          "newExecutePrice",
          "side",
          "quantity",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_take_profit",
      description:
        "Modify the take-profit for an existing position. This cancels all existing TP orders for the symbol and places a new one. IMPORTANT: You must provide the current position details — call get_exchange_positions first to get the correct side and quantity.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
          symbol: {
            type: "string",
            description:
              "Trading pair in exchange format (e.g., 'BTC-USDT-SWAP')",
          },
          newTriggerPrice: {
            type: "number",
            description:
              "New take-profit trigger price. For LONG this must be ABOVE current price. For SHORT this must be BELOW current price.",
          },
          newExecutePrice: {
            type: "number",
            description:
              "New take-profit execution price. Usually same as triggerPrice for market-like fill.",
          },
          side: {
            type: "string",
            enum: ["BUY", "SELL"],
            description:
              "CLOSING direction: SELL to close a LONG, BUY to close a SHORT",
          },
          quantity: {
            type: "number",
            description: "Position quantity. Get from get_exchange_positions.",
          },
        },
        required: [
          "symbol",
          "newTriggerPrice",
          "newExecutePrice",
          "side",
          "quantity",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_history",
      description:
        "Get recent order history (filled, cancelled, rejected orders) from the exchange. Returns JSON array: [{ orderId, symbol, side, type, price, quantity, filledQuantity, fee, realizedPnl, status, createdAt, updatedAt }]. Useful for reviewing past trades and verifying executions.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
          symbol: {
            type: "string",
            description:
              "Optional: filter by symbol. If omitted, returns all recent orders.",
          },
          limit: {
            type: "number",
            description:
              "Max number of orders to return. Default: 20, max: 100.",
          },
        },
        required: [],
      },
    },
  }
];
