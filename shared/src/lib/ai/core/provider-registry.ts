import { GLMAnalyzer } from "../glm/analyzer";
import { KimiAnalyzer } from "../kimi/analyzer";
import { OpenAIAnalyzer } from "../openai/analyzer";
import { CodexPatunginAnalyzer } from "../codex-patungin/analyzer";
import { KonektikaAnalyzer } from "../konektika/analyzer";
import { NineRouterAnalyzer } from "../ninerouter/analyzer";
import type { AISignalAnalyzer } from "./types";

export type AIProvider =
  | "glm"
  | "kimi"
  | "openai"
  | "9router"
  | "codex"
  | "patungin"
  | "konektika";

export type AIProviderConfig = {
  provider: AIProvider;
  aliases?: string[];
  supportsVision?: boolean;
  isDefault?: boolean;
  getApiKeys: () => string[];
  getBaseURL: () => string | undefined;
  getModel: () => string;
  getHeaders?: () => Record<string, string> | undefined;
  createAnalyzer: () => AISignalAnalyzer;
};

function splitKeys(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const AI_PROVIDER_REGISTRY: Record<Exclude<AIProvider, "codex">, AIProviderConfig> = {
  glm: {
    provider: "glm",
    supportsVision: true,
    getApiKeys: () => splitKeys(process.env.GLM_API_KEY),
    getBaseURL: () => process.env.GLM_BASE_URL || "https://api.z.ai/api/coding/paas/v4",
    getModel: () => process.env.GLM_MODEL || "glm-4-flash",
    createAnalyzer: () => new GLMAnalyzer(),
  },
  kimi: {
    provider: "kimi",
    supportsVision: true,
    getApiKeys: () => splitKeys(process.env.ANTHROPIC_API_KEY),
    getBaseURL: () => process.env.ANTHROPIC_BASE_URL,
    getModel: () => process.env.ANTHROPIC_MODEL || "kimi-latest",
    createAnalyzer: () => new KimiAnalyzer(),
  },
  openai: {
    provider: "openai",
    supportsVision: true,
    getApiKeys: () => splitKeys(process.env.OPENAI_API_KEY),
    getBaseURL: () => process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    getModel: () => process.env.OPENAI_MODEL || "gpt-4o-mini",
    createAnalyzer: () => new OpenAIAnalyzer(),
  },
  "9router": {
    provider: "9router",
    supportsVision: true,
    getApiKeys: () => splitKeys(process.env.NINEROUTER_API_KEY),
    getBaseURL: () => process.env.NINEROUTER_BASE_URL || "http://localhost:20128/v1",
    getModel: () => process.env.NINEROUTER_MODEL || "vibe-coding",
    createAnalyzer: () => new NineRouterAnalyzer(),
  },
  patungin: {
    provider: "patungin",
    supportsVision: true,
    aliases: ["codex"],
    isDefault: true,
    getApiKeys: () => splitKeys(process.env.PATUNGIN_API_KEY || process.env.CODEX_PATUNGIN_API_KEY || process.env.COPYTRADE_PATUNGIN_API_KEY),
    getBaseURL: () => process.env.PATUNGIN_BASE_URL || process.env.CODEX_PATUNGIN_BASE_URL || process.env.COPYTRADE_PATUNGIN_BASE_URL || "https://ai.patungin.id/v1",
    getModel: () => process.env.PATUNGIN_MODEL || process.env.CODEX_PATUNGIN_MODEL || process.env.COPYTRADE_PATUNGIN_MODEL || "gpt-4o-mini",
    getHeaders: () => undefined,
    createAnalyzer: () => new CodexPatunginAnalyzer(),
  },
  konektika: {
    provider: "konektika",
    supportsVision: true,
    getApiKeys: () => splitKeys(process.env.KONEKTIKA_API_KEY),
    getBaseURL: () =>
      process.env.KONEKTIKA_BASE_URL || "https://konektikacloud.web.id/v1",
    getModel: () => process.env.KONEKTIKA_MODEL || "konektika-pro",
    createAnalyzer: () => new KonektikaAnalyzer(),
  },
};

const AI_PROVIDER_ALIASES: Record<string, AIProvider> = Object.fromEntries(
  Object.values(AI_PROVIDER_REGISTRY).flatMap((config) => [
    [config.provider, config.provider],
    ...(config.aliases || []).map((alias) => [alias, config.provider] as const),
  ]),
) as Record<string, AIProvider>;

export function normalizeAIProvider(value?: string | null): AIProvider {
  const normalized = (value || "").trim().toLowerCase();
  return AI_PROVIDER_ALIASES[normalized] || getDefaultAIProvider();
}

export function isKnownAIProvider(value?: string | null): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return normalized in AI_PROVIDER_ALIASES;
}

export function getAIProviderConfig(provider?: string | null): AIProviderConfig {
  return AI_PROVIDER_REGISTRY[normalizeAIProvider(provider) as Exclude<AIProvider, "codex">];
}

export function getDefaultAIProvider(): AIProvider {
  return Object.values(AI_PROVIDER_REGISTRY).find((config) => config.isDefault)?.provider || "glm";
}

export function parseFallbackAIProviders(
  raw = process.env.AI_PROVIDER_FALLBACK,
): AIProvider[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => isKnownAIProvider(value))
    .map((value) => normalizeAIProvider(value));
}

export function buildAIProviderChain(primary?: string | null): AIProvider[] {
  const root = normalizeAIProvider(primary || process.env.AI_PROVIDER);
  const seen = new Set<string>([root]);
  const chain: AIProvider[] = [root];
  for (const fallback of parseFallbackAIProviders()) {
    if (!seen.has(fallback)) {
      seen.add(fallback);
      chain.push(fallback);
    }
  }
  return chain;
}

export function supportsVisionForProvider(provider?: string | null): boolean {
  return Boolean(getAIProviderConfig(provider).supportsVision);
}

