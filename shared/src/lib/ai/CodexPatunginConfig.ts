import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CodexPatunginConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  headers: Record<string, string>;
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

function parseHeaderMap(raw?: string): Record<string, string> {
  if (!raw || !raw.trim()) return {};

  const text = raw.trim();

  // Preferred format: JSON object string
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && key.trim()) {
          headers[key.trim()] = value.trim();
        }
      }
      if (Object.keys(headers).length > 0) return headers;
    }
  } catch {
    // Fallback to line-based parsing below
  }

  // Fallback format: "Header: value" entries split by newlines/semicolon
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n|;/)) {
    const chunk = line.trim();
    if (!chunk) continue;
    const separatorIndex = chunk.includes(":")
      ? chunk.indexOf(":")
      : chunk.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!key || !value) continue;
    headers[key] = value;
  }

  return headers;
}

function resolvePatunginHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  const fallbackReferer = firstNonEmpty(
    process.env.FRONTEND_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    "http://localhost:3000",
  );

  const httpReferer = firstNonEmpty(
    process.env.PATUNGIN_HTTP_REFERER,
    process.env.CODEX_PATUNGIN_HTTP_REFERER,
    fallbackReferer,
  );
  if (httpReferer) headers["HTTP-Referer"] = httpReferer;

  const xTitle = firstNonEmpty(
    process.env.PATUNGIN_X_TITLE,
    process.env.CODEX_PATUNGIN_X_TITLE,
    "copytrade",
  );
  if (xTitle) headers["X-Title"] = xTitle;

  const origin = firstNonEmpty(
    process.env.PATUNGIN_ORIGIN,
    process.env.CODEX_PATUNGIN_ORIGIN,
  );
  if (origin) {
    headers.Origin = origin;
  } else {
    try {
      headers.Origin = new URL(httpReferer).origin;
    } catch {
      // Keep Origin unset if referer is not a valid URL.
    }
  }

  const userAgent = firstNonEmpty(
    process.env.PATUNGIN_USER_AGENT,
    process.env.CODEX_PATUNGIN_USER_AGENT,
    "copytrade-patungin/1.0",
  );
  if (userAgent) headers["User-Agent"] = userAgent;

  const extraHeaders = parseHeaderMap(
    firstNonEmpty(
      process.env.PATUNGIN_EXTRA_HEADERS,
      process.env.CODEX_PATUNGIN_EXTRA_HEADERS,
    ),
  );

  return {
    ...headers,
    ...extraHeaders,
  };
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
    headers: resolvePatunginHeaders(),
  };

  return cachedConfig;
}

export function resetCodexPatunginConfigCache(): void {
  cachedConfig = null;
}

export function hasCodexPatunginCredentials(): boolean {
  return Boolean(getCodexPatunginConfig().apiKey);
}
