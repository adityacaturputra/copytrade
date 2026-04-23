import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExchangeClient,
  AlgoOrderInfo,
  OpenOrderInfo,
} from "@copytrade/shared/lib/exchange/types";

const { resolveExchangeContextMock, cancelAlgoOrdersByTypesMock } = vi.hoisted(() => ({
  resolveExchangeContextMock: vi.fn(),
  cancelAlgoOrdersByTypesMock: vi.fn(),
}));

vi.mock("./shared", async () => {
  const actual = await vi.importActual<typeof import("./shared")>("./shared");
  return {
    ...actual,
    resolveExchangeContext: resolveExchangeContextMock,
    cancelAlgoOrdersByTypes: cancelAlgoOrdersByTypesMock,
  };
});

import { orderManagementToolImplementations } from "./order-management-implementations";

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

describe("orderManagementToolImplementations", () => {
  let exchange: ExchangeClient;

  beforeEach(() => {
    exchange = createExchangeMock();
    resolveExchangeContextMock.mockResolvedValue({
      exchange,
      accountId: "acct-1",
      accountName: "Paper",
      provider: "paper",
    });
    cancelAlgoOrdersByTypesMock.mockResolvedValue({
      cancelled: [],
      errors: [],
    });
  });

  it("modifies stop-loss by cancelling existing SL algo orders first", async () => {
    vi.mocked(exchange.placeStopLoss).mockResolvedValue("sl-new");

    const raw = await orderManagementToolImplementations.modify_stop_loss({
      symbol: "BTCUSDT",
      newTriggerPrice: 60321.555,
      newExecutePrice: 60320.444,
      side: "SELL",
      quantity: 0.4,
    });

    expect(cancelAlgoOrdersByTypesMock).toHaveBeenCalledWith(exchange, "BTCUSDT", [
      "sl",
    ]);
    expect(exchange.placeStopLoss).toHaveBeenCalledWith(
      "BTCUSDT",
      60321.56,
      60320.44,
      "SELL",
      0.4,
    );
    expect(JSON.parse(raw)).toEqual({
      success: true,
      symbol: "BTCUSDT",
      newTriggerPrice: 60321.56,
      newExecutePrice: 60320.44,
      orderId: "sl-new",
    });
  });

  it("modifies take-profit by cancelling existing TP algo orders first", async () => {
    vi.mocked(exchange.placeTakeProfit).mockResolvedValue("tp-new");

    const raw = await orderManagementToolImplementations.modify_take_profit({
      symbol: "BTCUSDT",
      newTriggerPrice: 65321.555,
      newExecutePrice: 65320.444,
      side: "SELL",
      quantity: 0.4,
    });

    expect(cancelAlgoOrdersByTypesMock).toHaveBeenCalledWith(exchange, "BTCUSDT", [
      "tp",
    ]);
    expect(exchange.placeTakeProfit).toHaveBeenCalledWith(
      "BTCUSDT",
      65321.56,
      65320.44,
      "SELL",
      0.4,
    );
    expect(JSON.parse(raw)).toEqual({
      success: true,
      symbol: "BTCUSDT",
      newTriggerPrice: 65321.56,
      newExecutePrice: 65320.44,
      orderId: "tp-new",
    });
  });

  it("cancels all open orders and reports per-order failures", async () => {
    const orders: OpenOrderInfo[] = [
      {
        orderId: "ord-1",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        filledQuantity: 0,
        status: "NEW",
      },
      {
        orderId: "ord-2",
        symbol: "ETHUSDT",
        side: "SELL",
        type: "LIMIT",
        quantity: 2,
        filledQuantity: 0,
        status: "NEW",
      },
    ];
    vi.mocked(exchange.getOpenOrders).mockResolvedValue(orders);
    vi.mocked(exchange.cancelOrder)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("exchange timeout"));

    const raw = await orderManagementToolImplementations.cancel_all_orders({});
    const result = JSON.parse(raw);

    expect(result.total).toBe(2);
    expect(result.cancelled).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results).toEqual([
      { orderId: "ord-1", symbol: "BTCUSDT", success: true },
      {
        orderId: "ord-2",
        symbol: "ETHUSDT",
        success: false,
        error: "exchange timeout",
      },
    ]);
  });

  it("returns open algo orders unchanged from the exchange", async () => {
    const algoOrders: AlgoOrderInfo[] = [
      {
        orderId: "algo-1",
        symbol: "BTCUSDT",
        triggerPrice: 61000,
        executePrice: 61000,
        side: "SELL",
        type: "sl",
        quantity: 1,
        status: "live",
      },
    ];
    vi.mocked(exchange.getAlgoOrders).mockResolvedValue(algoOrders);

    const raw = await orderManagementToolImplementations.get_algo_orders({
      symbol: "BTCUSDT",
    });

    expect(exchange.getAlgoOrders).toHaveBeenCalledWith("BTCUSDT");
    expect(JSON.parse(raw)).toEqual(algoOrders);
  });

  it("proxies open-order reads, single-order cancels, algo cancels, and order history", async () => {
    const openOrders: OpenOrderInfo[] = [
      {
        orderId: "open-1",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        quantity: 1,
        filledQuantity: 0,
        status: "NEW",
      },
    ];
    vi.mocked(exchange.getOpenOrders).mockResolvedValue(openOrders);
    vi.mocked(exchange.cancelOrder).mockResolvedValue(true);
    vi.mocked(exchange.cancelAlgoOrders).mockResolvedValue({
      cancelled: ["algo-1"],
      errors: [],
    });
    vi.mocked(exchange.getOrderHistory).mockResolvedValue([
      {
        orderId: "hist-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "MARKET",
        price: 62000,
        quantity: 1,
        filledQuantity: 1,
        fee: 12,
        status: "FILLED",
        createdAt: 123,
      },
    ]);

    const openRaw = await orderManagementToolImplementations.get_open_orders({
      symbol: "BTCUSDT",
    });
    const cancelRaw = await orderManagementToolImplementations.cancel_order({
      orderId: "open-1",
      symbol: "BTCUSDT",
    });
    const cancelAlgoRaw = await orderManagementToolImplementations.cancel_algo_orders({
      symbol: "BTCUSDT",
    });
    const historyRaw = await orderManagementToolImplementations.get_order_history({
      symbol: "BTCUSDT",
      limit: 5,
    });

    expect(exchange.getOpenOrders).toHaveBeenCalledWith("BTCUSDT");
    expect(exchange.cancelOrder).toHaveBeenCalledWith("open-1", "BTCUSDT");
    expect(exchange.cancelAlgoOrders).toHaveBeenCalledWith("BTCUSDT");
    expect(exchange.getOrderHistory).toHaveBeenCalledWith("BTCUSDT", 5);
    expect(JSON.parse(openRaw)).toEqual(openOrders);
    expect(JSON.parse(cancelRaw)).toEqual({
      success: true,
      orderId: "open-1",
      symbol: "BTCUSDT",
    });
    expect(JSON.parse(cancelAlgoRaw)).toEqual({
      cancelled: ["algo-1"],
      errors: [],
    });
    expect(JSON.parse(historyRaw)).toEqual([
      {
        orderId: "hist-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "MARKET",
        price: 62000,
        quantity: 1,
        filledQuantity: 1,
        fee: 12,
        status: "FILLED",
        createdAt: 123,
      },
    ]);
  });
});
