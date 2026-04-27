import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { PaperExchange } from "./PaperExchange";

beforeEach(() => {
  vi.restoreAllMocks();
});

test("PaperExchange prices and klines use symbol defaults and interval fallback", async () => {
  const exchange = new PaperExchange();
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
  const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

  assert.equal(await exchange.getTickerPrice("BTCUSDT"), 67500);
  assert.equal(await exchange.getTickerPrice("UNKNOWN"), 100);

  const klines = await exchange.getKlines("BTCUSDT", "weird", 3);
  assert.equal(klines.length, 3);
  assert.equal(klines[0].time, 1_700_000_000_000 - 2 * 3_600_000);
  assert.equal(klines[2].time, 1_700_000_000_000);

  randomSpy.mockRestore();
  nowSpy.mockRestore();
});

test("PaperExchange can open long positions, update leverage, and close them", async () => {
  const exchange = new PaperExchange();
  const priceSpy = vi
    .spyOn(exchange, "getTickerPrice")
    .mockResolvedValueOnce(100)
    .mockResolvedValueOnce(110)
    .mockResolvedValueOnce(110)
    .mockResolvedValueOnce(110);

  const order = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quantity: 2,
    leverage: 5,
  });

  assert.equal(order.status, "FILLED");
  let positions = await exchange.getOpenPositions();
  assert.equal(positions.length, 1);
  assert.equal(positions[0].side, "LONG");
  assert.equal(positions[0].leverage, 5);
  assert.equal(positions[0].unrealizedPnl, 100);

  await exchange.setLeverage("BTCUSDT", 7);
  positions = await exchange.getOpenPositions();
  assert.equal(positions[0].leverage, 7);

  await exchange.closePosition("BTCUSDT", positions[0].positionId);
  const account = await exchange.getAccountInfo();
  assert.equal(account.availableBalance, 10140);
  assert.equal((await exchange.getOpenPositions()).length, 0);

  priceSpy.mockRestore();
});

test("PaperExchange supports short positions, closeAllPositions, and insufficient-balance errors", async () => {
  const exchange = new PaperExchange();
  vi.spyOn(exchange, "getTickerPrice").mockResolvedValue(50);

  await exchange.placeOrder({
    symbol: "ETHUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: 1,
    leverage: 2,
  });
  await exchange.placeOrder({
    symbol: "SOLUSDT",
    side: "BUY",
    type: "MARKET",
    quantity: 1,
    leverage: 2,
  });

  const positions = await exchange.getOpenPositions();
  assert.equal(
    positions.some((position) => position.side === "SHORT"),
    true,
  );

  const closed = await exchange.closeAllPositions();
  assert.equal(closed.errors.length, 0);
  assert.equal(closed.closed.length, 2);

  await assert.rejects(
    () =>
      exchange.placeOrder({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: 1_000_000,
        leverage: 1,
      }),
    /Insufficient paper balance/,
  );
});

test("PaperExchange manages open orders, algo orders, history, and helper stubs", async () => {
  const exchange = new PaperExchange() as any;
  vi.spyOn(Date, "now").mockReturnValue(1234567890);

  exchange.openOrders = [
    {
      orderId: "o1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 1,
      filledQuantity: 0,
      status: "NEW",
    },
    {
      orderId: "o2",
      symbol: "ETHUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: 1,
      filledQuantity: 0,
      status: "NEW",
    },
  ];
  exchange.algoOrders = [
    {
      orderId: "a1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "sl",
      triggerPrice: 95,
      quantity: 1,
      status: "NEW",
    },
    {
      orderId: "a2",
      symbol: "ETHUSDT",
      side: "BUY",
      type: "tp",
      triggerPrice: 55,
      quantity: 1,
      status: "NEW",
    },
  ];
  exchange.orderHistory = [
    {
      orderId: "h1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      price: 100,
      quantity: 1,
      filledQuantity: 1,
      fee: 0,
      status: "FILLED",
      createdAt: 1,
    },
  ];

  assert.equal((await exchange.getOpenOrders()).length, 2);
  assert.equal((await exchange.getOpenOrders("BTCUSDT")).length, 1);
  assert.equal(await exchange.cancelOrder("o1", "BTCUSDT"), true);
  assert.equal(await exchange.cancelOrder("missing", "BTCUSDT"), false);

  assert.equal((await exchange.getAlgoOrders()).length, 2);
  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: ["a1"],
    errors: [],
  });
  assert.equal((await exchange.getAlgoOrders()).length, 1);

  assert.equal((await exchange.getOrderHistory()).length, 1);
  assert.equal((await exchange.getOrderHistory("BTCUSDT")).length, 1);

  const slId = await exchange.placeStopLoss("BTCUSDT", 90, 90, "SELL", 1);
  const tpId = await exchange.placeTakeProfit("BTCUSDT", 120, 120, "SELL", 1);
  assert.equal(slId, "paper_sl_1234567890");
  assert.equal(tpId, "paper_tp_1234567890");

  assert.deepEqual(await exchange.getInstrumentSpecs("BTCUSDT"), {
    ctVal: 1,
    lotSz: 1,
    minSz: 1,
    ctValCcy: "",
    tickSz: 0.01,
    qtyDecimals: 2,
    priceDecimals: 2,
  });
});

