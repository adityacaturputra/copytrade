import type {
  BulkMessageInput,
  BulkSignalResult,
  PositionAnalysisInput,
  TradingSignal,
} from "./types";

export type ImageUserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildBulkUserMessage(messages: BulkMessageInput[]): string {
  return messages
    .map((msg) => {
      let block = `---MESSAGE ${msg.messageId}---\n${msg.content}`;
      if (msg.imageUrls && msg.imageUrls.length > 0) {
        block += `\n[Attached Images: ${msg.imageUrls.join(", ")}]`;
      }
      block += `\n---END MESSAGE ${msg.messageId}---`;
      return block;
    })
    .join("\n\n");
}

export function collectUniqueImageUrls(
  messages: Array<{ imageUrls?: string[] | null }>,
): string[] {
  const seenUrls = new Set<string>();
  for (const msg of messages) {
    for (const url of msg.imageUrls || []) {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
      }
    }
  }
  return [...seenUrls];
}

export function buildImageUserContent(
  text: string,
  imageUrls: string[],
): ImageUserContentPart[] {
  return [
    { type: "text", text },
    ...imageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];
}

export async function fallbackBulkSignalParsing(
  messages: BulkMessageInput[],
  parseSignal: (message: string) => Promise<TradingSignal | null>,
): Promise<BulkSignalResult[]> {
  const fallbackResults: BulkSignalResult[] = [];
  for (const msg of messages) {
    try {
      const signal = await parseSignal(msg.content);
      fallbackResults.push({ messageId: msg.messageId, signal });
    } catch {
      fallbackResults.push({ messageId: msg.messageId, signal: null });
    }
  }
  return fallbackResults;
}

export function collectPositionContextImageUrls(
  input: PositionAnalysisInput,
): string[] {
  return collectUniqueImageUrls(input.discordContextMessages || []);
}
