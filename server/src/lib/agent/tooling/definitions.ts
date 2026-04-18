import OpenAI from "openai";
// OpenAI tool schemas for the agent loop.

export const agentTools: OpenAI.ChatCompletionTool[] = [
  // ─── Account & Market ──────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_trading_accounts",
      description:
        "List all active trading accounts from the Account table. Use this first when multiple accounts exist, then pass accountId to exchange tools.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_account_info",
      description:
        "Get exchange account info for a trading account. The exchange provider is chosen from the selected account's tradingPlatform via ExchangeFactory. Returns JSON: { provider: string ('okx'|'binance'|'mexc'|'paper'), totalBalance: number, availableBalance: number, unrealizedPnl: number, accountId: string, accountName: string }. If multiple trading accounts exist, pass accountId.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts. Required when multiple accounts are active.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ticker_price",
      description:
        "Get the current mark price of a trading pair from the exchange selected by the account's tradingPlatform via ExchangeFactory. Symbol MUST match that exchange format: for OKX use 'BTC-USDT-SWAP' (instrument ID with dashes); for Binance/MEXC use 'BTCUSDT' (no dashes).",
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
              "Trading pair in exchange format. OKX examples: 'BTC-USDT-SWAP', 'ETH-USDT-SWAP'. Binance/MEXC examples: 'BTCUSDT', 'RENDERUSDT'.",
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
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
        },
        required: [],
      },
    },
  },

  // ─── Orders & Trading ──────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "place_order",
      description:
        "Place a market or limit order on the selected account exchange. ⚠️ EXECUTES REAL TRADES — use with caution! If multiple trading accounts exist, pass accountId.",
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
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
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
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
        },
        required: [],
      },
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

  {
    type: "function",
    function: {
      name: "get_klines",
      description:
        "Get candlestick/kline data for technical analysis. Returns OHLCV data: [{ open, close, high, low, volume, time }]. Useful for analyzing price trends, support/resistance levels, and making informed trading decisions.",
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
              "Trading pair in exchange format (e.g., 'BTC-USDT-SWAP' for OKX, 'BTCUSDT' for MEXC)",
          },
          interval: {
            type: "string",
            description:
              "Candlestick interval. Common: '1m', '5m', '15m', '1h', '4h', '1d'. Default: '1h'.",
          },
          limit: {
            type: "number",
            description: "Number of candles to return. Default: 24, max: 100.",
          },
        },
        required: ["symbol"],
      },
    },
  },

  // ─── Order Management ──────────────────────────────────────────
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

  // ─── Signal Sources ────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_signal_sources",
      description:
        "List configured signal source accounts from Account settings. Uses account sourceType to indicate which SourceFactory provider applies. Returns JSON array: [{ accountId, name, sourceType: 'discord'|'telegram', providerName, channelIds, isActive, hasCredentials, lastFetchedAt, lastError }]. Use this first before source-specific health or fetch operations.",
      parameters: {
        type: "object",
        properties: {
          sourceType: {
            type: "string",
            enum: ["discord", "telegram"],
            description:
              "Optional filter by source provider type. If omitted, returns all configured source accounts.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_source_health",
      description:
        "Check source credential health through SourceFactory using the selected account's sourceType. If accountId is omitted, checks all matching source accounts. Returns JSON: { success, checked, results: [{ accountId, name, sourceType, health }] }.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional source account ID from get_signal_sources.",
          },
          sourceType: {
            type: "string",
            enum: ["discord", "telegram"],
            description:
              "Optional filter by provider type when accountId is omitted.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_source_messages",
      description:
        "Fetch recent raw messages from configured signal source accounts through SourceFactory. The provider is chosen from each account's sourceType, so Discord accounts use DiscordSourceProvider and Telegram accounts use TelegramSourceProvider. Returns per-account grouped messages with timestamps, channel IDs, message URLs, and image URLs.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional source account ID from get_signal_sources. If omitted, fetches from all active matching source accounts.",
          },
          sourceType: {
            type: "string",
            enum: ["discord", "telegram"],
            description:
              "Optional source provider filter when accountId is omitted.",
          },
          fetchLimit: {
            type: "number",
            description:
              "Max messages per source account to fetch. Default 10, max 50.",
          },
          timeWindowHours: {
            type: "number",
            description:
              "Optional freshness filter in hours. Example: 24 means only fetch messages from the last 24 hours.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_discord_sources",
      description:
        "Legacy alias for get_signal_sources filtered to Discord accounts. Returns configured Discord source accounts from Account settings, not a hardcoded provider list.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_signal_now",
      description:
        "Manually trigger a signal check cycle. This fetches latest messages from all active configured source accounts via SourceFactory, runs AI analysis to detect trading signals, then either creates draft trades (manual mode) or executes trades directly (auto mode). Returns JSON: { checked: number, signals: number, executed: number, drafts: number, errors: string[] }.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_telegram_sources",
      description:
        "Legacy alias for get_signal_sources filtered to Telegram accounts.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_telegram_source_health",
      description:
        "Legacy alias for check_source_health filtered to Telegram accounts.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional Telegram account ID from get_telegram_sources.",
          },
        },
        required: [],
      },
    },
  },

  // ─── Position Ops ───────────────────────────────────────────────
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
            description:
              "Preferred tracked position ID from the database.",
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
            description:
              "Preferred tracked position ID from the database.",
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
            description:
              "The management action to execute.",
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
            description:
              "Required process ID to inspect.",
          },
          limit: {
            type: "number",
            description:
              "Optional max number of log entries. Default 50, max 200.",
          },
          order: {
            type: "string",
            enum: ["asc", "desc"],
            description:
              "Sort order by createdAt. Default desc.",
          },
        },
        required: ["processId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_position_with_exchange",
      description:
        "Synchronize one tracked database position against the live exchange state. It refetches the exchange position, open orders, and algo orders for the symbol, updates the database snapshot fields, and marks the DB position closed if it no longer exists on the exchange.",
      parameters: {
        type: "object",
        properties: {
          positionId: {
            type: "string",
            description:
              "Preferred tracked position ID from the database.",
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
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts.",
          },
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
