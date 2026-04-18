import type { ToolExecutor } from "./shared";
import {
  cancelAlgoOrdersByTypes,
  resolveExchangeContext,
  roundPrice,
} from "./shared";

export const orderManagementToolImplementations: Record<string, ToolExecutor> = {
  get_open_orders: async (args) => {
    const { symbol } = args as { symbol?: string };
    const { exchange } = await resolveExchangeContext(args);
    const orders = await exchange.getOpenOrders(symbol);
    return JSON.stringify(orders);
  },

  cancel_order: async (args) => {
    const { orderId, symbol } = args as {
      orderId: string;
      symbol: string;
    };
    const { exchange } = await resolveExchangeContext(args);
    const success = await exchange.cancelOrder(orderId, symbol);
    return JSON.stringify({ success, orderId, symbol });
  },

  cancel_all_orders: async (args) => {
    const { symbol } = args as { symbol?: string };
    const { exchange } = await resolveExchangeContext(args);
    const orders = await exchange.getOpenOrders(symbol);
    const results: {
      orderId: string;
      symbol: string;
      success: boolean;
      error?: string;
    }[] = [];

    for (const order of orders) {
      try {
        const success = await exchange.cancelOrder(order.orderId, order.symbol);
        results.push({
          orderId: order.orderId,
          symbol: order.symbol,
          success,
        });
      } catch (err) {
        results.push({
          orderId: order.orderId,
          symbol: order.symbol,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return JSON.stringify({
      total: orders.length,
      cancelled: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  },

  get_algo_orders: async (args) => {
    const { symbol } = args as { symbol?: string };
    const { exchange } = await resolveExchangeContext(args);
    const orders = await exchange.getAlgoOrders(symbol);
    return JSON.stringify(orders);
  },

  cancel_algo_orders: async (args) => {
    const { symbol } = args as { symbol: string };
    const { exchange } = await resolveExchangeContext(args);
    const result = await exchange.cancelAlgoOrders(symbol);
    return JSON.stringify(result);
  },

  modify_stop_loss: async (args) => {
    const { symbol, newTriggerPrice, newExecutePrice, side, quantity } =
      args as {
        symbol: string;
        newTriggerPrice: number;
        newExecutePrice: number;
        side: "BUY" | "SELL";
        quantity: number;
      };
    const { exchange } = await resolveExchangeContext(args);
    const roundedTrigger = roundPrice(newTriggerPrice);
    const roundedExecute = roundPrice(newExecutePrice);

    await cancelAlgoOrdersByTypes(exchange, symbol, ["sl"]);
    const orderId = await exchange.placeStopLoss(
      symbol,
      roundedTrigger,
      roundedExecute,
      side,
      quantity,
    );

    return JSON.stringify({
      success: true,
      symbol,
      newTriggerPrice: roundedTrigger,
      newExecutePrice: roundedExecute,
      orderId,
    });
  },

  modify_take_profit: async (args) => {
    const { symbol, newTriggerPrice, newExecutePrice, side, quantity } =
      args as {
        symbol: string;
        newTriggerPrice: number;
        newExecutePrice: number;
        side: "BUY" | "SELL";
        quantity: number;
      };
    const { exchange } = await resolveExchangeContext(args);
    const roundedTrigger = roundPrice(newTriggerPrice);
    const roundedExecute = roundPrice(newExecutePrice);

    await cancelAlgoOrdersByTypes(exchange, symbol, ["tp"]);
    const orderId = await exchange.placeTakeProfit(
      symbol,
      roundedTrigger,
      roundedExecute,
      side,
      quantity,
    );

    return JSON.stringify({
      success: true,
      symbol,
      newTriggerPrice: roundedTrigger,
      newExecutePrice: roundedExecute,
      orderId,
    });
  },

  get_order_history: async (args) => {
    const { symbol, limit } = args as {
      symbol?: string;
      limit?: number;
    };
    const { exchange } = await resolveExchangeContext(args);
    const orders = await exchange.getOrderHistory(symbol, limit || 20);
    return JSON.stringify(orders);
  },
};
