import OpenAI from "openai";

export const draftsTools: OpenAI.ChatCompletionTool[] = [
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
  }
];
