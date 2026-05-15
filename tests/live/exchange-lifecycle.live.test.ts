import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Account,
  connectDB,
  disconnectDB,
  type IAccount,
} from "../../shared/src/lib/database/index";
import {
  ExchangeFactory,
  buildExchangeCredentials,
  type ExchangeProvider,
} from "../../shared/src/lib/exchange/ExchangeFactory";
import type {
  ExchangeClient,
  InstrumentSpecs,
  PositionInfo,
} from "../../shared/src/lib/exchange/types";
import { isLiveExchangeEnabled } from "../helpers/live";

type LiveExchangeContext = {
  provider: "bybit" | "binance" | "okx";
  account: IAccount;
  exchange: ExchangeClient;
  symbol: string;
  price: number;
  quantity: number;
  specs: InstrumentSpecs;
};

const PROVIDERS: Array<"bybit" | "binance" | "okx"> = [
  "bybit",
  "binance",
  "okx",
];
const PROVIDER_SYMBOL_CANDIDATES: Record<
  "bybit" | "binance" | "okx",
  string[]
> = {
  bybit: ["BTCUSDT", "ETHUSDT", "XRPUSDT", "DOGEUSDT"],
  binance: ["BTCUSDT", "ETHUSDT", "XRPUSDT", "DOGEUSDT"],
  okx: ["XRPUSDT", "DOGEUSDT", "ADAUSDT", "BTCUSDT"],
};
const PROVIDER_TARGET_NOTIONAL_USDT: Record<
  "bybit" | "binance" | "okx",
  number
