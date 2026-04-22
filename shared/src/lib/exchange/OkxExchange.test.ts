import { test } from "vitest";
import assert from "node:assert/strict";
import { OkxExchange } from "./OkxExchange";
import { ExchangeOrderType, OrderSide } from "../enums";

test("okx order failures include payload in thrown error messages", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  exchange.accountConfigCache = {
    posMode: "long_short_mode",
    ts: Date.now(),
  };

  exchange.validateInstrument = async () => ({
    instId: "BTC-USDT-SWAP",
    ctVal: "1",
    lotSz: "1",
    minSz: "1",
  });
  exchange.setLeverage = async () => {};

  exchange.client.post = async () => ({
    data: {
      code: "1",
      msg: "Parameter error",
      data: [{ sCode: "51001", sMsg: "General parameter error" }],
    },
  });

  await assert.rejects(
    exchange.placeOrder({
      symbol: "BTCUSDT",
      side: OrderSide.BUY,
      type: ExchangeOrderType.MARKET,
      quantity: 1,
      leverage: 5,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /OKX order failed: \[51001\] General parameter error/);
      assert.match(
        error.message,
        /\| payload=\{"instId":"BTC-USDT-SWAP","tdMode":"isolated","side":"buy","ordType":"market","sz":"1","posSide":"long"\}/,
      );
      return true;
    },
  );
});

test("okx posSide errors trigger auto-fix retry", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  exchange.accountConfigCache = {
    posMode: "long_short_mode",
    ts: Date.now(),
  };

  exchange.validateInstrument = async () => ({
    instId: "BTC-USDT-SWAP",
    ctVal: "1",
    lotSz: "1",
    minSz: "1",
  });
  exchange.setLeverage = async () => {};
  exchange.getTickerPrice = async () => 65000;

  let ensured = 0;
  exchange.ensureAccountConfigured = async () => {
    ensured += 1;
  };

  let postCalls = 0;
  exchange.client.post = async () => {
    postCalls += 1;
    if (postCalls === 1) {
      return {
        data: {
          code: "1",
          msg: "Parameter error",
          data: [{ sCode: "51000", sMsg: "Parameter posSide error" }],
        },
      };
    }

    return {
      data: {
        code: "0",
        data: [{ sCode: "0", ordId: "order-123" }],
      },
    };
  };

  const result = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 1,
    leverage: 5,
  });

  assert.equal(ensured, 1);
  assert.equal(result.orderId, "order-123");
});

test("okx net mode omits posSide from order payload", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.accountConfigCache = {
    posMode: "net_mode",
    ts: Date.now(),
  };
  exchange.validateInstrument = async () => ({
    instId: "BTC-USDT-SWAP",
    ctVal: "1",
    lotSz: "1",
    minSz: "1",
  });
  exchange.setLeverage = async (symbol: string, leverage: number) => leverage;
  exchange.getTickerPrice = async () => 65000;

  let payload: Record<string, string> | undefined;
  exchange.client.post = async (_path: string, body: string) => {
    payload = JSON.parse(body);
    return {
      data: {
        code: "0",
        data: [{ sCode: "0", ordId: "order-net-1" }],
      },
    };
  };

  const result = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 1,
    leverage: 5,
  });

  assert.equal(result.orderId, "order-net-1");
  assert.ok(payload);
  assert.equal(payload?.instId, "BTC-USDT-SWAP");
  assert.equal(payload?.side, "buy");
  assert.equal("posSide" in (payload || {}), false);
});

test("okx setLeverage applies leverage to both sides in hedge mode", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  const bodies: Array<Record<string, string>> = [];

  exchange.accountConfigCache = {
    posMode: "long_short_mode",
    ts: Date.now(),
  };
  exchange.client.post = async (_path: string, body: string) => {
    bodies.push(JSON.parse(body));
    return { data: { code: "0" } };
  };

  const result = await exchange.setLeverage("BTCUSDT", 8);

  assert.equal(result, 8);
  assert.deepEqual(bodies, [
    {
      instId: "BTC-USDT-SWAP",
      lever: "8",
      mgnMode: "isolated",
      posSide: "long",
    },
    {
      instId: "BTC-USDT-SWAP",
      lever: "8",
      mgnMode: "isolated",
      posSide: "short",
    },
  ]);
});

