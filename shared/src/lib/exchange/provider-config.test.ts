import { test } from "vitest";
import assert from "node:assert/strict";
import {
  exchangeProviderRequiresCredentials,
  getDefaultExchangeCredentialValues,
  getExchangeCredentialFieldConfig,
  getExchangeProviderConfig,
  getExchangeProviderCredentialFieldConfigs,
  getExchangeProviderCredentialFields,
  getExchangeProviderOptions,
  getMissingExchangeCredentialFields,
  isPaperExchangeProvider,
  maskExchangeDataForDisplay,
  normalizeExchangeProvider,
  validateExchangeCredentials,
} from "./provider-config";

test("provider config helpers normalize providers and expose options", () => {
  assert.equal(normalizeExchangeProvider(" BINANCE "), "binance");
  assert.equal(normalizeExchangeProvider("unknown"), null);
  assert.equal(getExchangeProviderConfig("paper")?.label, "Paper Trading");
  assert.equal(isPaperExchangeProvider("paper"), true);
  assert.equal(exchangeProviderRequiresCredentials("paper"), false);
  assert.equal(exchangeProviderRequiresCredentials("okx"), true);
  assert.ok(
    getExchangeProviderOptions().some((provider) => provider.provider === "bybit"),
  );
});

test("provider config exposes field metadata and defaults", () => {
  assert.equal(getExchangeCredentialFieldConfig("platform").defaultValue, "mt5");
  assert.deepEqual(
    getExchangeProviderCredentialFields("metatrader"),
    ["baseUrl", "login", "password", "server", "platform", "bridgeToken"],
  );
  assert.deepEqual(
    getExchangeProviderCredentialFieldConfigs("paper"),
    [],
  );
  assert.equal(getDefaultExchangeCredentialValues().platform, "mt5");
});

test("provider config masks and validates credentials", () => {
  assert.deepEqual(
    maskExchangeDataForDisplay("binance", {
      apiKey: "abcd1234",
      secretKey: "very-secret",
      simulated: true,
    }),
    {
      apiKey: "••••••••1234",
      secretKey: "••••••••",
      simulated: true,
    },
  );

  assert.deepEqual(
    getMissingExchangeCredentialFields("okx", {
      apiKey: "key",
      secretKey: " ",
      passphrase: "",
    }),
    ["secretKey", "passphrase"],
  );

  assert.deepEqual(validateExchangeCredentials("invalid"), {
    valid: false,
    error: "Invalid trading platform: invalid",
    missingFields: [],
  });

  assert.deepEqual(
    validateExchangeCredentials("binance", {
      apiKey: "key",
      secretKey: "secret",
    }),
    { valid: true, missingFields: [] },
  );

  const invalid = validateExchangeCredentials("okx", {
    apiKey: "key",
  });
  assert.equal(invalid.valid, false);
  assert.equal(
    invalid.error,
    "OKX secret key, passphrase are required",
  );
});
