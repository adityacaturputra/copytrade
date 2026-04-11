import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CodexPatunginConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

const DEFAULT_BASE_URL = "https://ai.patungin.id/v1";
const DEFAULT_MODEL = "gpt-5.3-codex";

let cachedConfig: CodexPatunginConfig | null = null;

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTomlString(block: string, key: string): string | undefined {
  const escapedKey = escapeRegExp(key);
  const match = block.match(
    new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"]*)"\\s*$`, "m"),
  );
  return match?.[1]?.trim();
}

function readCodexTomlConfig(): Partial<CodexPatunginConfig> {
  try {
    const configPath =
      process.env.CODEX_CONFIG_PATH ||
      path.join(os.homedir(), ".codex", "config.toml");

    if (!existsSync(configPath)) {
      return {};
    }

    const raw = readFileSync(configPath, "utf8");
    const model = extractTomlString(raw, "model");
    const modelProvider = extractTomlString(raw, "model_provider");

    if (!modelProvider) {
      return { model };
    }

    const sectionMatch = raw.match(
      new RegExp(
        `\\[model_providers\\.${escapeRegExp(modelProvider)}\\]([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`,
      ),
    );

    const section = sectionMatch?.[1] || "";

    return {
      model,
      baseURL: extractTomlString(section, "base_url"),
      apiKey: extractTomlString(section, "experimental_bearer_token"),
    };
  } catch {
    return {};
  }
}

/**
 * Resolve Codex/Patungin OpenAI-compatible config.
 * Priority: env vars > ~/.codex/config.toml > hardcoded defaults.
 */
export function getCodexPatunginConfig(): CodexPatunginConfig {
  if (cachedConfig) return cachedConfig;

  const tomlConfig = readCodexTomlConfig();

  cachedConfig = {
    apiKey: firstNonEmpty(
      process.env.PATUNGIN_API_KEY,
      process.env.CODEX_PATUNGIN_API_KEY,
      process.env.PATUNGIN_BEARER_TOKEN,
      tomlConfig.apiKey,
    ),
    baseURL:
      firstNonEmpty(
        process.env.PATUNGIN_BASE_URL,
        process.env.CODEX_PATUNGIN_BASE_URL,
        tomlConfig.baseURL,
      ) || DEFAULT_BASE_URL,
    model:
      firstNonEmpty(
        process.env.PATUNGIN_MODEL,
        process.env.CODEX_PATUNGIN_MODEL,
        process.env.CODEX_MODEL,
        tomlConfig.model,
      ) || DEFAULT_MODEL,
  };

  return cachedConfig;
}

export function resetCodexPatunginConfigCache(): void {
  cachedConfig = null;
}

export function hasCodexPatunginCredentials(): boolean {
  return Boolean(getCodexPatunginConfig().apiKey);
}
