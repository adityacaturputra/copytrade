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

test("okx auth helpers and position-mode cache handle simulated headers and fallback reads", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase", true) as any;
  let calls = 0;

  exchange.client.get = async () => {
    calls += 1;
    if (calls === 1) {
      return { data: { data: [{ posMode: "net_mode" }] } };
    }
    throw new Error("offline");
  };

  const headers = exchange.authHeaders("GET", "/api/v5/account/config");
  const first = await exchange.getPositionMode();
  const cached = await exchange.getPositionMode();
  exchange.accountConfigCache = { posMode: "net_mode", ts: 0 };
  const fallback = await exchange.getPositionMode(true);

  assert.equal(headers["OK-ACCESS-KEY"], "key");
  assert.equal(headers["OK-ACCESS-PASSPHRASE"], "passphrase");
  assert.equal(headers["x-simulated-trading"], "1");
  assert.equal(typeof headers["OK-ACCESS-SIGN"], "string");
  assert.equal(first, "net_mode");
  assert.equal(cached, "net_mode");
  assert.equal(fallback, "net_mode");
});

test("okx validateInstrument suggests alternatives and wraps unexpected lookup failures", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  let calls = 0;

  exchange.client.get = async (path: string) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(
        path,
        "/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP",
      );
      return { data: { code: "0", data: [] } };
    }
    return {
      data: {
        code: "0",
        data: [
          { instId: "BTC-USD-SWAP", baseCcy: "BTC", quoteCcy: "USD", state: "live" },
          { instId: "BTC-USDC-SWAP", baseCcy: "BTC", quoteCcy: "USDC", state: "live" },
        ],
      },
    };
  };

  await assert.rejects(
    () => exchange.validateInstrument("BTCUSDT"),
    /Did you mean one of: BTC-USD-SWAP \(USD\), BTC-USDC-SWAP \(USDC\)\?/,
  );

  exchange.client.get = async () => {
    throw new Error("gateway timeout");
  };

  await assert.rejects(
    () => exchange.validateInstrument("ETHUSDT"),
    /Failed to validate instrument ETH-USDT-SWAP: gateway timeout/,
  );
});