test("PaperExchange throws when closing a missing position", async () => {
  const exchange = new PaperExchange();

  await assert.rejects(
    () => exchange.closePosition("BTCUSDT"),
    /No paper position found/,
  );
});

test("PaperExchange account info, symbol-only close, and filtered order helpers cover remaining branches", async () => {
  const exchange = new PaperExchange() as any;
  const priceSpy = vi
    .spyOn(exchange, "getTickerPrice")
    .mockImplementation(async (symbol: string) => {
      if (symbol === "BTCUSDT") return 120;
      if (symbol === "ETHUSDT") return 40;
      return 100;
    });

  exchange.positions.set("1", {
    symbol: "BTCUSDT",
    positionId: "1",
    side: "LONG",
    leverage: 2,
    marginType: "cross",
    entryPrice: 100,
    quantity: 1,
    margin: 50,
    liquidationPrice: 0,
    createdAt: new Date(),
  });
  exchange.positions.set("2", {
    symbol: "ETHUSDT",
    positionId: "2",
    side: "SHORT",
    leverage: 2,
    marginType: "cross",
    entryPrice: 50,
    quantity: 1,
    margin: 25,
    liquidationPrice: 0,
    createdAt: new Date(),
  });

  const account = await exchange.getAccountInfo();
  assert.equal(account.unrealizedPnl, 30);
  assert.equal(account.totalBalance, 10030);

  exchange.algoOrders = [
    {
      orderId: "algo-btc",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "sl",
      triggerPrice: 90,
      quantity: 1,
      status: "NEW",
    },
    {
      orderId: "algo-eth",
      symbol: "ETHUSDT",
      side: "BUY",
      type: "tp",
      triggerPrice: 45,
      quantity: 1,
      status: "NEW",
    },
  ];
  exchange.orderHistory = [
    {
      orderId: "hist-eth",
      symbol: "ETHUSDT",
      side: "SELL",
      type: "MARKET",
      price: 50,
      quantity: 1,
      filledQuantity: 1,
      fee: 0,
      status: "FILLED",
      createdAt: 1,
    },
  ];

  assert.deepEqual(
    (await exchange.getAlgoOrders("ETHUSDT")).map((row: { orderId: string }) => row.orderId),
    ["algo-eth"],
  );
  assert.deepEqual(
    (await exchange.getOrderHistory("ETHUSDT")).map((row: { orderId: string }) => row.orderId),
    ["hist-eth"],
  );

  await exchange.closePosition("BTCUSDT");
  assert.equal((await exchange.getOpenPositions()).some((row: { symbol: string }) => row.symbol === "BTCUSDT"), false);

  priceSpy.mockRestore();
});

test("PaperExchange closeAllPositions records unknown close failures", async () => {
  const exchange = new PaperExchange() as any;

  exchange.positions.set("1", {
    symbol: "BTCUSDT",
    positionId: "1",
    side: "LONG",
    leverage: 2,
    marginType: "cross",
    entryPrice: 100,
    quantity: 1,
    margin: 50,
    liquidationPrice: 0,
    createdAt: new Date(),
  });

  exchange.closePosition = async () => {
    throw "boom";
  };

  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: [],
    errors: ["BTCUSDT: Unknown"],
  });
});
