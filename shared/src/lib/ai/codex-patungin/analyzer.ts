import { getCodexPatunginConfig } from "../codex-patungin/config";
import { OpenAICompatibleAnalyzerBase, type OpenAICompatibleMessageContent } from "../core/openai-compatible-base";

export class CodexPatunginAnalyzer extends OpenAICompatibleAnalyzerBase {
  private headers: Record<string, string>;

  constructor() {
    const cfg = getCodexPatunginConfig();
    super({
      providerName: "CodexPatungin",
      apiKeys: cfg.apiKey
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      baseURL: cfg.baseURL,
      model: cfg.model,
    });
    this.headers = cfg.headers || {};
  }

  protected getRetryableStatuses(): number[] {
    return [401, 403, 429, 402, 500];
  }

  protected getRetryableMessagePatterns(): string[] {
    return ["rate limit", "insufficient", "quota", "balance", "blocked", "permission"];
  }

  protected getRequestHeaders(apiKey: string): Record<string, string> {
    return {
      ...this.headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  protected buildRequestBody(
    systemPrompt: string,
    userContent: OpenAICompatibleMessageContent,
    maxTokens?: number,
  ): Record<string, unknown> {
    const payload = super.buildRequestBody(systemPrompt, userContent, maxTokens);
    
    // Codex/Patungin previously forced JSON mode when it wasn't vision
    // but the new base doesn't differentiate easily in buildRequestBody without mode.
    // However, the base classes parse correctly using standard format.
    // If we absolutely need response_format, we can inject it based on userContent type.
    if (typeof userContent === "string" || (Array.isArray(userContent) && userContent.every(c => c.type === "text"))) {
      payload.response_format = { type: "json_object" };
    }
    
    return payload;
  }
}
