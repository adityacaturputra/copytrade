import axios from "axios";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";

export interface DiscordMessage {
  messageId: string;
  channelId: string;
  author: string;
  content: string;
  originalContent?: string; // full content before quote stripping
  timestamp: Date;
  messageUrl: string;
  imageUrls: string[];
  isReply?: boolean;
  sourceId?: string;
  sourceName?: string;
}

export interface DiscordSourceConfig {
  _id: string;
  name: string;
  method: "bot" | "user";
  token: string;
  channelIds: string[];
  refreshToken?: string;
  tokenExpiresAt?: Date;
  autoRefresh?: boolean;
}

export interface TokenHealthStatus {
  valid: boolean;
  error?: string;
  expiresIn?: number; // ms until expiry
  needsRefresh: boolean;
}

// ==================== Token Health Check ====================

/**
 * Validate a Discord token by making a lightweight API call.
 * Works for both bot and user tokens.
 */
export async function checkTokenHealth(
  method: "bot" | "user",
  token: string,
): Promise<TokenHealthStatus> {
  try {
    const authHeader = method === "bot" ? `Bot ${token}` : token;

    const response = await axios.get("https://discord.com/api/v9/users/@me", {
      headers: {
        Authorization: authHeader,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
      timeout: 10000,
    });

    // Check if token has expiry info (not always available)
    const expiresIn = response.headers["x-ratelimit-reset"]
      ? parseInt(response.headers["x-ratelimit-reset"]) * 1000 - Date.now()
      : undefined;

    return {
      valid: true,
      expiresIn,
      needsRefresh: false,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;

      if (status === 401) {
        return {
          valid: false,
          error: "Token is invalid or expired (401 Unauthorized)",
          needsRefresh: true,
        };
      }
      if (status === 403) {
        return {
          valid: false,
          error: "Token lacks required permissions (403 Forbidden)",
          needsRefresh: false,
        };
      }
      if (status === 429) {
        // Rate limited - token is valid but throttled
        return {
          valid: true,
          error: "Rate limited (429) - token is valid but throttled",
          needsRefresh: false,
          expiresIn: 0,
        };
      }
      return {
        valid: false,
        error: `HTTP ${status}: ${message}`,
        needsRefresh: status === 401,
      };
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
      needsRefresh: false,
    };
  }
}

// ==================== Multi-Source Fetching ====================

/**
 * Fetch messages from a specific Discord source (token + channels).
 * This is the primary method used by the executor.
 */
/**
 * Fetch messages from a Discord source with pagination.
 *
 * `fetchLimit` is the **page size** per Discord API call. We keep paginating
 * backwards (older messages) until one of these stop conditions is met:
 *   1. A message ID is found in `processedMessageIds` (already saved to DB)
 *   2. A message timestamp is older than `timeWindowHours`
 *   3. No more messages returned by Discord
 *
 * Returns messages sorted DESCENDING (newest first).
 */
export async function fetchMessagesFromSource(
  source: DiscordSourceConfig,
  fetchLimit: number = 10,
  timeWindowHours?: number,
  processedMessageIds?: Set<string>,
): Promise<DiscordMessage[]> {
  const allMessages: DiscordMessage[] = [];
  const cutoffTime = timeWindowHours
    ? new Date(Date.now() - timeWindowHours * 60 * 60 * 1000)
    : null;
  const knownIds = processedMessageIds || new Set<string>();

  for (const channelId of source.channelIds) {
    try {
      let cursor: string | undefined = undefined; // snowflake ID for "before" param
      let channelDone = false;

      while (!channelDone) {
        const messages: DiscordMessage[] =
          source.method === "user"
            ? await fetchViaUserToken(
                source.token,
                channelId,
                fetchLimit,
                cursor,
              )
            : await fetchViaBot(source.token, channelId, fetchLimit, cursor);

        if (messages.length === 0) {
          channelDone = true;
          break;
        }

        for (const msg of messages) {
          msg.sourceId = source._id;
          msg.sourceName = source.name;

          // Stop condition 1: message already in DB
          if (knownIds.has(msg.messageId)) {
            channelDone = true;
            break;
          }

          // Stop condition 2: message outside time window
          if (cutoffTime && msg.timestamp < cutoffTime) {
            channelDone = true;
            break;
          }

          allMessages.push(msg);
        }

        // Set cursor to oldest message for next page
        if (!channelDone && messages.length > 0) {
          cursor = messages[messages.length - 1].messageId;
        }
      }
    } catch (error) {
      console.error(
        `❌ Error fetching from source "${source.name}" channel ${channelId}:`,
        error instanceof Error ? error.message : error,
      );
      // Re-throw so executor can update source health
      throw error;
    }
  }

  // Sort DESCENDING by channelId + messageId (newest first) for display
  // Discord message IDs are snowflakes that are chronologically sortable
  allMessages.sort((a, b) => {
    const channelCompare = a.channelId.localeCompare(b.channelId);
    if (channelCompare !== 0) return -channelCompare; // descending channel
    return b.messageId.localeCompare(a.messageId); // descending messageId (newest first)
  });

  return allMessages;
}

// ==================== Legacy Public API (env-based fallback) ====================

/**
 * Fetch messages using env config (fallback when no DB sources configured).
 */
export async function fetchRecentMessages(
  channelId?: string,
  limit: number = 10,
): Promise<DiscordMessage[]> {
  const method = getDiscordMethod();
  const channelIdToUse = channelId || process.env.DISCORD_CHANNEL_ID;

  if (!channelIdToUse) {
    throw new Error("DISCORD_CHANNEL_ID is not configured");
  }

  console.log(`📡 Fetching messages via ${method} method (env config)...`);

  if (method === "user") {
    return fetchViaUserToken(
      process.env.DISCORD_USER_TOKEN!,
      channelIdToUse,
      limit,
    );
  }
  return fetchViaBot(process.env.DISCORD_BOT_TOKEN!, channelIdToUse, limit);
}

// ==================== Method Detection (env fallback) ====================

type DiscordMethod = "bot" | "user";

function getDiscordMethod(): DiscordMethod {
  const userToken = process.env.DISCORD_USER_TOKEN;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (userToken) return "user";
  if (botToken) return "bot";

  throw new Error(
    "Configure Discord sources in Settings or set DISCORD_BOT_TOKEN/DISCORD_USER_TOKEN in .env",
  );
}

// ==================== Bot Method ====================

const _botClients = new Map<string, Client>();

function getBotClient(token: string): Client {
  if (!_botClients.has(token)) {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    _botClients.set(token, client);
  }
  return _botClients.get(token)!;
}

async function fetchViaBot(
  token: string,
  channelId: string,
  limit: number,
  before?: string,
): Promise<DiscordMessage[]> {
  const client = getBotClient(token);

  if (!client.isReady()) {
    await client.login(token);
    await new Promise<void>((resolve) => {
      if (client.isReady()) resolve();
      else client.once("ready", () => resolve());
    });
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or is not a text channel`);
  }

  const messages: DiscordMessage[] = [];
  const fetched = await channel.messages.fetch({
    limit,
    ...(before ? { before } : {}),
  });

  for (const [, msg] of fetched) {
    // Include bot messages — trading signals often come from mirror/relay bots
    const imageUrls = extractImageUrls(msg.attachments, msg.embeds);

    // Strip Discord reply quote blocks
    const isReply = msg.content.includes("> ");
    const stripped = stripDiscordQuotes(msg.content);

    messages.push({
      messageId: msg.id,
      channelId: msg.channelId,
      author: msg.author.username,
      content: stripped,
      originalContent: stripped !== msg.content ? msg.content : undefined,
      timestamp: msg.createdAt,
      messageUrl: msg.url,
      imageUrls,
      isReply,
    });
  }

  return messages;
}

// ==================== User Token Method (REST API) ====================

interface DiscordRestMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: {
    username: string;
    bot?: boolean;
  };
  attachments: {
    url: string;
    content_type?: string;
  }[];
  embeds: {
    image?: { url: string };
    thumbnail?: { url: string };
  }[];
}

async function fetchViaUserToken(
  token: string,
  channelId: string,
  limit: number,
  before?: string,
): Promise<DiscordMessage[]> {
  console.log(
    `📨 Fetching messages via user token for channel ${channelId} (limit: ${limit})...`,
  );

  const beforeParam = before ? `&before=${before}` : "";
  const response = await axios.get(
    `https://discord.com/api/v9/channels/${channelId}/messages?limit=${limit}${beforeParam}`,
    {
      headers: {
        Authorization: token,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
      timeout: 15000,
    },
  );

  const rawMessages: DiscordRestMessage[] = response.data;
  console.log(
    `📨 Discord API returned ${rawMessages.length} raw messages for channel ${channelId}`,
  );

  const messages: DiscordMessage[] = [];

  for (const msg of rawMessages) {
    // Include bot messages — trading signals often come from mirror/relay bots

    const imageUrls: string[] = [];
    for (const att of msg.attachments) {
      if (
        att.content_type?.startsWith("image/") ||
        /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(att.url)
      ) {
        imageUrls.push(att.url);
      }
    }
    for (const embed of msg.embeds) {
      if (embed.image?.url) imageUrls.push(embed.image.url);
      if (embed.thumbnail?.url) imageUrls.push(embed.thumbnail.url);
    }

    // Strip Discord reply quote blocks (lines starting with "> ")
    // These are quoted portions of the message being replied to,
    // not the actual new content from the author.
    const isReply = msg.content.includes("> ");
    const stripped = stripDiscordQuotes(msg.content);

    messages.push({
      messageId: msg.id,
      channelId: msg.channel_id,
      author: msg.author.username,
      content: stripped,
      originalContent: stripped !== msg.content ? msg.content : undefined,
      timestamp: new Date(msg.timestamp),
      messageUrl: `https://discord.com/channels/@me/${msg.channel_id}/${msg.id}`,
      imageUrls,
      isReply,
    });
  }

  console.log(
    `📨 Result: ${messages.length} messages (including bot messages) for channel ${channelId}`,
  );

  if (messages.length > 0) {
    console.log(
      `📨 Sample: [${messages[0].author}] ${messages[0].content.substring(0, 80)}...`,
    );
  }

  return messages;
}

// ==================== Helpers ====================

/**
 * Strip Discord reply quote blocks from message content.
 * Discord reply quotes appear as lines starting with "> " (often with a link).
 * We remove these quoted lines and keep only the author's actual new text.
 */
function stripDiscordQuotes(content: string): string {
  const lines = content.split("\n");
  const stripped: string[] = [];

  for (const line of lines) {
    // Skip lines that are Discord reply quotes: "> text" or "> [text](url)"
    if (/^>\s/.test(line)) continue;
    stripped.push(line);
  }

  // Trim and collapse multiple blank lines that may result from stripping
  return stripped
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractImageUrls(
  attachments:
    | Map<string, { url: string; contentType?: string | null }>
    | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  embeds: any[],
): string[] {
  const urls: string[] = [];

  if (attachments) {
    for (const [, att] of attachments) {
      if (
        att.contentType?.startsWith("image/") ||
        /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(att.url)
      ) {
        urls.push(att.url);
      }
    }
  }

  for (const embed of embeds) {
    if (embed.image?.url) urls.push(embed.image.url);
    if (embed.thumbnail?.url) urls.push(embed.thumbnail.url);
  }

  return urls;
}

export async function disconnectDiscord(): Promise<void> {
  for (const [token, client] of _botClients.entries()) {
    if (client.isReady()) {
      await client.destroy();
    }
    _botClients.delete(token);
  }
}
