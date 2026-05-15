import Anthropic from "@anthropic-ai/sdk";
import {
  OpenAICompatibleAnalyzerBase,
  type OpenAICompatibleMessageContent,
} from "../core/openai-compatible-base";

export class KimiAnalyzer extends OpenAICompatibleAnalyzerBase {
  constructor() {
    super({
      providerName: "Kimi",
      apiKeys: (process.env.ANTHROPIC_API_KEY || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
      baseURL: process.env.ANTHROPIC_BASE_URL || "https://api.kimi.com/coding/",
      model: process.env.ANTHROPIC_MODEL || "kimi-latest",
    });
  }

  protected getRetryableStatuses(): number[] {
    return [402, 429];
  }

  protected getRetryableMessagePatterns(): string[] {
    return ["balance", "rate limit", "insufficient"];
  }

  protected async performCompletionRequest(
    apiKey: string,
    systemPrompt: string,
    userContent: OpenAICompatibleMessageContent,
    maxTokens: number,
    mode: "text" | "vision",
  ): Promise<string> {
    const client = new Anthropic({
      baseURL: this.baseURL,
      apiKey,
    });

    const message = await client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: this.toAnthropicContent(userContent, mode),
        },
      ],
    });

    const firstBlock = message.content.find((item) => item.type === "text");
    return firstBlock?.type === "text" ? firstBlock.text : "";
  }

  private toAnthropicContent(
    userContent: OpenAICompatibleMessageContent,
    mode: "text" | "vision",
  ): string | Array<{ type: "text"; text: string }> {
    if (typeof userContent === "string") {
      return userContent;
    }

    if (mode === "vision") {
      const flattenedText = userContent
        .map((part: { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }) =>
          part.type === "text"
            ? part.text
            : `[Image URL: ${part.image_url.url}]`,
        )
        .join("\n\n");
      return [{ type: "text", text: flattenedText }];
    }

    const textParts = userContent.filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    );

    return textParts.map((part) => ({ type: "text", text: part.text }));
  }
}
