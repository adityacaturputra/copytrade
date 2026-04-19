import { test } from "vitest";
import assert from "node:assert/strict";
import { BybitExchange } from "./BybitExchange";

test("Bybit setLeverage ensures isolated margin mode before setting leverage", async () => {
  const exchange = new BybitExchange("key", "secret") as any;
  const calls: Array<{
    method: string;
    path: string;
    payload: Record<string, unknown>;
  }> = [];

  exchange.signedRequest = async (
    method: string,
    path: string,
    payload: Record<string, unknown>,
  ) => {
    calls.push({ method, path, payload });
    return {};
  };

  const result = await exchange.setLeverage("BTCUSDT", 7);

  assert.equal(result, 7);
  assert.deepEqual(
    calls.map((item) => item.path),
    [
      "/v5/account/set-margin-mode",
      "/v5/position/switch-isolated",
      "/v5/position/set-leverage",
    ],
  );
  assert.equal(calls[0]?.payload.setMarginMode, "ISOLATED_MARGIN");
  assert.equal(calls[1]?.payload.tradeMode, 1);
  assert.equal(calls[2]?.payload.buyLeverage, "7");
  assert.equal(calls[2]?.payload.sellLeverage, "7");
});
