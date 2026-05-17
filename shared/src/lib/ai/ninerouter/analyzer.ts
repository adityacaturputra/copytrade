import { OpenAIAnalyzer } from "../openai/analyzer";
import type { OpenAICompatibleMessageContent } from "../core/openai-compatible-base";

export class NineRouterAnalyzer extends OpenAIAnalyzer {
  constructor() {
    super({
      apiKeys: (process.env.NINEROUTER_API_KEY || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
      baseURL:
        process.env.NINEROUTER_BASE_URL || "http://localhost:20128/v1",
      model: process.env.NINEROUTER_MODEL || "vibe-coding",
      providerName: "9router",
    });
  }

  protected async parseCompletionResponse(response: Response): Promise<string> {
    const text = await response.text();
    const sseContent = extractSseAssistantContent(text);
    if (sseContent !== null) return sseContent;

    try {
      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content || "";
    } catch (error) {
      console.warn(
        `[9router] Unparseable completion payload (content-type=${response.headers.get("content-type") || "unknown"}): ${text.slice(0, 300)}`,
      );
      throw error;
    }
  }

  protected buildRequestBody(
    systemPrompt: string,
    userContent: OpenAICompatibleMessageContent,
    _maxTokens?: number,
  ): Record<string, unknown> {
    return {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    };
  }
}

function extractSseAssistantContent(payload: string): string | null {
  const normalized = payload.trim();
  if (!normalized || !normalized.includes("data:")) return null;

  const contents: string[] = [];
  let sawDone = false;
  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;

    const dataChunk = line.slice(5).trim();
    if (!dataChunk) continue;
    if (dataChunk === "[DONE]") {
      sawDone = true;
      continue;
    }

    try {
      const parsed = JSON.parse(dataChunk) as {
        choices?: Array<{
          delta?: { content?: string };
          message?: { content?: string };
        }>;
      };
      const choice = parsed.choices?.[0];
      const content = extractChoiceContent(choice);
      if (content) contents.push(content);
    } catch {
      return null;
    }
  }

  if (contents.length > 0) return contents.join("");
  return sawDone ? "" : null;
}

function extractChoiceContent(choice: {
  delta?: { content?: unknown };
  message?: { content?: unknown };
} | undefined): string {
  const rawContent = choice?.delta?.content ?? choice?.message?.content;
  if (typeof rawContent === "string") return rawContent;

  if (Array.isArray(rawContent)) {
    return rawContent
      .map((item) => {
        if (typeof item === "string") return item;
        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof (item as { text?: unknown }).text === "string"
        ) {
          return (item as { text: string }).text;
        }
        return "";
      })
      .join("");
  }

  return "";
}
