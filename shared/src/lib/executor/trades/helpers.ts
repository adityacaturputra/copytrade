import { Account, buildTPTargets, IPosition, Position } from "../../database";
import {
  ExchangeFactory,
  ExchangeCredentials,
  buildExchangeCredentials,
} from "../../exchange/ExchangeFactory";
import { calculateRiskBasedPosition, resolveEffectiveRiskConfig } from "../../risk";
import { formatUsd, roundUpToStep } from "../utils/exchange";
import { logExecutorInfo, logExecutorWarn } from "../../process/log";
import { splitQuantityForTPs } from "./split-quantity";
import type { ExecuteTradeInput } from "../types";

type TradeRuntime = Pick<
  ExecuteTradeInput,
  | "symbol"
  | "action"
  | "entryPrice"
  | "stopLoss"
  | "takeProfitTargets"
  | "leverage"
  | "quantity"
  | "orderType"
  | "channelId"
  | "messageId"
  | "sourceName"
  | "signalData"
  | "accountId"
  | "processId"
> & { side: "LONG" | "SHORT"; logPrefix: string };

export async function resolveTradeExchange({
  accountId,
  processId,
  symbol,
  logPrefix,
}: Pick<TradeRuntime, "accountId" | "processId" | "symbol" | "logPrefix">) {
  if (accountId) {
    const account = await Account.findById(accountId).lean();
    if (account?.exchangeData) {
      const creds =
        buildExchangeCredentials(
          account.tradingPlatform,
          (account.exchangeData as Record<string, unknown>) || {},
        ) || ({ provider: "paper" } as ExchangeCredentials);
      return ExchangeFactory.getClientForAccount(creds);
    }
    await logExecutorWarn(
      `${logPrefix}⚠️ Account ${accountId} has no exchangeData, using paper exchange`,
      { accountId, processId, symbol, action: "console_exchange_fallback" },
    );
  } else {
    await logExecutorWarn(`${logPrefix}⚠️ No accountId provided, using paper exchange`, {
      processId,
      symbol,
      action: "console_exchange_fallback",
    });
  }
  return ExchangeFactory.getPaperClient();
}

export async function applyTradeRiskManagement(
  exchange: Awaited<ReturnType<typeof resolveTradeExchange>>,
  runtime: TradeRuntime,
) {
  let orderQuantity = runtime.quantity;
  let orderLeverage = runtime.leverage;
  let riskAccountBalance: number | undefined;
  let plannedMarginUsdt: number | undefined;

  try {
    const account = await exchange.getAccountInfo();
    riskAccountBalance = account.availableBalance || account.totalBalance;
    await logExecutorInfo(
      `${runtime.logPrefix}💰 Risk balance source (${exchange.name}): $${riskAccountBalance.toFixed(2)}`,
      {
        accountId: runtime.accountId,
        processId: runtime.processId,
        symbol: runtime.symbol,
        action: "console_risk_balance",
      },
    );
  } catch (balanceErr) {
    await logExecutorWarn(
      `${runtime.logPrefix}⚠️ Failed to fetch account balance for risk sizing: ${balanceErr instanceof Error ? balanceErr.message : String(balanceErr)}`,
      {
        accountId: runtime.accountId,
        processId: runtime.processId,
        symbol: runtime.symbol,
        action: "console_risk_balance_failed",
      },
    );
  }

  if (runtime.entryPrice && runtime.entryPrice > 0 && runtime.stopLoss) {
    const riskCalc = await calculateRiskBasedPosition(
      runtime.entryPrice,
      runtime.stopLoss,
      runtime.side,
      runtime.quantity,
      runtime.leverage,
      riskAccountBalance,
      { accountId: runtime.accountId, channelId: runtime.channelId },
    );

    if (riskCalc.applied) {
      const originalOrderQuantity = orderQuantity;
      const originalOrderLeverage = orderLeverage;
      orderQuantity = riskCalc.quantity;
      orderLeverage = riskCalc.leverage;
      plannedMarginUsdt = riskCalc.marginUsdt;
      await logExecutorInfo(
        `${runtime.logPrefix}🛡️ Risk management applied: qty=${originalOrderQuantity.toFixed(6)} → ${orderQuantity.toFixed(6)}, leverage=${originalOrderLeverage} → ${orderLeverage}`,
        {
          accountId: runtime.accountId,
          processId: runtime.processId,
          symbol: runtime.symbol,
          action: "console_risk_applied",
        },
      );
      await logExecutorInfo(
        `${runtime.logPrefix}🛡️ Risk details: balance=$${riskCalc.accountBalance.toFixed(2)}, margin=$${riskCalc.marginUsdt.toFixed(2)}, slDist=${(riskCalc.slDistancePercent * 100).toFixed(2)}%, notional=$${riskCalc.notionalSize.toFixed(2)}`,
        {
          accountId: runtime.accountId,
          processId: runtime.processId,
          symbol: runtime.symbol,
          action: "console_risk_details",
        },
      );
    } else {
      await logExecutorWarn(`${runtime.logPrefix}⚠️ Risk management skipped: ${riskCalc.skipReason}`, {
        accountId: runtime.accountId,
        processId: runtime.processId,
        symbol: runtime.symbol,
        action: "console_risk_skipped",
      });
    }
  } else if (!runtime.entryPrice || runtime.entryPrice <= 0) {
    await logExecutorWarn(`${runtime.logPrefix}⚠️ Risk management skipped: no entry price available`, {
      accountId: runtime.accountId,
      processId: runtime.processId,
      symbol: runtime.symbol,
      action: "console_risk_skipped",
    });
  }

  return { orderQuantity, orderLeverage, plannedMarginUsdt, riskAccountBalance };
}

