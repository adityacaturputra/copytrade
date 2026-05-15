import {
  buildAIProviderChain,
  getAIProviderConfig,
  getDefaultAIProvider,
  isKnownAIProvider,
  normalizeAIProvider,
} from "@copytrade/shared/lib/ai/core/provider-registry";
import { getContextLimits } from "./context-manager";

export function resolveProviderConfig(provider?: string) {
  const normalized = normalizeAIProvider(
    provider || process.env.AI_PROVIDER || getDefaultAIProvider(),
  );
  const providerConfig = getAIProviderConfig(normalized);

  return {
    selectedProvider: normalized,
    baseURL: providerConfig.getBaseURL(),
    model: providerConfig.getModel(),
    providerHeaders: providerConfig.getHeaders?.(),
    apiKeys: providerConfig.getApiKeys(),
    contextLimits: getContextLimits(normalized),
  };
}

export function parseAgentFallbackProviders(primary: string): string[] {
  return buildAIProviderChain(primary).slice(1);
}

export function buildAgentProviderChain(provider?: string): string[] {
  return buildAIProviderChain(provider);
}
