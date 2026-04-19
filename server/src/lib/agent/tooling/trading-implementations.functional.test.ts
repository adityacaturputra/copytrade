import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExchangeClient } from "@copytrade/shared/lib/exchange/types";

const { resolveExchangeContextMock } = vi.hoisted(() => ({
  resolveExchangeContextMock: vi.fn(),
}));

vi.mock("./shared", async () => {
  const actual = await vi.importActual<typeof import("./shared")>("./shared");
  return {
    ...actual,
    resolveExchangeContext: resolveExchangeContextMock,
  };
});

import { tradingToolImplementations } from "./trading-implementations";

function createExchangeMock(): ExchangeClient {
  return {
    name: "paper",
    getAccountInfo: vi.fn(),
    getTickerPrice: vi.fn(),
    getKlines: vi.fn(),
    getOpenPositions: vi.fn(),
    placeOrder: vi.fn(),
    closePosition: vi.fn(),
    closeAllPositions: vi.fn(),
    setLeverage: vi.fn(),
    placeStopLoss: vi.fn(),
    placeTakeProfit: vi.fn(),
    getOpenOrders: vi.fn(),
    cancelOrder: vi.fn(),
    getAlgoOrders: vi.fn(),
    cancelAlgoOrders: vi.fn(),
    getOrderHistory: vi.fn(),
    getInstrumentSpecs: vi.fn(),
  };
}

describe("tradingToolImplementations", () => {
  let exchange: ExchangeClient;

  beforeEach(() => {
    exchange = createExchangeMock();
    resolveExchangeContextMock.mockResolvedValue({
      exchange,
      accountId: "acct-1",
      accountName: "Paper",
      provider: "paper",
    });
  });

  it("places market orders and applies leverage first when requested", async () => {
    vi.mocked(exchange.setLeverage).mockResolvedValue(15);
    vi.mocked(exchange.placeOrder).mockResolvedValue({
      orderId: "ord-1",
      price: 0,
      quantity: 2,
      status: "FILLED",
    });

    const raw = await tradingToolImplementations.place_order({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 2,
      leverage: 15,
    });

    expect(exchange.setLeverage).toHaveBeenCalledWith("BTCUSDT", 15);
    expect(exchange.placeOrder).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: 2,
      price: undefined,
      leverage: 15,
    });
    expect(JSON.parse(raw)).toMatchObject({
      orderId: "ord-1",
      status: "FILLED",
    });
  });

  it("rounds limit prices before placing an order", async () => {
    vi.mocked(exchange.placeOrder).mockResolvedValue({
      orderId: "ord-2",
      price: 62000.13,
      quantity: 1.5,
      status: "NEW",
    });

    await tradingToolImplementations.place_order({
      symbol: "ETHUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: 1.5,
      price: 62000.129,
    });

    expect(exchange.setLeverage).not.toHaveBeenCalled();
    expect(exchange.placeOrder).toHaveBeenCalledWith({
      symbol: "ETHUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: 1.5,
      price: 62000.13,
      leverage: undefined,
    });
  });

  it("places rounded stop-loss orders", async () => {
    vi.mocked(exchange.placeStopLoss).mockResolvedValue("sl-123");

    const raw = await tradingToolImplementations.set_stop_loss({
      symbol: "BTCUSDT",
      triggerPrice: 61234.567,
      executePrice: 61230.111,
      side: "SELL",
      quantity: 0.75,
    });

    expect(exchange.placeStopLoss).toHaveBeenCalledWith(
      "BTCUSDT",
      61234.57,
      61230.11,
      "SELL",
      0.75,
    );
    expect(JSON.parse(raw)).toEqual({
      success: true,
      orderId: "sl-123",
      triggerPrice: 61234.57,
      executePrice: 61230.11,
    });
  });

  it("places rounded take-profit orders", async () => {
    vi.mocked(exchange.placeTakeProfit).mockResolvedValue("tp-321");

    const raw = await tradingToolImplementations.set_take_profit({
      symbol: "BTCUSDT",
      triggerPrice: 64555.559,
      executePrice: 64555.551,
      side: "SELL",
      quantity: 0.75,
    });

    expect(exchange.placeTakeProfit).toHaveBeenCalledWith(
      "BTCUSDT",
      64555.56,
      64555.55,
      "SELL",
      0.75,
    );
    expect(JSON.parse(raw)).toEqual({
      success: true,
      orderId: "tp-321",
      triggerPrice: 64555.56,
      executePrice: 64555.55,
    });
  });

  it("closes a single position with an optional partial quantity", async () => {
    vi.mocked(exchange.closePosition).mockResolvedValue(undefined);

    const raw = await tradingToolImplementations.close_position({
      symbol: "BTCUSDT",
      quantity: 0.25,
    });

    expect(exchange.closePosition).toHaveBeenCalledWith(
      "BTCUSDT",
      undefined,
      0.25,
    );
    expect(JSON.parse(raw)).toEqual({
      success: true,
      symbol: "BTCUSDT",
      quantity: 0.25,
    });
  });
});
