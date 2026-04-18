import {
  connectDB,
  getOpenPositions,
  Account,
} from "@copytrade/shared/lib/database";
import type { ToolExecutor } from "./shared";
import {
  type AccountRecord,
  normalizeExchangeProvider,
  resolveExchangeContext,
} from "./shared";

export const accountMarketToolImplementations: Record<string, ToolExecutor> = {
  get_trading_accounts: async () => {
    await connectDB();
    const accounts = (await Account.find({ isActive: true })
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as AccountRecord[];

    const tradingAccounts = accounts
      .filter((acc) => Boolean(normalizeExchangeProvider(acc.tradingPlatform)))
      .map((acc) => {
        const provider = normalizeExchangeProvider(acc.tradingPlatform);
        const exchangeData = (acc.exchangeData || {}) as Record<string, unknown>;
        const hasCredentials =
          provider === "paper"
            ? true
            : Boolean(
                typeof exchangeData.apiKey === "string" &&
                  exchangeData.apiKey &&
                  typeof exchangeData.secretKey === "string" &&
                  exchangeData.secretKey,
              );

        return {
          accountId: String(acc._id),
          name: acc.name,
          provider,
          sourceType: acc.sourceType,
          channelIds: Array.isArray(acc.channelIds) ? acc.channelIds : [],
          hasCredentials,
        };
      });

    return JSON.stringify(tradingAccounts);
  },

  get_account_info: async (args) => {
    const ctx = await resolveExchangeContext(args);
    const info = await ctx.exchange.getAccountInfo();
    return JSON.stringify({
      provider: ctx.provider,
      accountId: ctx.accountId,
      accountName: ctx.accountName,
      ...info,
    });
  },

  get_ticker_price: async (args) => {
    const symbol = args.symbol as string;
    const { exchange } = await resolveExchangeContext(args);
    const price = await exchange.getTickerPrice(symbol);
    return JSON.stringify({ symbol, price });
  },

  get_open_positions: async () => {
    await connectDB();
    const positions = await getOpenPositions();
    return JSON.stringify(
      positions.map((p) => ({
        _id: p._id,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        quantity: p.quantity,
        leverage: p.leverage,
        takeProfitTargets: p.takeProfitTargets,
        stopLossPrice: p.stopLossPrice,
        pnl: p.pnl,
        status: p.status,
        openedAt: p.openedAt,
      })),
    );
  },

  get_exchange_positions: async (args) => {
    const { exchange } = await resolveExchangeContext(args);
    const positions = await exchange.getOpenPositions();
    return JSON.stringify(
      positions.map((p) => ({
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        leverage: p.leverage,
        margin: p.margin,
        unrealizedPnl: p.unrealizedPnl,
        liquidationPrice: p.liquidationPrice,
        markPrice: p.markPrice,
      })),
    );
  },
};
