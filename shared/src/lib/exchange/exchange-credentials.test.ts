import { test } from "vitest";
import assert from "node:assert/strict";
import { buildExchangeCredentials } from "./exchange-credentials";

test("buildExchangeCredentials returns null for unsupported providers", () => {
  assert.equal(buildExchangeCredentials("invalid", {}), null);
});

test("buildExchangeCredentials normalizes provider and keeps supported string fields", () => {
  assert.deepEqual(
    buildExchangeCredentials(" BINANCE ", {
      apiKey: "key",
      secretKey: "secret",
      passphrase: 123,
      simulated: true,
      baseUrl: "https://example.com",
      login: "user",
      password: "pass",
      server: "broker",
      platform: "mt5",
      bridgeToken: "token",
      ignored: { nested: true },
    }),
    {
      provider: "binance",
      apiKey: "key",
      secretKey: "secret",
      passphrase: undefined,
      simulated: true,
      baseUrl: "https://example.com",
      login: "user",
      password: "pass",
      server: "broker",
      platform: "mt5",
      bridgeToken: "token",
      ignored: { nested: true },
    },
  );
});
