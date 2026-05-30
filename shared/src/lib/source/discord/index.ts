/**
 * Discord Source Provider
 *
 * Implements ISourceProvider for Discord (both bot and user token methods).
 * Extracted from the original src/lib/discord.ts to fit the source factory pattern.
 *
 * Re-exports all original Discord functions for backward compatibility.
 */

import axios from "axios";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { SourceType } from "../../enums/index";
import { buildHttpErrorMessage } from "../../http/error";
import {
  ISourceProvider,
  BaseSourceMessage,
  BaseSourceConfig,
  SourceHealthStatus,
} from "../types";

// ==================== Discord-Specific Types ====================

export interface DiscordSourceConfig extends BaseSourceConfig {
  type: "discord";
  method: "bot" | "user";
  token: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  autoRefresh?: boolean;
}

export interface DiscordMessage extends BaseSourceMessage {}

export interface TokenHealthStatus extends SourceHealthStatus {}

// ==================== Provider Implementation ====================

export class DiscordSourceProvider implements ISourceProvider {
  readonly name = "Discord";
  readonly type = SourceType.DISCORD;

  // Bot client cache (shared across instances — public for standalone functions)
  public static _botClients = new Map<string, Client>();

  async fetchMessages(
    config: BaseSourceConfig,
    fetchLimit: number = 10,
    timeWindowHours?: number,
    processedMessageIds?: Set<string>,
  ): Promise<BaseSourceMessage[]> {
    const discordConfig = config as DiscordSourceConfig;
    const allMessages: DiscordMessage[] = [];
    const cutoffTime = timeWindowHours
      ? new Date(Date.now() - timeWindowHours * 60 * 60 * 1000)
      : null;
    const knownIds = processedMessageIds || new Set<string>();

    for (const channelId of discordConfig.channelIds) {
      try {
        let cursor: string | undefined = undefined;
        let channelDone = false;

        while (!channelDone) {
          const messages: DiscordMessage[] =
            discordConfig.method === "user"
              ? await this.fetchViaUserToken(
                  discordConfig.token,
                  channelId,
                  fetchLimit,
                  cursor,
                )
              : await this.fetchViaBot(
                  discordConfig.token,
                  channelId,
                  fetchLimit,
                  cursor,
                );

          if (messages.length === 0) {
            channelDone = true;
            break;
          }

          for (const msg of messages) {
            msg.sourceId = discordConfig._id;
            msg.sourceName = discordConfig.name;

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
        const formattedError = buildHttpErrorMessage(
          `[DiscordSource] fetchMessages channel=${channelId}`,
          error,
        );
        console.error(
          `❌ Error fetching from source "${discordConfig.name}" channel ${channelId}: ${formattedError}`,
        );
        throw new Error(formattedError);
      }
    }

    // Sort DESCENDING by channelId + messageId (newest first)
    allMessages.sort((a, b) => {
      const channelCompare = a.channelId.localeCompare(b.channelId);
      if (channelCompare !== 0) return -channelCompare;
      return b.messageId.localeCompare(a.messageId);
    });

    return allMessages;
  }

  async checkHealth(config: BaseSourceConfig): Promise<SourceHealthStatus> {
    const discordConfig = config as DiscordSourceConfig;
    return checkTokenHealth(discordConfig.method, discordConfig.token);
  }

  async getChannelNames(
    channelIds: string[],
    config: BaseSourceConfig,
  ): Promise<Map<string, string>> {
    const discordConfig = config as DiscordSourceConfig;
    return fetchChannelNames(channelIds, [
      {
        token: discordConfig.token,
        method: discordConfig.method,
        channelIds: discordConfig.channelIds,
      },
    ]);
  }

  async fetchMessageContext(
    config: BaseSourceConfig,
    channelId: string,
    aroundMessageId: string,
    limit: number = 10,
  ): Promise<DiscordMessage[]> {
    const discordConfig = config as DiscordSourceConfig;

    const messages =
      discordConfig.method === "user"
        ? await this.fetchViaUserTokenContext(
            discordConfig.token,
            channelId,
            limit,
            aroundMessageId,
          )
        : await this.fetchViaBotContext(
            discordConfig.token,
            channelId,
            limit,
            aroundMessageId,
          );

    return messages
      .map((msg) => ({
        ...msg,
        sourceId: discordConfig._id,
        sourceName: discordConfig.name,
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // ==================== Bot Method ====================

  public static getBotClient(token: string): Client {
    if (!DiscordSourceProvider._botClients.has(token)) {
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });
      DiscordSourceProvider._botClients.set(token, client);
    }
    return DiscordSourceProvider._botClients.get(token)!;
  }

  private getBotClient(token: string): Client {
    return DiscordSourceProvider.getBotClient(token);
  }

  private async fetchViaBot(
    token: string,
    channelId: string,
    limit: number,
    before?: string,
  ): Promise<DiscordMessage[]> {
    const client = this.getBotClient(token);

    if (!client.isReady()) {
      await client.login(token);
      await new Promise<void>((resolve) => {
        if (client.isReady()) resolve();
        else client.once("ready", () => resolve());
      });
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error(
        `Channel ${channelId} not found or is not a text channel`,
      );
    }

    const messages: DiscordMessage[] = [];
    const fetched = await channel.messages.fetch({
      limit,
      ...(before ? { before } : {}),
    });

    for (const [, msg] of fetched) {
      const imageUrls = extractImageUrls(msg.attachments, msg.embeds, msg.content);
      
      // Also manually extract any TradingView links directly from text
      const tvUrls = extractTradingViewImageUrls(msg.content);
      for (const tvUrl of tvUrls) {
        if (!imageUrls.includes(tvUrl)) {
          imageUrls.push(tvUrl);
        }
      }

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

  private async fetchViaBotContext(
    token: string,
    channelId: string,
    limit: number,
    around: string,
  ): Promise<DiscordMessage[]> {
    const client = this.getBotClient(token);

    if (!client.isReady()) {
      await client.login(token);
      await new Promise<void>((resolve) => {
        if (client.isReady()) resolve();
        else client.once("ready", () => resolve());
      });
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
      throw new Error(
        `Channel ${channelId} not found or is not a text channel`,
      );
    }

    const messages: DiscordMessage[] = [];
    const fetched = await channel.messages.fetch({
      limit,
      around,
    });

    for (const [, msg] of fetched) {
      const imageUrls = extractImageUrls(msg.attachments, msg.embeds, msg.content);
      const tvRegex = /https?:\/\/(?:www\.)?tradingview\.com\/x\/([a-zA-Z0-9]+)\/?/g;
      let match;
      while ((match = tvRegex.exec(msg.content)) !== null) {
        if (match[1] && match[1].length > 0) {
          const tvUrl = `https://s3.tradingview.com/snapshots/${match[1].charAt(0).toLowerCase()}/${match[1]}.png`;
          if (!imageUrls.includes(tvUrl)) imageUrls.push(tvUrl);
        }
      }

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

  private async fetchViaUserToken(
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

  private async fetchViaUserTokenContext(
    token: string,
    channelId: string,
    limit: number,
    around: string,
  ): Promise<DiscordMessage[]> {
    const response = await axios.get(
      `https://discord.com/api/v9/channels/${channelId}/messages?limit=${limit}&around=${around}`,
      {
        headers: {
          Authorization: token,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        timeout: 15000,
      },
    );

    const rawMessages: DiscordRestMessage[] = response.data;
    const messages: DiscordMessage[] = [];

    for (const msg of rawMessages) {
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

    return messages;
  }
}

// ==================== Standalone Functions (backward compatibility) ====================
// These are exported for direct use by existing code that hasn't been migrated
// to the factory pattern yet.

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

/**
 * Fetch messages from a Discord source with pagination.
 * Kept for backward compatibility with executor.ts
 */
export async function fetchMessagesFromSource(
  source: DiscordSourceConfig,
  fetchLimit: number = 10,
  timeWindowHours?: number,
  processedMessageIds?: Set<string>,
): Promise<DiscordMessage[]> {
  const provider = new DiscordSourceProvider();
  return provider.fetchMessages(
    source,
    fetchLimit,
    timeWindowHours,
    processedMessageIds,
  ) as Promise<DiscordMessage[]>;
}

/**
 * Resolve channel IDs to channel names using Discord REST API.
 */
export async function fetchChannelNames(
  channelIds: string[],
  sources: Array<{ token: string; method: string; channelIds: string[] }>,
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (channelIds.length === 0) return nameMap;

  const idSet = new Set(channelIds);

  for (const source of sources) {
    if (idSet.size === 0) break;

    const sourceChannelIds = source.channelIds.filter((id) => idSet.has(id));
    if (sourceChannelIds.length === 0) continue;

    try {
      if (source.method === "user") {
        for (const chId of sourceChannelIds) {
          if (!idSet.has(chId)) continue;
          try {
            const res = await axios.get(
              `https://discord.com/api/v9/channels/${chId}`,
              {
                headers: {
                  Authorization: source.token,
                  "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                },
                timeout: 5000,
              },
            );
            const chName = res.data?.name;
            if (chName) {
              nameMap.set(chId, chName);
              idSet.delete(chId);
            }
          } catch (err) {
            console.warn(
              `Failed to fetch channel name for ${chId}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      } else if (source.method === "bot") {
        try {
          const client = DiscordSourceProvider.getBotClient(source.token);
          if (!client.isReady()) {
            await client.login(source.token);
            await new Promise<void>((resolve) => {
              if (client.isReady()) resolve();
              else client.once("ready", () => resolve());
            });
          }
          for (const chId of sourceChannelIds) {
            if (!idSet.has(chId)) continue;
            try {
              const channel = await client.channels.fetch(chId);
              if (channel && "name" in channel) {
                nameMap.set(chId, (channel as any).name);
                idSet.delete(chId);
              }
            } catch (err) {
              console.warn(
                `Failed to fetch channel name for ${chId}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }
        } catch (err) {
          console.warn(
            "Failed to initialize bot client for channel name resolution:",
            err instanceof Error ? err.message : err,
          );
        }
      }
    } catch (err) {
      console.warn(
        `Failed to resolve channel names via source:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return nameMap;
}

export async function disconnectDiscord(): Promise<void> {
  for (const [token, client] of DiscordSourceProvider._botClients.entries()) {
    if (client.isReady()) {
      await client.destroy();
    }
    DiscordSourceProvider._botClients.delete(token);
  }
}

// ==================== Internal Types ====================

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

// ==================== Helpers ====================

function stripDiscordQuotes(content: string): string {
  const lines = content.split("\n");
  const stripped: string[] = [];

  for (const line of lines) {
    if (/^>\s/.test(line)) continue;
    stripped.push(line);
  }

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
  content?: string,
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

  if (content) {
    const tvUrls = extractTradingViewImageUrls(content);
    for (const tvUrl of tvUrls) {
      if (!urls.includes(tvUrl)) urls.push(tvUrl);
    }
  }

  return urls;
}

export function extractTradingViewImageUrls(content: string): string[] {
  const urls: string[] = [];
  // Match https://www.tradingview.com/x/Ku5unqX3/ or similar
  const tvRegex = /https?:\/\/(?:www\.)?tradingview\.com\/x\/([a-zA-Z0-9]+)\/?/g;
  let match;
  while ((match = tvRegex.exec(content)) !== null) {
    const id = match[1];
    if (id && id.length > 0) {
      const firstLetter = id.charAt(0).toLowerCase();
      urls.push(`https://s3.tradingview.com/snapshots/${firstLetter}/${id}.png`);
    }
  }
  return urls;
}
