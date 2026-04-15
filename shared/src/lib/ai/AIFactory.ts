import { AISignalAnalyzer } from "./types";
import { GLMAnalyzer } from "./GLMAnalyzer";
import { KimiAnalyzer } from "./KimiAnalyzer";
import { OpenAIAnalyzer } from "./OpenAIAnalyzer";
import { CodexPatunginAnalyzer } from "./CodexPatunginAnalyzer";
import { hasCodexPatunginCredentials } from "./CodexPatunginConfig";

export type AIProvider = "glm" | "kimi" | "openai" | "codex" | "patungin";

export class AIFactory {
  private static instance: AISignalAnalyzer | null = null;

  static getAnalyzer(provider?: AIProvider): AISignalAnalyzer {
    const selectedProvider =
      provider ||
      (process.env.AI_PROVIDER as AIProvider) ||
      (hasCodexPatunginCredentials() ? "patungin" : "glm");

    if (AIFactory.instance) {
      return AIFactory.instance;
    }

    const analyzer = AIFactory.createAnalyzer(selectedProvider);
    AIFactory.instance = analyzer;
    return analyzer;
  }

  private static createAnalyzer(provider: AIProvider): AISignalAnalyzer {
    switch (provider) {
      case "kimi":
        return new KimiAnalyzer();
      case "openai":
        return new OpenAIAnalyzer();
      case "codex":
      case "patungin":
        return new CodexPatunginAnalyzer();
      case "glm":
        return new GLMAnalyzer();
      default:
        // Fallback chain: try GLM first, then OpenAI, then Kimi
        console.warn(`Unknown AI provider: ${provider}, falling back to GLM`);
        return new GLMAnalyzer();
    }
  }

  static reset(): void {
    AIFactory.instance = null;
  }
}
