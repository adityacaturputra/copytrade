import {
  AISignalAnalyzer,
  BulkMessageInput,
  BulkSignalResult,
  PositionAnalysis,
  PositionAnalysisInput,
  TradingSignal,
} from "./types";
import { GLMAnalyzer } from "./GLMAnalyzer";
import { KimiAnalyzer } from "./KimiAnalyzer";
import { OpenAIAnalyzer } from "./OpenAIAnalyzer";
import { CodexPatunginAnalyzer } from "./CodexPatunginAnalyzer";
import { KonektikaAnalyzer } from "./KonektikaAnalyzer";
import { hasCodexPatunginCredentials } from "./CodexPatunginConfig";

export type AIProvider =
  | "glm"
  | "kimi"
  | "openai"
  | "codex"
  | "patungin"
  | "konektika";

/**
 * Fallback-aware AI Signal Analyzer.
 * Tries the primary provider first; on failure, falls through to the next
 * provider in the chain until one succeeds or all are exhausted.
 */
class FallbackAISignalAnalyzer implements AISignalAnalyzer {
  private analyzers: { provider: AIProvider; analyzer: AISignalAnalyzer }[];

  constructor(
    analyzers: { provider: AIProvider; analyzer: AISignalAnalyzer }[],
  ) {
    this.analyzers = analyzers;
  }

  get providerChain(): string {
    return this.analyzers.map((a) => a.provider).join(" → ");
  }

  private async runWithFallback<T>(
    operationName: "parseSignal" | "parseBulkSignals" | "analyzePosition",
    operation: (
      analyzer: AISignalAnalyzer,
      provider: AIProvider,
    ) => Promise<{ done: boolean; value?: T }>,
    buildNoResultError: () => Error,
    buildFailedError: (lastError: Error) => Error,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (const { provider, analyzer } of this.analyzers) {
      try {
        console.log(`[AI:${provider}] ${operationName} attempting`);
        const result = await operation(analyzer, provider);
        if (!result.done) {
          continue;
        }
        console.log(`[AI:${provider}] ${operationName} succeeded`);
        return result.value as T;
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[AI:${provider}] ${operationName} failed, trying next provider:`,
          lastError.message,
        );
      }
    }

    console.error(
      `[AI] All providers exhausted for ${operationName}: ${lastError?.message || "no successful result"}`,
    );

    if (!lastError) {
      throw buildNoResultError();
    }
    throw buildFailedError(lastError);
  }

  async parseSignal(message: string): Promise<TradingSignal | null> {
    return this.runWithFallback<TradingSignal>(
      "parseSignal",
      async (analyzer, provider) => {
        const result = await analyzer.parseSignal(message);
        if (!result) {
          console.warn(
            `[AI:${provider}] parseSignal returned null, trying next provider`,
          );
          return { done: false };
        }
        return { done: true, value: result };
      },
      () =>
        new Error(
          "All AI providers returned null for parseSignal (no actionable signal).",
        ),
      (lastError) =>
        new Error(
          `All AI providers failed for parseSignal. Last error: ${lastError.message || "Unknown error"}`,
        ),
    );
  }

  async parseBulkSignals(
    messages: BulkMessageInput[],
  ): Promise<BulkSignalResult[]> {
    return this.runWithFallback<BulkSignalResult[]>(
      "parseBulkSignals",
      async (analyzer, provider) => {
        const result = await analyzer.parseBulkSignals(messages);
        const signalCount = result.filter((item) => item.signal).length;
        if (signalCount === 0) {
          console.warn(
            `[AI:${provider}] parseBulkSignals returned no actionable signals, trying next provider`,
          );
          return { done: false };
        }
        console.log(
          `[AI:${provider}] parseBulkSignals succeeded with ${signalCount} signal(s)`,
        );
        return { done: true, value: result };
      },
      () =>
        new Error(
          "All AI providers returned no actionable signals for parseBulkSignals.",
        ),
      (lastError) =>
        new Error(
          `All AI providers failed for parseBulkSignals. Last error: ${lastError.message || "Unknown error"}`,
        ),
    );
  }

  async analyzePosition(
    input: PositionAnalysisInput,
  ): Promise<PositionAnalysis> {
    return this.runWithFallback<PositionAnalysis>(
      "analyzePosition",
      async (analyzer) => {
        const result = await analyzer.analyzePosition(input);
        return { done: true, value: result };
      },
      () =>
        new Error("All AI providers returned no result for analyzePosition."),
      (lastError) =>
        new Error(
          `All AI providers failed for analyzePosition. Last error: ${lastError.message || "Unknown error"}`,
        ),
    );
  }
}

/**
 * Parse comma-separated fallback providers from env.
 * e.g. AI_PROVIDER_FALLBACK="patungin,glm,kimi"
 */
function parseFallbackProviders(): AIProvider[] {
  const raw = process.env.AI_PROVIDER_FALLBACK;
  if (!raw || !raw.trim()) return [];

  const validProviders: AIProvider[] = [
    "glm",
    "kimi",
    "openai",
    "codex",
    "patungin",
    "konektika",
  ];

  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase() as AIProvider)
    .filter((p) => validProviders.includes(p));
}

function getDefaultProvider(): AIProvider {
  if (hasCodexPatunginCredentials()) return "patungin";
  return "glm";
}

/**
 * Build the provider chain: [primary, ...fallbacks (deduplicated)]
 */
function buildProviderChain(): AIProvider[] {
  const primary =
    (process.env.AI_PROVIDER as AIProvider) || getDefaultProvider();

  // Normalize codex → patungin
  const normalizedPrimary =
    primary === "codex" ? ("patungin" as AIProvider) : primary;

  const fallbacks = parseFallbackProviders();

  const seen = new Set<string>([normalizedPrimary]);
  const chain: AIProvider[] = [normalizedPrimary];

  for (const fb of fallbacks) {
    const normalized = fb === "codex" ? ("patungin" as AIProvider) : fb;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      chain.push(normalized);
    }
  }

  return chain;
}

export class AIFactory {
  private static instance: AISignalAnalyzer | null = null;

  static getAnalyzer(provider?: AIProvider): AISignalAnalyzer {
    if (AIFactory.instance) {
      return AIFactory.instance;
    }

    // Check if fallback is configured
    const fallbackProviders = parseFallbackProviders();

    if (fallbackProviders.length > 0) {
      const chain = buildProviderChain();
      const analyzers = chain
        .map((p) => {
          try {
            return {
              provider: p,
              analyzer: AIFactory.createAnalyzer(p),
            };
          } catch {
            console.warn(
              `[AIFactory] Failed to create analyzer for provider: ${p}, skipping.`,
            );
            return null;
          }
        })
        .filter(
          (a): a is { provider: AIProvider; analyzer: AISignalAnalyzer } =>
            a !== null,
        );

      if (analyzers.length === 0) {
        throw new Error(
          "No AI providers could be instantiated. Check your API keys.",
        );
      }

      const fallback = new FallbackAISignalAnalyzer(analyzers);
      console.log(
        `[AIFactory] Using fallback chain: ${fallback.providerChain}`,
      );
      AIFactory.instance = fallback;
      return fallback;
    }

    // Single provider mode (backward compatible)
    const selectedProvider =
      provider ||
      (process.env.AI_PROVIDER as AIProvider) ||
      getDefaultProvider();

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
      case "konektika":
        return new KonektikaAnalyzer();
      case "glm":
        return new GLMAnalyzer();
      default:
        console.warn(`Unknown AI provider: ${provider}, falling back to GLM`);
        return new GLMAnalyzer();
    }
  }

  static reset(): void {
    AIFactory.instance = null;
  }
}