> = {
  bybit: 10,
  binance: 60,
  okx: 10,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await fn();
    if (result) {
      return result;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** Math.max(0, decimals);
  return Math.round(value * factor) / factor;
}

function roundUpToStep(value: number, step: number, decimals: number): number {
  const safeStep = step > 0 ? step : 1;
  const units = Math.ceil(value / safeStep);
  return roundToDecimals(units * safeStep, decimals);
}

function deriveBaseQuantity(
  provider: ExchangeProvider,
  specs: InstrumentSpecs,
  price: number,
): number {
  const targetNotional = PROVIDER_TARGET_NOTIONAL_USDT[
    provider as "bybit" | "binance" | "okx"
  ];

  if (provider === "okx") {
    const minBase = Math.max(specs.minSz, specs.lotSz) * specs.ctVal;
    const baseStep = Math.max(specs.lotSz, specs.minSz) * specs.ctVal;
    const targetBase = Math.max(targetNotional / price, minBase);
    return roundUpToStep(targetBase, baseStep, 8);
  }

  const minBase = Math.max(specs.minSz, specs.lotSz);
  const targetBase = Math.max(targetNotional / price, minBase);
  return roundUpToStep(targetBase, Math.max(specs.lotSz, specs.minSz), specs.qtyDecimals);
}

function derivePartialQuantity(
  provider: ExchangeProvider,
  specs: InstrumentSpecs,
  totalQuantity: number,
): number {
  if (provider === "okx") {
    const minBase = Math.max(specs.minSz, specs.lotSz) * specs.ctVal;
    return Math.max(roundToDecimals(totalQuantity / 2, 8), roundToDecimals(minBase, 8));
  }

  const minBase = Math.max(specs.minSz, specs.lotSz);
  return Math.max(
    roundToDecimals(totalQuantity / 2, specs.qtyDecimals),
    roundToDecimals(minBase, specs.qtyDecimals),
  );
}

function getClosingSide(position: PositionInfo): "BUY" | "SELL" {
  return position.side === "LONG" ? "SELL" : "BUY";
}

async function cleanupSymbol(exchange: ExchangeClient, symbol: string): Promise<void> {
  try {
    await exchange.cancelAlgoOrders(symbol);
  } catch {}

  try {
    const orders = await exchange.getOpenOrders(symbol);
    for (const order of orders) {
      try {
        await exchange.cancelOrder(order.orderId, order.symbol);
      } catch {}
    }
  } catch {}

  try {
    const positions = await exchange.getOpenPositions();
    const matching = positions.filter((position) => position.symbol === symbol);
    for (const position of matching) {
      try {
        await exchange.closePosition(position.symbol, position.positionId, position.quantity);
      } catch {}
    }
  } catch {}
}

async function loadLiveExchangeContext(
  provider: "bybit" | "binance" | "okx",
): Promise<LiveExchangeContext> {
  const account = await Account.findOne({
    tradingPlatform: provider,
    "exchangeData.simulated": true,
  })
    .sort({ updatedAt: -1 })
    .exec();

  if (!account) {
    throw new Error(`No simulated ${provider} account found in dev DB`);
  }

  const credentials = buildExchangeCredentials(
    account.tradingPlatform,
    account.exchangeData as Record<string, unknown>,
  );
  if (!credentials) {
    throw new Error(`Failed to build ${provider} credentials from account`);
  }

  const exchange = ExchangeFactory.getClientForAccount(credentials);

  for (const symbol of PROVIDER_SYMBOL_CANDIDATES[provider]) {
    try {
      const specs = await exchange.getInstrumentSpecs(symbol);
      const price = await exchange.getTickerPrice(symbol);
      const quantity = deriveBaseQuantity(provider, specs, price);
      const estimatedNotional = quantity * price;
      if (quantity > 0 && estimatedNotional > 0 && estimatedNotional <= 100) {
        return {
          provider,
          account,
          exchange,
          symbol,
          price,
          quantity,
          specs,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(`No suitable low-notional symbol found for ${provider}`);
}

describe.skipIf(!isLiveExchangeEnabled())("live exchange lifecycle", () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  for (const provider of PROVIDERS) {
    it(
      `${provider} supports cancel / buy / sell / SL / TP / UPDATE_SL / UPDATE_TP / ADD_TP / close`,
      async () => {
        const ctx = await loadLiveExchangeContext(provider);
        const { exchange, symbol, specs } = ctx;

        await cleanupSymbol(exchange, symbol);

        const accountInfo = await exchange.getAccountInfo();
        expect(accountInfo.totalBalance).toBeGreaterThanOrEqual(0);

        const tickerPrice = await exchange.getTickerPrice(symbol);
        expect(tickerPrice).toBeGreaterThan(0);

        const limitPrice = roundToDecimals(
          tickerPrice * (provider === "binance" ? 0.9 : 0.75),
          specs.priceDecimals,
        );
        const limitOrder = await exchange.placeOrder({
          symbol,
          side: "BUY",
          type: "LIMIT",
          quantity: ctx.quantity,
          price: limitPrice,
          leverage: 1,
        });
        expect(limitOrder.orderId).toBeTruthy();

        const openLimitOrder = await waitFor(
          `${provider} limit order to appear`,
          async () => {
            const orders = await exchange.getOpenOrders(symbol);
            return orders.find((order) => order.orderId === limitOrder.orderId) || null;
          },
        );
        expect(openLimitOrder.type.toLowerCase()).toContain("limit");

        const cancelled = await exchange.cancelOrder(limitOrder.orderId, symbol);
        expect(cancelled).toBe(true);

        await waitFor(
          `${provider} limit order cancellation`,
          async () => {
            const orders = await exchange.getOpenOrders(symbol);
            return orders.every((order) => order.orderId !== limitOrder.orderId)
              ? true
              : null;
          },
        );

        await exchange.placeOrder({
          symbol,
          side: "BUY",
          type: "MARKET",
          quantity: ctx.quantity,
          leverage: 1,
        });

        const longPosition = await waitFor(
          `${provider} long position`,
          async () => {
            const positions = await exchange.getOpenPositions();
            return (
              positions.find(
                (position) => position.symbol === symbol && position.side === "LONG",
              ) || null
            );
          },
        );
        expect(longPosition.quantity).toBeGreaterThan(0);

        const longQty = longPosition.quantity;
        const partialQty = derivePartialQuantity(provider, specs, longQty);
        const stopLossPrice = roundToDecimals(longPosition.markPrice * 0.8, specs.priceDecimals);
        const takeProfitPrice = roundToDecimals(
          longPosition.markPrice * 1.2,
          specs.priceDecimals,
        );

        const stopLossId = await exchange.placeStopLoss(
          symbol,
          stopLossPrice,
          stopLossPrice,
          getClosingSide(longPosition),
          longQty,
        );
        expect(stopLossId).toBeTruthy();

        const takeProfitId = await exchange.placeTakeProfit(
          symbol,
          takeProfitPrice,
          takeProfitPrice,
          getClosingSide(longPosition),
          partialQty,
        );
        expect(takeProfitId).toBeTruthy();

        const algoOrders = await waitFor(
          `${provider} algo orders`,
          async () => {
            const orders = await exchange.getAlgoOrders(symbol);
            return orders.length >= 2 ? orders : null;
          },
        );
        expect(algoOrders.some((order) => order.type === "sl")).toBe(true);
        expect(algoOrders.some((order) => order.type === "tp")).toBe(true);

        const updateSlResult = await exchange.cancelAlgoOrders(symbol);
        expect(updateSlResult.errors).toEqual([]);

        const updatedStopPrice = roundToDecimals(
          longPosition.markPrice * 0.82,
          specs.priceDecimals,
        );
        const updatedStopId = await exchange.placeStopLoss(
          symbol,
          updatedStopPrice,
          updatedStopPrice,
          getClosingSide(longPosition),
          longQty,
        );
        expect(updatedStopId).toBeTruthy();

        const updatedTpPrice = roundToDecimals(
          longPosition.markPrice * 1.22,
          specs.priceDecimals,
        );
        const updatedTpId = await exchange.placeTakeProfit(
          symbol,
          updatedTpPrice,
          updatedTpPrice,
          getClosingSide(longPosition),
          partialQty,
        );
        expect(updatedTpId).toBeTruthy();

        const addTpPrice = roundToDecimals(longPosition.markPrice * 1.25, specs.priceDecimals);
        const addTpId = await exchange.placeTakeProfit(
          symbol,
          addTpPrice,
          addTpPrice,
          getClosingSide(longPosition),
          partialQty,
        );
        expect(addTpId).toBeTruthy();

        const refreshedAlgoOrders = await waitFor(
          `${provider} updated algo orders`,
          async () => {
            const orders = await exchange.getAlgoOrders(symbol);
            return orders.length >= 3 ? orders : null;
          },
        );
        expect(refreshedAlgoOrders.filter((order) => order.type === "tp").length).toBeGreaterThanOrEqual(2);
        expect(refreshedAlgoOrders.some((order) => order.type === "sl")).toBe(true);

        const longPositionBeforeClose = (
          await exchange.getOpenPositions()
        ).find(
          (position) => position.symbol === symbol && position.side === "LONG",
        );
        if (longPositionBeforeClose) {
          try {
            await exchange.closePosition(
              symbol,
              longPositionBeforeClose.positionId,
              longPositionBeforeClose.quantity,
            );
          } catch (error) {
            const positionsAfterError = await exchange.getOpenPositions();
            const stillOpen = positionsAfterError.find(
              (position) => position.symbol === symbol && position.side === "LONG",
            );
            if (stillOpen) {
              throw error;
            }
          }
        }
        await waitFor(
          `${provider} long close`,
          async () => {
            const positions = await exchange.getOpenPositions();
            return positions.every(
              (position) => !(position.symbol === symbol && position.side === "LONG"),
            )
              ? true
              : null;
          },
        );

        await exchange.placeOrder({
          symbol,
          side: "SELL",
          type: "MARKET",
          quantity: ctx.quantity,
          leverage: 1,
        });

        const shortPosition = await waitFor(
          `${provider} short position`,
          async () => {
            const positions = await exchange.getOpenPositions();
            return (
              positions.find(
                (position) => position.symbol === symbol && position.side === "SHORT",
              ) || null
            );
          },
        );
        expect(shortPosition.quantity).toBeGreaterThan(0);

        const shortPositionBeforeClose = (
          await exchange.getOpenPositions()
        ).find(
          (position) => position.symbol === symbol && position.side === "SHORT",
        );
        if (shortPositionBeforeClose) {
          try {
            await exchange.closePosition(
              symbol,
              shortPositionBeforeClose.positionId,
              shortPositionBeforeClose.quantity,
            );
          } catch (error) {
            const positionsAfterError = await exchange.getOpenPositions();
            const stillOpen = positionsAfterError.find(
              (position) => position.symbol === symbol && position.side === "SHORT",
            );
            if (stillOpen) {
              throw error;
            }
          }
        }
        await waitFor(
          `${provider} short close`,
          async () => {
            const positions = await exchange.getOpenPositions();
            return positions.every(
              (position) => !(position.symbol === symbol && position.side === "SHORT"),
            )
              ? true
              : null;
          },
        );

        await cleanupSymbol(exchange, symbol);
      },
      180_000,
    );
  }
});
