import OpenAI from "openai";

export const positionOpsExtraTools: OpenAI.ChatCompletionTool[] = [
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
      name: "cleanup_orphan_protection_orders",
      description:
        "Audit and optionally cancel stale TP/SL algo orders on an account when there is no matching tracked open/pending position and no live exchange position for the symbol. Use dryRun=true first to inspect orphan candidates, then dryRun=false to cancel them.",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description:
              "Optional trading account ID from get_trading_accounts. Required when multiple accounts are active.",
          },
          symbol: {
            type: "string",
            description:
              "Optional symbol filter to audit/clean only one symbol.",
          },
          dryRun: {
            type: "boolean",
            description:
              "Defaults to true. When false, the tool cancels the orphan protection orders it found.",
          },
        },
        required: [],
      },
    },
  },
];