test("okx closePosition falls back to an opposite market order when close-position fails", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  const calls: Array<{ path: string; payload: Record<string, string> }> = [];

  exchange.accountConfigCache = {
    posMode: "long_short_mode",
    ts: Date.now(),
  };
  exchange.getOpenPositions = async () => [
    {
      symbol: "BTCUSDT",
      positionId: "pos-1",
      side: "LONG",
      leverage: 5,
      marginType: "isolated",
      entryPrice: 60000,
      quantity: 2,
      margin: 100,
      unrealizedPnl: 5,
      liquidationPrice: 50000,
      markPrice: 61000,
      raw: {},
    },
  ];
  exchange.client.post = async (path: string, body: string) => {
    calls.push({ path, payload: JSON.parse(body) });
    if (path === "/api/v5/trade/close-position") {
      return {
        data: {
          code: "1",
          msg: "close failed",
          data: [{ sCode: "51000", sMsg: "fallback" }],
        },
      };
    }

    return {
      data: {
        code: "0",
        data: [{ sCode: "0" }],
      },
    };
  };

  await exchange.closePosition("BTCUSDT", "pos-1", 1.5);

  assert.deepEqual(calls, [
    {
      path: "/api/v5/trade/close-position",
      payload: {
        instId: "BTC-USDT-SWAP",
        mgnMode: "isolated",
        type: "market",
        sz: "1.5",
        side: "sell",
        tdMode: "isolated",
        posSide: "long",
      },
    },
    {
      path: "/api/v5/trade/order",
      payload: {
        instId: "BTC-USDT-SWAP",
        tdMode: "isolated",
        side: "sell",
        ordType: "market",
        sz: "1.5",
        reduceOnly: "true",
        posSide: "long",
      },
    },
  ]);
});

test("okx stop loss and take profit build conditional algo payloads from closing side", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  const payloads: Array<Record<string, string>> = [];

  exchange.accountConfigCache = {
    posMode: "long_short_mode",
    ts: Date.now(),
  };
  exchange.client.post = async (_path: string, body: string) => {
    payloads.push(JSON.parse(body));
    return {
      data: {
        code: "0",
        data: [{ algoId: `algo-${payloads.length}` }],
      },
    };
  };

  const slId = await exchange.placeStopLoss(
    "BTCUSDT",
    60000,
    59950,
    OrderSide.SELL,
    2,
  );
  const tpId = await exchange.placeTakeProfit(
    "BTCUSDT",
    70000,
    69950,
    OrderSide.BUY,
    1,
  );

  assert.equal(slId, "algo-1");
  assert.equal(tpId, "algo-2");
  assert.deepEqual(payloads, [
    {
      instId: "BTC-USDT-SWAP",
      tdMode: "isolated",
      side: "sell",
      ordType: "conditional",
      sz: "2",
      slTriggerPx: "60000",
      slOrdPx: "59950",
      posSide: "long",
    },
    {
      instId: "BTC-USDT-SWAP",
      tdMode: "isolated",
      side: "buy",
      ordType: "conditional",
      sz: "1",
      tpTriggerPx: "70000",
      tpOrdPx: "69950",
      posSide: "short",
    },
  ]);
});

test("okx cancelAlgoOrders returns mixed batch cancellation results", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.getAlgoOrders = async () => [
    { orderId: "algo-1" },
    { orderId: "algo-2" },
  ];
  exchange.client.post = async () => ({
    data: {
      code: "0",
      data: [
        { algoId: "algo-1", sCode: "0" },
        { algoId: "algo-2", sCode: "1", sMsg: "busy" },
      ],
    },
  });

  const result = await exchange.cancelAlgoOrders("BTCUSDT");

  assert.deepEqual(result, {
    cancelled: ["algo-1"],
    errors: ["algo-2: busy"],
  });
});