test("okx account configuration helpers cover success, business errors, and graceful ensure flow", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

  try {
    exchange.client.post = async (path: string) => {
      if (path === "/api/v5/account/set-account-mode") {
        return { data: { code: "0" } };
      }
      return { data: { code: "0" } };
    };
    await exchange.setAccountMode("2");

    exchange.client.post = async (_path: string, _body: string) => ({
      data: { code: "1", msg: "not allowed" },
    });
    await assert.rejects(
      () => exchange.setPositionMode("BTCUSDT", "net_mode"),
      /Failed to set OKX position mode: not allowed/,
    );

    exchange.setAccountMode = async () => {
      throw new Error("mode locked");
    };
    exchange.setPositionMode = async () => {
      throw new Error("position locked");
    };
    await exchange.ensureAccountConfigured("BTCUSDT");

    assert.equal(
      warnings.some((line) => line.includes("Could not set account mode")),
      true,
    );
    assert.equal(
      warnings.some((line) => line.includes("Could not set position mode")),
      true,
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("okx account and market data helpers surface API failures and empty results", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.client.get = async (path: string) => {
    if (path === "/api/v5/account/balance") {
      return { data: { code: "1", msg: "denied" } };
    }
    if (path.includes("/market/ticker")) {
      return { data: { code: "1", data: [] } };
    }
    return { data: { code: "1", data: [] } };
  };

  await assert.rejects(() => exchange.getAccountInfo(), /OKX API error: denied/);
  await assert.rejects(
    () => exchange.getTickerPrice("BTCUSDT"),
    /Failed to get price for BTCUSDT/,
  );
  assert.deepEqual(await exchange.getKlines("BTCUSDT"), []);
});

test("okx placeOrder handles axios retry paths, retry failures, and non-retry request failures", async () => {
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
  exchange.ensureAccountConfigured = async () => {};
  exchange.getTickerPrice = async () => 65000;

  let calls = 0;
  exchange.client.post = async () => {
    calls += 1;
    if (calls === 1) {
      throw {
        isAxiosError: true,
        message: "Request failed with status code 400",
        response: {
          status: 400,
          data: {
            code: "51010",
            msg: "mode mismatch",
            data: [{ sCode: "51010", sMsg: "mode mismatch" }],
          },
        },
      };
    }
    return {
      data: {
        code: "0",
        data: [{ sCode: "0", ordId: "retry-1" }],
      },
    };
  };

  const retried = await exchange.placeOrder({
    symbol: "BTCUSDT",
    side: OrderSide.BUY,
    type: ExchangeOrderType.MARKET,
    quantity: 1,
    leverage: 3,
  });

  assert.equal(retried.orderId, "retry-1");

  exchange.client.post = async () => {
    throw new Error("network down");
  };

  await assert.rejects(
    () =>
      exchange.placeOrder({
        symbol: "BTCUSDT",
        side: OrderSide.SELL,
        type: ExchangeOrderType.MARKET,
        quantity: 1,
      }),
    /OKX order request failed: network down/,
  );
});

test("okx closePosition and closeAllPositions report missing positions and fallback failures", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;
  exchange.accountConfigCache = {
    posMode: "net_mode",
    ts: Date.now(),
  };

  exchange.getOpenPositions = async () => [];
  await assert.rejects(
    () => exchange.closePosition("BTCUSDT"),
    /No open position found for BTCUSDT/,
  );

  exchange.getOpenPositions = async () => [
    {
      symbol: "BTCUSDT",
      positionId: "pos-1",
      side: "LONG",
      marginType: "isolated",
      quantity: 1,
    },
  ];
  exchange.client.post = async (path: string) => {
    if (path === "/api/v5/trade/close-position") {
      return { data: { code: "1", msg: "close failed", data: [] } };
    }
    return {
      data: {
        code: "1",
        msg: "fallback failed",
        data: [{ sCode: "51603", sMsg: "fallback rejected" }],
      },
    };
  };

  await assert.rejects(
    () => exchange.closePosition("BTCUSDT", "pos-1", 1),
    /Failed to close OKX position: fallback failed/,
  );

  exchange.getOpenPositions = async () => {
    throw new Error("positions offline");
  };
  assert.deepEqual(await exchange.closeAllPositions(), {
    closed: [],
    errors: ["Failed to fetch positions: positions offline"],
  });
});

test("okx stop-loss, take-profit, algo cancellation, and specs failures cover remaining branches", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.accountConfigCache = {
    posMode: "net_mode",
    ts: Date.now(),
  };
  let calls = 0;
  exchange.client.post = async (_path: string, body: string) => {
    calls += 1;
    const payload = JSON.parse(body);
    if (calls === 1) {
      assert.equal("posSide" in payload, false);
      return { data: { code: "1", msg: "sl failed", data: [] } };
    }
    if (calls === 2) {
      assert.equal("posSide" in payload, false);
      return { data: { code: "1", msg: "tp failed", data: [] } };
    }
    return { data: { code: "1", msg: "batch failed" } };
  };

  await assert.rejects(
    () => exchange.placeStopLoss("BTCUSDT", 60000, 0, OrderSide.SELL, 1),
    /Failed to place OKX stop loss: sl failed/,
  );
  await assert.rejects(
    () => exchange.placeTakeProfit("BTCUSDT", 70000, 0, OrderSide.BUY, 1),
    /Failed to place OKX take profit: tp failed/,
  );

  exchange.getAlgoOrders = async () => [];
  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: [],
    errors: [],
  });

  exchange.getAlgoOrders = async () => [{ orderId: "algo-1" }];
  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: [],
    errors: ["Batch cancel failed: batch failed"],
  });

  exchange.client.get = async () => ({
    data: {
      code: "0",
      data: [
        {
          lotSz: "1",
          tickSz: "5",
          ctVal: "1",
          minSz: "2",
          ctValCcy: "",
        },
      ],
    },
  });
  assert.deepEqual(await exchange.getInstrumentSpecs("ETHUSDT"), {
    ctVal: 1,
    lotSz: 1,
    minSz: 2,
    ctValCcy: "",
    tickSz: 5,
    qtyDecimals: 0,
    priceDecimals: 0,
  });

  exchange.client.get = async () => ({ data: { code: "1", msg: "missing" } });
  await assert.rejects(
    () => exchange.getInstrumentSpecs("DOGEUSDT"),
    /Failed to get instrument specs for DOGE-USDT-SWAP: missing/,
  );
});

test("okx cancelAlgoOrders and getOrderHistory handle request failures and empty responses", async () => {
  const exchange = new OkxExchange("key", "secret", "passphrase") as any;

  exchange.getAlgoOrders = async () => [{ orderId: "algo-1" }];
  exchange.client.post = async () => {
    throw new Error("network boom");
  };
  exchange.client.get = async (path: string) => {
    assert.match(path, /orders-history-archive\?instType=SWAP&limit=3$/);
    return {
      data: {
        code: "1",
        msg: "history unavailable",
      },
    };
  };

  assert.deepEqual(await exchange.cancelAlgoOrders("BTCUSDT"), {
    cancelled: [],
    errors: ["Failed to cancel algo orders: network boom"],
  });
  assert.deepEqual(await exchange.getOrderHistory(undefined, 3), []);
});
