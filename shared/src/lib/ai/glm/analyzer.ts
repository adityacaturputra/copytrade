import { OpenAICompatibleAnalyzerBase } from "../core/openai-compatible-base";

export class GLMAnalyzer extends OpenAICompatibleAnalyzerBase {
  constructor() {
    super({
      providerName: "GLM",
      apiKeys: (process.env.GLM_API_KEY || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
      baseURL:
        process.env.GLM_BASE_URL || "https://api.z.ai/api/coding/paas/v4",
      model: process.env.GLM_MODEL || "glm-5.1",
    });
  }

  protected getRetryableStatuses(): number[] {
    return [429, 402];
  }

  protected getRetryableMessagePatterns(): string[] {
    return ["balance", "1113"];
  }
}
