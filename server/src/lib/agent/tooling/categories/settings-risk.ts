import OpenAI from "openai";

export const settings_riskTools: OpenAI.ChatCompletionTool[] = [
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
  }
];
