import type { ToolExecutor } from "./shared";
import { resolveExchangeContext, roundPrice } from "./shared";

export const tradingToolImplementations: Record<string, ToolExecutor> = {
  place_order: async (args) => {
    const { symbol, side, type, quantity, price, leverage } = args as {
      symbol: string;
      side: "BUY" | "SELL";
      type: "MARKET" | "LIMIT";
      quantity: number;
      price?: number;
      leverage?: number;
    };
    const { exchange } = await resolveExchangeContext(args);

    if (leverage) {
      try {
        await exchange.setLeverage(symbol, leverage);
      } catch {
        // Leverage might already be set.
      }
    }

    const result = await exchange.placeOrder({
      symbol,
      side,
      type,
      quantity,
      price: price ? roundPrice(price) : undefined,
      leverage,
    });
    return JSON.stringify(result);
  },

  close_position: async (args) => {
    const { symbol, quantity } = args as {
      symbol: string;
      quantity?: number;
    };
    const { exchange } = await resolveExchangeContext(args);
    await exchange.closePosition(symbol, undefined, quantity);
    return JSON.stringify({
      success: true,
      symbol,
      quantity: quantity || "all",
    });
  },

  close_all_positions: async (args) => {
    const { exchange } = await resolveExchangeContext(args);
    const result = await exchange.closeAllPositions();
    return JSON.stringify(result);
  },

  set_leverage: async (args) => {
    const { symbol, leverage } = args as {
      symbol: string;
      leverage: number;
    };
    const { exchange } = await resolveExchangeContext(args);
    await exchange.setLeverage(symbol, leverage);
    return JSON.stringify({ success: true, symbol, leverage });
  },

  set_stop_loss: async (args) => {
    const { symbol, triggerPrice, executePrice, side, quantity } = args as {
      symbol: string;
      triggerPrice: number;
      executePrice: number;
      side: "BUY" | "SELL";
      quantity: number;
    };
    const { exchange } = await resolveExchangeContext(args);
    const roundedTrigger = roundPrice(triggerPrice);
    const roundedExecute = roundPrice(executePrice);
    const id = await exchange.placeStopLoss(
      symbol,
      roundedTrigger,
      roundedExecute,
      side,
      quantity,
    );
    return JSON.stringify({
      success: true,
      orderId: id,
      triggerPrice: roundedTrigger,
      executePrice: roundedExecute,
    });
  },

  set_take_profit: async (args) => {
    const { symbol, triggerPrice, executePrice, side, quantity } = args as {
      symbol: string;
      triggerPrice: number;
      executePrice: number;
      side: "BUY" | "SELL";
      quantity: number;
    };
    const { exchange } = await resolveExchangeContext(args);
    const roundedTrigger = roundPrice(triggerPrice);
    const roundedExecute = roundPrice(executePrice);
    const id = await exchange.placeTakeProfit(
      symbol,
      roundedTrigger,
      roundedExecute,
      side,
      quantity,
    );
    return JSON.stringify({
      success: true,
      orderId: id,
      triggerPrice: roundedTrigger,
      executePrice: roundedExecute,
    });
  },

  get_klines: async (args) => {
    const { symbol, interval, limit } = args as {
      symbol: string;
      interval?: string;
      limit?: number;
    };
    const { exchange } = await resolveExchangeContext(args);
    const klines = await exchange.getKlines(
      symbol,
      interval || "1h",
      limit || 24,
    );
    return JSON.stringify(klines);
  },
};
