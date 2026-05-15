import { OpenAIAnalyzer } from "../openai/analyzer";

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
}
