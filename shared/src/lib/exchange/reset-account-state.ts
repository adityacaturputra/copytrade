import {
  ExchangeFactory,
  buildExchangeCredentials,
  exchangeProviderRequiresCredentials,
  normalizeExchangeProvider,
} from "./ExchangeFactory";
import { type ExchangeClient } from "./types";

type ExchangeAccountResetInput = {
  name: string;
  tradingPlatform?: unknown;
  exchangeData?: Record<string, unknown> | null;
};

type ExchangeAccountResetOptions = {
  dryRun?: boolean;
};

type ResetStatus = "success" | "skipped" | "error";

export type ExchangeAccountResetResult = {
  accountName: string;
  provider: string;
  status: ResetStatus;
  message: string;
  details: string[];
  openOrders: number;
  cancelledOrders: number;
  orderCancelErrors: number;
  algoOrders: number;
  cancelledAlgoOrders: number;
  algoCancelErrors: number;
  openPositions: number;
  closedPositions: number;
  positionCloseErrors: number;
};

type ResetClientResolution =
  | {
      kind: "ready";
      provider: string;
      exchange: ExchangeClient;
    }
  | {
      kind: "skipped";
      provider: string;
      reason: string;
    };

function getProviderLabel(providerValue: unknown): string {
  return normalizeExchangeProvider(providerValue) || "paper";
}

function resolveExchangeClient(
  account: ExchangeAccountResetInput,
): ResetClientResolution {
  const provider = getProviderLabel(account.tradingPlatform);
  const exchangeData = account.exchangeData || null;

  if (provider === "paper") {
    return {
      kind: "ready",
      provider,
      exchange: ExchangeFactory.getPaperClient(),
    };
  }

  if (exchangeProviderRequiresCredentials(provider) && !exchangeData) {
    return {
      kind: "skipped",
      provider,
      reason: "No exchange credentials configured",
    };
  }

  const credentials = buildExchangeCredentials(provider, exchangeData);
  if (!credentials) {
    return {
      kind: "skipped",
      provider,
      reason: "Unsupported exchange provider",
    };
  }

  return {
    kind: "ready",
    provider,
    exchange: ExchangeFactory.getClientForAccount(credentials),
  };
}

function uniqueSymbols(symbols: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => (typeof symbol === "string" ? symbol.trim() : ""))
        .filter((symbol) => symbol.length > 0),
    ),
  );
}

function buildSummaryMessage(
  status: ResetStatus,
  options: {
    dryRun: boolean;
    openOrders: number;
    algoOrders: number;
    openPositions: number;
    cancelledOrders: number;
    cancelledAlgoOrders: number;
    closedPositions: number;
  },
): string {
  const verb = options.dryRun ? "Would reset" : "Reset";
  const summary =
    `${verb} ` +
    `${options.openOrders} order(s), ` +
    `${options.algoOrders} algo order(s), ` +
    `${options.openPositions} position(s)`;

  if (status === "skipped") {
    return summary;
  }

  if (options.dryRun) {
    return summary;
  }

  return (
    `${summary}; cancelled ${options.cancelledOrders} order(s), ` +
    `${options.cancelledAlgoOrders} algo order(s), ` +
    `closed ${options.closedPositions} position(s)`
  );
}

