import OpenAI from "openai";

export const account_marketTools: OpenAI.ChatCompletionTool[] = [
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
        "Get exchange account info for a trading account. The exchange provider is chosen from the selected account's tradingPlatform via ExchangeFactory. Returns JSON: { provider: string ('okx'|'binance'|'bybit'|'mexc'|'metatrader'|'paper'), totalBalance: number, availableBalance: number, unrealizedPnl: number, accountId: string, accountName: string }. If multiple trading accounts exist, pass accountId.",
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
        "Get the current mark price of a trading pair from the exchange selected by the account's tradingPlatform via ExchangeFactory. Symbol MUST match that exchange format: for OKX use 'BTC-USDT-SWAP' (instrument ID with dashes); for Binance/Bybit/MEXC use 'BTCUSDT' (no dashes); for MetaTrader use the broker symbol like 'XAUUSD', 'EURUSD', 'GBPUSD', or broker-specific suffix variants.",
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
              "Trading pair in exchange format. OKX examples: 'BTC-USDT-SWAP', 'ETH-USDT-SWAP'. Binance/Bybit/MEXC examples: 'BTCUSDT', 'RENDERUSDT'. MetaTrader examples: 'XAUUSD', 'EURUSD', 'GBPUSD', or broker-specific suffix variants.",
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
  }
];
