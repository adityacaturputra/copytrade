import OpenAI from "openai";

export const signal_sourcesTools: OpenAI.ChatCompletionTool[] = [
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
            description: "Optional source account ID from get_signal_sources.",
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
  }
];
