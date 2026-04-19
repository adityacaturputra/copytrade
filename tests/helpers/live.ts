function hasUsableValue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  if (!normalized) return false;

  return ![
    "your_openai_api_key_here",
    "your_glm_api_key_here",
    "your_anthropic_api_key_here",
    "your_patungin_api_key_here",
  ].includes(normalized);
}

export function isLiveIntegrationEnabled(): boolean {
  return process.env.ENABLE_LIVE_INTEGRATION_TESTS === "true";
}

export function isLiveExchangeEnabled(): boolean {
  return process.env.ENABLE_LIVE_EXCHANGE_TESTS === "true";
}

export function canRunLiveDbTest(): boolean {
  return isLiveIntegrationEnabled() && hasUsableValue(process.env.MONGODB_URI);
}

export function resolveLiveAiProvider():
  | "patungin"
  | "codex"
  | "openai"
  | "glm"
  | "kimi"
  | null {
  const configuredProvider = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (
    (configuredProvider === "patungin" || configuredProvider === "codex") &&
    hasUsableValue(process.env.PATUNGIN_API_KEY || process.env.CODEX_PATUNGIN_API_KEY)
  ) {
    return configuredProvider;
  }

  if (configuredProvider === "openai" && hasUsableValue(process.env.OPENAI_API_KEY)) {
    return "openai";
  }

  if (configuredProvider === "glm" && hasUsableValue(process.env.GLM_API_KEY)) {
    return "glm";
  }

  if (configuredProvider === "kimi" && hasUsableValue(process.env.ANTHROPIC_API_KEY)) {
    return "kimi";
  }

  if (
    hasUsableValue(process.env.PATUNGIN_API_KEY || process.env.CODEX_PATUNGIN_API_KEY)
  ) {
    return "patungin";
  }

  if (hasUsableValue(process.env.OPENAI_API_KEY)) return "openai";
  if (hasUsableValue(process.env.GLM_API_KEY)) return "glm";
  if (hasUsableValue(process.env.ANTHROPIC_API_KEY)) return "kimi";

  return null;
}
