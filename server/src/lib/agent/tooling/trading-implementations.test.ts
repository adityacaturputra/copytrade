import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const tradingMocks = vi.hoisted(() => ({
  resolveExchangeContext: vi.fn(),
  roundPrice: vi.fn(),
}));

vi.mock("./shared", () => ({
  resolveExchangeContext: tradingMocks.resolveExchangeContext,
  roundPrice: tradingMocks.roundPrice,
}));

import { tradingToolImplementations } from "./trading-implementations";

function createExchangeMock() {
  return {
    setLeverage: vi.fn(),
    placeOrder: vi.fn(),
    closePosition: vi.fn(),
    closeAllPositions: vi.fn(),
    placeStopLoss: vi.fn(),
    placeTakeProfit: vi.fn(),
    getKlines: vi.fn(),
  };
}

beforeEach(() => {
  tradingMocks.resolveExchangeContext.mockReset();
  tradingMocks.roundPrice.mockReset();
  tradingMocks.roundPrice.mockImplementation((value: number) =>
    Math.round(value * 100) / 100,
  );
});

test("trading implementations place orders and ignore leverage setup failures", async () => {
  const exchange = createExchangeMock();
  exchange.setLeverage.mockRejectedValue(new Error("already set"));
  exchange.placeOrder.mockResolvedValue({
    orderId: "ord-1",
    price: 123.46,
    quantity: 1,
    status: "open",
  });
  tradingMocks.resolveExchangeContext.mockResolvedValue({ exchange });

  const result = JSON.parse(
    await tradingToolImplementations.place_order({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 1,
      price: 123.456,
      leverage: 5,
    }),
  );

  assert.equal(result.orderId, "ord-1");
  assert.deepEqual(exchange.placeOrder.mock.calls[0][0], {
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    quantity: 1,
    price: 123.46,
    leverage: 5,
  });
});

test("trading implementations close positions, set leverage, and proxy exchange responses", async () => {
  const exchange = createExchangeMock();
  exchange.closeAllPositions.mockResolvedValue({ closed: ["BTCUSDT"], errors: [] });
  exchange.getKlines.mockResolvedValue([{ close: 1 }]);
  tradingMocks.resolveExchangeContext.mockResolvedValue({ exchange });

  const closed = JSON.parse(
    await tradingToolImplementations.close_position({
      symbol: "BTCUSDT",
      quantity: 0.5,
    }),
  );
  const closedAll = JSON.parse(
    await tradingToolImplementations.close_all_positions({}),
  );
  const leverage = JSON.parse(
    await tradingToolImplementations.set_leverage({
      symbol: "ETHUSDT",
      leverage: 10,
    }),
  );
  const klines = JSON.parse(
    await tradingToolImplementations.get_klines({
      symbol: "BTCUSDT",
      interval: "4h",
      limit: 10,
    }),
  );

  assert.deepEqual(closed, { success: true, symbol: "BTCUSDT", quantity: 0.5 });
  assert.deepEqual(closedAll, { closed: ["BTCUSDT"], errors: [] });
  assert.deepEqual(leverage, { success: true, symbol: "ETHUSDT", leverage: 10 });
  assert.deepEqual(klines, [{ close: 1 }]);
  assert.deepEqual(exchange.closePosition.mock.calls[0], ["BTCUSDT", undefined, 0.5]);
  assert.deepEqual(exchange.setLeverage.mock.calls[0], ["ETHUSDT", 10]);
  assert.deepEqual(exchange.getKlines.mock.calls[0], ["BTCUSDT", "4h", 10]);
});

test("trading implementations round and place stop loss and take profit orders", async () => {
  const exchange = createExchangeMock();
  exchange.placeStopLoss.mockResolvedValue("sl-1");
  exchange.placeTakeProfit.mockResolvedValue("tp-1");
  tradingMocks.resolveExchangeContext.mockResolvedValue({ exchange });

  const stopLoss = JSON.parse(
    await tradingToolImplementations.set_stop_loss({
      symbol: "BTCUSDT",
      triggerPrice: 99.991,
      executePrice: 99.111,
      side: "SELL",
      quantity: 1,
    }),
  );
  const takeProfit = JSON.parse(
    await tradingToolImplementations.set_take_profit({
      symbol: "BTCUSDT",
      triggerPrice: 110.556,
      executePrice: 110.444,
      side: "SELL",
      quantity: 1,
    }),
  );

  assert.deepEqual(stopLoss, {
    success: true,
    orderId: "sl-1",
    triggerPrice: 99.99,
    executePrice: 99.11,
  });
  assert.deepEqual(takeProfit, {
    success: true,
    orderId: "tp-1",
    triggerPrice: 110.56,
    executePrice: 110.44,
  });
});