export async function enforceExchangeMinimums(
  exchange: Awaited<ReturnType<typeof resolveTradeExchange>>,
  runtime: TradeRuntime,
  sizing: Awaited<ReturnType<typeof applyTradeRiskManagement>>,
) {
  let { orderQuantity, orderLeverage } = sizing;
  const entryPrice = runtime.entryPrice || 0;
  if (!entryPrice || entryPrice <= 0) return { ...sizing, orderQuantity, orderLeverage };

  const specs = await exchange.getInstrumentSpecs(runtime.symbol);
  const minNotional = specs.minNotional || 0;
  const currentNotional = orderQuantity * entryPrice;
  if (!minNotional || currentNotional >= minNotional) {
    return { ...sizing, orderQuantity, orderLeverage };
  }

  const effectiveRiskConfig = await resolveEffectiveRiskConfig({
    accountId: runtime.accountId,
    channelId: runtime.channelId,
  });
  if (!effectiveRiskConfig.autoRaiseMinOrderEnabled) {
    throw new Error(`Trade rejected: exchange minimum notional is $${formatUsd(minNotional)}, but auto-raise is disabled.`);
  }

  const requiredQty = roundUpToStep(minNotional / entryPrice, specs.lotSz, specs.qtyDecimals);
  const requiredMargin = (requiredQty * entryPrice) / orderLeverage;
  const autoRaiseCap = effectiveRiskConfig.autoRaiseMinOrderMaxMarginUsdt;

  if (requiredMargin > autoRaiseCap) {
    let rejectMessage = `Trade rejected: exchange minimum requires margin $${formatUsd(requiredMargin)} at ${orderLeverage}x, but allowed auto-raise cap is $${formatUsd(autoRaiseCap)}`;
    if (sizing.riskAccountBalance !== undefined && requiredMargin > sizing.riskAccountBalance) {
      rejectMessage = `Trade rejected: exchange minimum requires margin $${formatUsd(requiredMargin)} at ${orderLeverage}x, but available balance is $${formatUsd(sizing.riskAccountBalance)}`;
    }
    throw new Error(rejectMessage);
  }

  const originalQuantity = orderQuantity;
  orderQuantity = requiredQty;
  await logExecutorInfo(
    `${runtime.logPrefix}📏 Auto-raised qty for exchange minimum: qty=${originalQuantity.toFixed(specs.qtyDecimals)} → ${orderQuantity.toFixed(specs.qtyDecimals)}, minNotional=$${formatUsd(minNotional)}, margin=$${formatUsd(requiredMargin)} at ${orderLeverage}x`,
    {
      accountId: runtime.accountId,
      processId: runtime.processId,
      symbol: runtime.symbol,
      action: "console_auto_raise_min_order",
    },
  );

  return { ...sizing, orderQuantity, orderLeverage, plannedMarginUsdt: requiredMargin };
}
