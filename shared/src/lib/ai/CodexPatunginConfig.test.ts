import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import {
  getCodexPatunginConfig,
  hasCodexPatunginCredentials,
  resetCodexPatunginConfigCache,
} from "./CodexPatunginConfig";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.PATUNGIN_API_KEY;
  delete process.env.CODEX_PATUNGIN_API_KEY;
  delete process.env.PATUNGIN_BEARER_TOKEN;
  delete process.env.PATUNGIN_BASE_URL;
  delete process.env.CODEX_PATUNGIN_BASE_URL;
  delete process.env.PATUNGIN_MODEL;
  delete process.env.CODEX_PATUNGIN_MODEL;
  delete process.env.CODEX_MODEL;
  delete process.env.PATUNGIN_HTTP_REFERER;
  delete process.env.CODEX_PATUNGIN_HTTP_REFERER;
  delete process.env.FRONTEND_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.APP_URL;
  delete process.env.PATUNGIN_X_TITLE;
  delete process.env.CODEX_PATUNGIN_X_TITLE;
  delete process.env.PATUNGIN_ORIGIN;
  delete process.env.CODEX_PATUNGIN_ORIGIN;
  delete process.env.PATUNGIN_USER_AGENT;
  delete process.env.CODEX_PATUNGIN_USER_AGENT;
  delete process.env.PATUNGIN_EXTRA_HEADERS;
  delete process.env.CODEX_PATUNGIN_EXTRA_HEADERS;
  delete process.env.CODEX_CONFIG_PATH;
  resetCodexPatunginConfigCache();
});

afterEach(() => {
  resetCodexPatunginConfigCache();
  process.env = { ...originalEnv };
});

test("CodexPatunginConfig prefers environment variables and caches the resolved config", () => {
  process.env.PATUNGIN_API_KEY = "env-key";
  process.env.PATUNGIN_BASE_URL = "https://env.example/v1";
  process.env.PATUNGIN_MODEL = "env-model";
  process.env.FRONTEND_URL = "https://app.example/path";
  process.env.PATUNGIN_X_TITLE = "Env Title";
  process.env.PATUNGIN_USER_AGENT = "env-agent";
  process.env.PATUNGIN_EXTRA_HEADERS = JSON.stringify({
    "X-Extra": "extra",
  });

  const first = getCodexPatunginConfig();
  process.env.PATUNGIN_API_KEY = "changed-key";
  const second = getCodexPatunginConfig();

  assert.deepEqual(first, {
    apiKey: "env-key",
    baseURL: "https://env.example/v1",
    model: "env-model",
    headers: {
      "HTTP-Referer": "https://app.example/path",
      "X-Title": "Env Title",
      Origin: "https://app.example",
      "User-Agent": "env-agent",
      "X-Extra": "extra",
    },
  });
  assert.equal(second.apiKey, "env-key");
  assert.equal(hasCodexPatunginCredentials(), true);
});

test("CodexPatunginConfig falls back to CODEX config.toml and parses line-based extra headers", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "patungin-config-"));
  const configPath = path.join(tempDir, "config.toml");

  try {
    writeFileSync(
      configPath,
      [
        'model = "toml-model"',
        'model_provider = "patungin.dev"',
        "",
        "[model_providers.patungin.dev]",
        'base_url = "https://toml.example/v1"',
        'experimental_bearer_token = "toml-key"',
      ].join("\n"),
    );

    process.env.CODEX_CONFIG_PATH = configPath;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontend.example";
    process.env.CODEX_PATUNGIN_EXTRA_HEADERS =
      "X-Trace: 123;X-Mode=debug";

    const config = getCodexPatunginConfig();

    assert.deepEqual(config, {
      apiKey: "toml-key",
      baseURL: "https://toml.example/v1",
      model: "toml-model",
      headers: {
        "HTTP-Referer": "https://frontend.example",
        "X-Title": "copytrade",
        Origin: "https://frontend.example",
        "User-Agent": "copytrade-patungin/1.0",
        "X-Trace": "123",
        "X-Mode": "debug",
      },
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CodexPatunginConfig uses hardcoded defaults when no credentials are available", () => {
  process.env.PATUNGIN_HTTP_REFERER = "not-a-valid-url";
  process.env.CODEX_CONFIG_PATH = path.join(
    os.tmpdir(),
    "patungin-config-missing.toml",
  );

  const config = getCodexPatunginConfig();

  assert.deepEqual(config, {
    apiKey: "",
    baseURL: "https://ai.patungin.id/v1",
    model: "gpt-5.3-codex",
    headers: {
      "HTTP-Referer": "not-a-valid-url",
      "X-Title": "copytrade",
      "User-Agent": "copytrade-patungin/1.0",
    },
  });
  assert.equal(hasCodexPatunginCredentials(), false);
});
