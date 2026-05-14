import OpenAI from "openai";

export const orders_tradingTools: OpenAI.ChatCompletionTool[] = [
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
              "Trading pair in exchange format. OKX: 'BTC-USDT-SWAP'. Binance/Bybit/MEXC: 'BTCUSDT'. MetaTrader: 'XAUUSD', 'EURUSD', 'GBPUSD', or broker-specific suffix variants.",
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
  }
];