test("okx normalizes open orders, algo orders, and history rows", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.client.get = async (path: string) => {
    if (path.includes("orders-pending")) {
      return {
        data: {
          code: "0",
          data: [
            {
              ordId: "ord-1",
              instId: "BTC-USDT-SWAP",
              side: "buy",
              ordType: "limit",
              px: "65000",
              sz: "2",
              accFillSz: "0.5",
              state: "live",
              cTime: "100",
            },
          ],
        },
      };
    }

    if (path.includes("orders-algo-pending")) {
      return {
        data: {
          code: "0",
          data: [
            {
              algoId: "algo-1",
              instId: "BTC-USDT-SWAP",
              side: "sell",
              ordType: "conditional",
              tpTriggerPx: "70000",
              tpOrdPx: "69950",
              sz: "1",
              state: "live",
              cTime: "200",
            },
          ],
        },
      };
    }

    return {
      data: {
        code: "0",
        data: [
          {
            ordId: "hist-1",
            instId: "BTC-USDT-SWAP",
            side: "sell",
            ordType: "market",
            px: "64000",
            sz: "3",
            accFillSz: "3",
            fee: "-2.5",
            pnl: "15",
            state: "filled",
            cTime: "300",
            uTime: "301",
          },
        ],
      },
    };
  };

  const openOrders = await exchange.getOpenOrders("BTCUSDT");
  const algoOrders = await exchange.getAlgoOrders("BTCUSDT");
  const history = await exchange.getOrderHistory("BTCUSDT", 5);

  assert.deepEqual(openOrders, [
    {
      orderId: "ord-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "limit",
      price: 65000,
      quantity: 2,
      filledQuantity: 0.5,
      status: "live",
      createdAt: 100,
      raw: {
        ordId: "ord-1",
        instId: "BTC-USDT-SWAP",
        side: "buy",
        ordType: "limit",
        px: "65000",
        sz: "2",
        accFillSz: "0.5",
        state: "live",
        cTime: "100",
      },
    },
  ]);
  assert.deepEqual(algoOrders, [
    {
      orderId: "algo-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "tp",
      triggerPrice: 70000,
      executePrice: 69950,
      quantity: 1,
      status: "live",
      createdAt: 200,
      raw: {
        algoId: "algo-1",
        instId: "BTC-USDT-SWAP",
        side: "sell",
        ordType: "conditional",
        tpTriggerPx: "70000",
        tpOrdPx: "69950",
        sz: "1",
        state: "live",
        cTime: "200",
      },
    },
  ]);
  assert.deepEqual(history, [
    {
      orderId: "hist-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "market",
      price: 64000,
      quantity: 3,
      filledQuantity: 3,
      fee: 2.5,
      realizedPnl: 15,
      status: "filled",
      createdAt: 300,
      updatedAt: 301,
      raw: {
        ordId: "hist-1",
        instId: "BTC-USDT-SWAP",
        side: "sell",
        ordType: "market",
        px: "64000",
        sz: "3",
        accFillSz: "3",
        fee: "-2.5",
        pnl: "15",
        state: "filled",
        cTime: "300",
        uTime: "301",
      },
    },
  ]);
});

test("okx getInstrumentSpecs caches parsed instrument metadata", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  let calls = 0;
  exchange.client.get = async () => {
    calls += 1;
    return {
      data: {
        code: "0",
        data: [
          {
            lotSz: "0.010",
            tickSz: "0.10",
            ctVal: "0.001",
            minSz: "1",
            ctValCcy: "BTC",
          },
        ],
      },
    };
  };

  const first = await exchange.getInstrumentSpecs("BTCUSDT");
  const second = await exchange.getInstrumentSpecs("BTCUSDT");

  assert.equal(calls, 1);
  assert.deepEqual(first, {
    ctVal: 0.001,
    lotSz: 0.01,
    minSz: 1,
    ctValCcy: "BTC",
    tickSz: 0.1,
    qtyDecimals: 2,
    priceDecimals: 1,
  });
  assert.deepEqual(second, first);
});

test("okx account and market data helpers normalize responses", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.client.get = async (path: string) => {
    if (path === "/api/v5/account/balance") {
      return {
        data: {
          code: "0",
          data: [
            {
              totalEq: "1000",
              details: [{ ccy: "USDT", availBal: "750", upl: "25" }],
            },
          ],
        },
      };
    }

    if (path.includes("/market/ticker")) {
      return {
        data: {
          code: "0",
          data: [{ last: "65000.5" }],
        },
      };
    }

    return {
      data: {
        code: "0",
        data: [
          ["200000", "11", "15", "10", "14", "3"],
          ["100000", "10", "12", "9", "11", "2"],
        ],
      },
    };
  };

  const account = await exchange.getAccountInfo();
  const price = await exchange.getTickerPrice("BTCUSDT");
  const klines = await exchange.getKlines("BTCUSDT", "1H", 2);

  assert.deepEqual(account, {
    totalBalance: 1000,
    availableBalance: 750,
    unrealizedPnl: 25,
    currency: "USD",
  });
  assert.equal(price, 65000.5);
  assert.deepEqual(klines, [
    { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 2 },
    { time: 200, open: 11, high: 15, low: 10, close: 14, volume: 3 },
  ]);
});