export async function resetExchangeAccountState(
  account: ExchangeAccountResetInput,
  options: ExchangeAccountResetOptions = {},
): Promise<ExchangeAccountResetResult> {
  const dryRun = options.dryRun === true;
  const resolved = resolveExchangeClient(account);

  if (resolved.kind === "skipped") {
    return {
      accountName: account.name,
      provider: resolved.provider,
      status: "skipped",
      message: resolved.reason,
      details: [resolved.reason],
      openOrders: 0,
      cancelledOrders: 0,
      orderCancelErrors: 0,
      algoOrders: 0,
      cancelledAlgoOrders: 0,
      algoCancelErrors: 0,
      openPositions: 0,
      closedPositions: 0,
      positionCloseErrors: 0,
    };
  }

  const { exchange, provider } = resolved;
  const details: string[] = [];
  const errors: string[] = [];

  let openOrders = 0;
  let cancelledOrders = 0;
  let orderCancelErrors = 0;
  let algoOrders = 0;
  let cancelledAlgoOrders = 0;
  let algoCancelErrors = 0;
  let openPositions = 0;
  let closedPositions = 0;
  let positionCloseErrors = 0;

  let openOrderRows:
    | Awaited<ReturnType<ExchangeClient["getOpenOrders"]>>
    | undefined;
  let algoOrderRows:
    | Awaited<ReturnType<ExchangeClient["getAlgoOrders"]>>
    | undefined;
  let positionRows:
    | Awaited<ReturnType<ExchangeClient["getOpenPositions"]>>
    | undefined;

  try {
    openOrderRows = await exchange.getOpenOrders();
    openOrders = openOrderRows.length;
    details.push(`Open orders: ${openOrders}`);
  } catch (error) {
    const message = `Failed to fetch open orders: ${
      error instanceof Error ? error.message : String(error)
    }`;
    details.push(message);
    errors.push(message);
  }

  try {
    algoOrderRows = await exchange.getAlgoOrders();
    algoOrders = algoOrderRows.length;
    details.push(`Algo orders: ${algoOrders}`);
  } catch (error) {
    const message = `Failed to fetch algo orders: ${
      error instanceof Error ? error.message : String(error)
    }`;
    details.push(message);
    errors.push(message);
  }

  try {
    positionRows = await exchange.getOpenPositions();
    openPositions = positionRows.length;
    details.push(`Open positions: ${openPositions}`);
  } catch (error) {
    const message = `Failed to fetch open positions: ${
      error instanceof Error ? error.message : String(error)
    }`;
    details.push(message);
    errors.push(message);
  }

  if (openOrderRows && openOrderRows.length > 0) {
    if (dryRun) {
      cancelledOrders = openOrderRows.length;
      details.push(`Dry run: would cancel ${openOrderRows.length} open order(s)`);
    } else {
      for (const order of openOrderRows) {
        try {
          const cancelled = await exchange.cancelOrder(order.orderId, order.symbol);
          if (cancelled) {
            cancelledOrders += 1;
            continue;
          }
          orderCancelErrors += 1;
          details.push(`Order not cancelled: ${order.symbol}#${order.orderId}`);
        } catch (error) {
          orderCancelErrors += 1;
          details.push(
            `Cancel order failed for ${order.symbol}#${order.orderId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  const symbolsForAlgoReset = uniqueSymbols([
    ...(openOrderRows || []).map((order) => order.symbol),
    ...(algoOrderRows || []).map((order) => order.symbol),
    ...(positionRows || []).map((position) => position.symbol),
  ]);

  if (symbolsForAlgoReset.length > 0) {
    if (dryRun) {
      cancelledAlgoOrders = algoOrderRows?.length || 0;
      details.push(
        `Dry run: would reset algo orders across ${symbolsForAlgoReset.length} symbol(s)`,
      );
    } else {
      for (const symbol of symbolsForAlgoReset) {
        try {
          const result = await exchange.cancelAlgoOrders(symbol);
          cancelledAlgoOrders += result.cancelled.length;
          algoCancelErrors += result.errors.length;

          if (result.cancelled.length > 0) {
            details.push(
              `Cancelled algo orders for ${symbol}: ${result.cancelled.length}`,
            );
          }
          if (result.errors.length > 0) {
            details.push(
              `Algo cancel errors for ${symbol}: ${result.errors.join(", ")}`,
            );
          }
        } catch (error) {
          algoCancelErrors += 1;
          details.push(
            `Algo reset failed for ${symbol}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  if (dryRun) {
    closedPositions = positionRows?.length || 0;
    if (closedPositions > 0) {
      details.push(`Dry run: would close ${closedPositions} position(s)`);
    }
  } else {
    try {
      const result = await exchange.closeAllPositions();
      closedPositions = result.closed.length;
      positionCloseErrors = result.errors.length;

      if (result.closed.length > 0) {
        details.push(`Closed positions: ${result.closed.join(", ")}`);
      }
      if (result.errors.length > 0) {
        details.push(`Close position errors: ${result.errors.join(", ")}`);
      }
    } catch (error) {
      positionCloseErrors += 1;
      details.push(
        `Failed to close positions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const status: ResetStatus =
    errors.length > 0 ||
    orderCancelErrors > 0 ||
    algoCancelErrors > 0 ||
    positionCloseErrors > 0
      ? "error"
      : "success";

  return {
    accountName: account.name,
    provider,
    status,
    message: buildSummaryMessage(status, {
      dryRun,
      openOrders,
      algoOrders,
      openPositions,
      cancelledOrders,
      cancelledAlgoOrders,
      closedPositions,
    }),
    details,
    openOrders,
    cancelledOrders,
    orderCancelErrors,
    algoOrders,
    cancelledAlgoOrders,
    algoCancelErrors,
    openPositions,
    closedPositions,
    positionCloseErrors,
  };
}
