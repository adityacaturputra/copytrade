import { OpenAICompatibleAnalyzerBase, type OpenAICompatibleMessageContent } from "../core/openai-compatible-base";

export class OpenAIAnalyzer extends OpenAICompatibleAnalyzerBase {
  constructor(options?: {
    apiKeys?: string[];
    baseURL?: string;
    model?: string;
    providerName?: string;
  }) {
    super({
      apiKeys:
        options?.apiKeys ||
        (process.env.OPENAI_API_KEY || "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      baseURL:
        options?.baseURL ||
        process.env.OPENAI_BASE_URL ||
        "https://api.openai.com/v1",
      model: options?.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
      providerName: options?.providerName || "OpenAI",
    });
  }

  protected getRetryableStatuses(): number[] {
    return [429, 402, 500];
  }

  protected getRetryableMessagePatterns(): string[] {
    return ["rate limit", "insufficient", "quota"];
  }

  protected buildRequestBody(
    systemPrompt: string,
    userContent: OpenAICompatibleMessageContent,
    maxTokens?: number,
  ): Record<string, unknown> {
    const payload = super.buildRequestBody(systemPrompt, userContent, maxTokens);
    
    if (typeof userContent === "string" || (Array.isArray(userContent) && userContent.every(c => c.type === "text"))) {
      payload.response_format = { type: "json_object" };
    }
    
    return payload;
  }
}
