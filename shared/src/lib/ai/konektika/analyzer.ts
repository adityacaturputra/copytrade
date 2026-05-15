import { OpenAICompatibleAnalyzerBase } from "../core/openai-compatible-base";

export class KonektikaAnalyzer extends OpenAICompatibleAnalyzerBase {
  constructor() {
    super({
      providerName: "Konektika",
      apiKeys: (process.env.KONEKTIKA_API_KEY || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
      baseURL:
        process.env.KONEKTIKA_BASE_URL || "https://konektikacloud.web.id/v1",
      model: process.env.KONEKTIKA_MODEL || "konektika-pro",
    });
  }

  protected getRetryableStatuses(): number[] {
    return [401, 403, 429, 402, 500];
  }

  protected getRetryableMessagePatterns(): string[] {
    return [
      "rate limit",
      "insufficient",
      "quota",
      "balance",
      "blocked",
      "permission",
    ];
  }
}