test("okx getOpenPositions normalizes hedged and net positions and handles empty accounts", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  let calls = 0;
  exchange.client.get = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        data: {
          code: "0",
          data: [
            {
              instId: "BTC-USDT-SWAP",
              pos: "2",
              posSide: "long",
              lever: "5",
              margin: "120",
              avgPx: "60000",
              upl: "12",
              liqPx: "55000",
              markPx: "61000",
              mgnMode: "isolated",
              posId: "pos-1",
            },
            {
              instId: "ETH-USDT-SWAP",
              pos: "-3",
              posSide: "net",
              lever: "4",
              margin: "80",
              avgPx: "3000",
              upl: "-4",
              liqPx: "3500",
              markPx: "2900",
              mgnMode: "cross",
              posId: "pos-2",
            },
          ],
        },
      };
    }

    return {
      data: {
        code: "51001",
        msg: "No positions",
      },
    };
  };

  const positions = await exchange.getOpenPositions();
  const empty = await exchange.getOpenPositions();

  assert.deepEqual(positions, [
    {
      symbol: "BTCUSDT",
      positionId: "pos-1",
      side: "LONG",
      leverage: 5,
      marginType: "isolated",
      entryPrice: 60000,
      quantity: 2,
      margin: 120,
      unrealizedPnl: 12,
      liquidationPrice: 55000,
      markPrice: 61000,
      raw: {
        instId: "BTC-USDT-SWAP",
        pos: "2",
        posSide: "long",
        lever: "5",
        margin: "120",
        avgPx: "60000",
        upl: "12",
        liqPx: "55000",
        markPx: "61000",
        mgnMode: "isolated",
        posId: "pos-1",
      },
    },
    {
      symbol: "ETHUSDT",
      positionId: "pos-2",
      side: "SHORT",
      leverage: 4,
      marginType: "cross",
      entryPrice: 3000,
      quantity: 3,
      margin: 80,
      unrealizedPnl: -4,
      liquidationPrice: 3500,
      markPrice: 2900,
      raw: {
        instId: "ETH-USDT-SWAP",
        pos: "-3",
        posSide: "net",
        lever: "4",
        margin: "80",
        avgPx: "3000",
        upl: "-4",
        liqPx: "3500",
        markPx: "2900",
        mgnMode: "cross",
        posId: "pos-2",
      },
    },
  ]);
  assert.deepEqual(empty, []);
});

test("okx placeOrder converts base quantity into rounded contracts for limit orders", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  let payload: Record<string, string> | undefined;

  exchange.accountConfigCache = {
    posMode: "long_short_mode",
    ts: Date.now(),
  };
  exchange.validateInstrument = async () => ({
    instId: "BTC-USDT-SWAP",
    ctVal: "0.1",
    lotSz: "1",
    minSz: "1",
  });
  exchange.setLeverage = async () => {};
  exchange.client.post = async (_path: string, body: string) => {
    payload = JSON.parse(body);
    return {
      data: {
        code: "0",
        data: [{ sCode: "0", ordId: "limit-1" }],
      },
    };
  };

  const result = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.SELL,
    type: ExchangeOrderType.LIMIT,
    quantity: 0.26,
    price: 64500,
    leverage: 3,
  });

  assert.equal(result.orderId, "limit-1");
  assert.equal(result.quantity, 2);
  assert.deepEqual(payload, {
    instId: "BTC-USDT-SWAP",
    tdMode: "isolated",
    side: "sell",
    ordType: "limit",
    sz: "2",
    posSide: "short",
    px: "64500",
  });
});

test("okx closeAllPositions collects per-position close failures", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.getOpenPositions = async () => [
    { symbol: "BTCUSDT", positionId: "1", quantity: 1 },
    { symbol: "ETHUSDT", positionId: "2", quantity: 2 },
  ];
  exchange.closePosition = async (symbol: string) => {
    if (symbol === "ETHUSDT") {
      throw new Error("close rejected");
    }
  };

  const result = await exchange.closeAllPositions();

  assert.deepEqual(result, {
    closed: ["BTCUSDT"],
    errors: ["ETHUSDT: close rejected"],
  });
});

test("okx cancelOrder returns false when the batch cancel response rejects it", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.client.post = async () => ({
    data: {
      code: "0",
      data: [{ sCode: "51603", sMsg: "order already finished" }],
    },
  });

  const result = await exchange.cancelOrder("missing", "BTCUSDT");

  assert.equal(result, false);
});
