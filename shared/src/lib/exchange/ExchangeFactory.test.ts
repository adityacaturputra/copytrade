import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { PaperExchange } from "./paper/index";
import { ExchangeFactory } from "./ExchangeFactory";

test("ExchangeFactory creates account-scoped and paper clients", () => {
  assert.ok(ExchangeFactory.getPaperClient() instanceof PaperExchange);
  assert.ok(
    ExchangeFactory.getClientForAccount({
      provider: "binance",
      apiKey: "key",
      secretKey: "secret",
      simulated: true,
    }),
  );
});

test("ExchangeFactory deprecated helpers still behave predictably", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const client = ExchangeFactory.getClient();

  assert.ok(client instanceof PaperExchange);
  assert.equal(ExchangeFactory.getProviderName(), "paper");
  assert.doesNotThrow(() => ExchangeFactory.reset());
  assert.equal(warnSpy.mock.calls.length, 1);

  warnSpy.mockRestore();
});
