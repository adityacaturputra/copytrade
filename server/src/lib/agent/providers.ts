import { getCodexPatunginConfig } from "@copytrade/shared/lib/ai/CodexPatunginConfig";
import { getContextLimits } from "./context-manager";

export function resolveProviderConfig(provider?: string) {
  const codexPatunginCfg = getCodexPatunginConfig();
  const selectedProvider = (
    provider ||
    process.env.AI_PROVIDER ||
    (codexPatunginCfg.apiKey ? "patungin" : "glm")
  )
    .toLowerCase()
    .trim();

  const normalized =
    selectedProvider === "codex" ? "patungin" : selectedProvider;

  const rawApiKey =
    normalized === "kimi"
      ? process.env.ANTHROPIC_API_KEY
      : normalized === "openai"
        ? process.env.OPENAI_API_KEY
        : normalized === "patungin"
          ? codexPatunginCfg.apiKey
          : normalized === "konektika"
            ? process.env.KONEKTIKA_API_KEY
            : process.env.GLM_API_KEY;

  const baseURL =
    normalized === "kimi"
      ? process.env.ANTHROPIC_BASE_URL || "https://api.kimi.com/coding/"
      : normalized === "openai"
        ? process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
        : normalized === "patungin"
          ? codexPatunginCfg.baseURL
          : normalized === "konektika"
            ? process.env.KONEKTIKA_BASE_URL ||
              "https://konektikacloud.web.id/v1"
            : process.env.GLM_BASE_URL || "https://api.z.ai/api/coding/paas/v4";

  const model =
    normalized === "kimi"
      ? process.env.ANTHROPIC_MODEL || "kimi-latest"
      : normalized === "openai"
        ? process.env.OPENAI_MODEL || "gpt-4o-mini"
        : normalized === "patungin"
          ? codexPatunginCfg.model
          : normalized === "konektika"
            ? process.env.KONEKTIKA_MODEL || "konektika-pro"
            : process.env.GLM_MODEL || "glm-4-flash";

  const providerHeaders =
    normalized === "patungin" ? codexPatunginCfg.headers : undefined;

  const apiKeys = (rawApiKey || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    selectedProvider: normalized,
    baseURL,
    model,
    providerHeaders,
    apiKeys,
    contextLimits: getContextLimits(normalized),
  };
}

export function parseAgentFallbackProviders(primary: string): string[] {
  const raw = process.env.AI_PROVIDER_FALLBACK;
  if (!raw || !raw.trim()) return [];
  const valid = new Set([
    "glm",
    "kimi",
    "openai",
    "codex",
    "patungin",
    "konektika",
  ]);
  const normalizedPrimary = primary === "codex" ? "patungin" : primary;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((p) => valid.has(p))
    .map((p) => (p === "codex" ? "patungin" : p))
    .filter((p) => p !== normalizedPrimary);
}

export function buildAgentProviderChain(provider?: string): string[] {
  const config = resolveProviderConfig(provider);
  const primary = config.selectedProvider;
  const fallbacks = parseAgentFallbackProviders(primary);
  const seen = new Set<string>([primary]);
  const chain = [primary];
  for (const fb of fallbacks) {
    if (!seen.has(fb)) {
      seen.add(fb);
      chain.push(fb);
    }
  }
  return chain;
}
