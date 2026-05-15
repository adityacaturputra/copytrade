import { Account } from "../database/index";
import { SourceType } from "../enums";
import type { ProcessTrackedMessage } from "./types";
import {
  DiscordSourceConfig,
  DiscordSourceProvider,
} from "../source/discord/index";

const NEARBY_SOURCE_CONTEXT_LIMIT = 6;
const NEARBY_SOURCE_CONTEXT_MAX_DIFF_MS = 90 * 1000;

type SourceAccountLike = {
  _id: { toString(): string };
  name: string;
  sourceType?: string;
  sourceData?: {
    method?: "bot" | "user";
    token?: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    autoRefresh?: boolean;
  };
};

function normalizeContextMessageText(message: {
  content?: string;
  originalContent?: string;
  imageUrls?: string[];
}): string {
  const original = message.originalContent?.trim();
  if (original) return original;

  const content = message.content?.trim();
  if (content) return content;

  const imageCount = message.imageUrls?.length || 0;
  if (imageCount > 0) {
    return `[no text content; ${imageCount} attachment${imageCount === 1 ? "" : "s"} only]`;
  }

  return "[empty message]";
}

export async function buildNearbySourceContext(
  msg: ProcessTrackedMessage,
): Promise<string> {
  if (!msg.sourceId || !msg.channelId || !msg.messageId) return "";

  const account = (await Account.findById(msg.sourceId).lean()) as
    | SourceAccountLike
    | null;

  if (
    !account ||
    account.sourceType !== SourceType.DISCORD ||
    !account.sourceData?.token ||
    !account.sourceData?.method
  ) {
    return "";
  }

  const provider = new DiscordSourceProvider();
  const discordConfig: DiscordSourceConfig = {
    _id: account._id.toString(),
    name: account.name,
    type: SourceType.DISCORD,
    channelIds: [msg.channelId],
    method: account.sourceData.method,
    token: account.sourceData.token,
    refreshToken: account.sourceData.refreshToken,
    tokenExpiresAt: account.sourceData.tokenExpiresAt,
    autoRefresh: account.sourceData.autoRefresh,
  };

  const messages = await provider.fetchMessageContext(
    discordConfig,
    msg.channelId,
    msg.messageId,
    NEARBY_SOURCE_CONTEXT_LIMIT,
  );

  if (messages.length <= 1) return "";

  const anchor =
    messages.find((message) => message.messageId === msg.messageId) || null;
  const anchorTimestamp = anchor?.timestamp || msg.timestamp || null;
  if (!anchorTimestamp) return "";

  const nearby = messages.filter((message) => {
    if (message.messageId === msg.messageId) return false;
    return (
      Math.abs(message.timestamp.getTime() - anchorTimestamp.getTime()) <=
      NEARBY_SOURCE_CONTEXT_MAX_DIFF_MS
    );
  });

  if (nearby.length === 0) return "";

  const lines = [
    "[NEARBY SOURCE MESSAGES]",
    "These are separate nearby messages from the same source/channel. A caption or setup note may be attached to the message before or after the main signal.",
  ];

  for (const message of nearby) {
    const diffMs = message.timestamp.getTime() - anchorTimestamp.getTime();
    const direction = diffMs < 0 ? "before" : "after";
    const diffSeconds = Math.round(Math.abs(diffMs) / 1000);
    const authorNote =
      message.author !== msg.author ? ` | note=different_author:${message.author}` : "";
    const imageNote =
      message.imageUrls.length > 0
        ? ` | attachments=${message.imageUrls.length}`
        : "";

    lines.push(
      `- nearby_${direction} ${diffSeconds}s${authorNote}${imageNote} | messageId=${message.messageId} | content=${normalizeContextMessageText(message)}`,
    );
  }

  lines.push("[END NEARBY SOURCE MESSAGES]");
  return lines.join("\n");
}
