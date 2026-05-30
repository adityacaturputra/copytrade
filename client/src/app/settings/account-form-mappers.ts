import {
  buildExchangeFormValues,
  getExchangeSimulationValue,
  resolveAccountFormTradingPlatform,
} from "./exchange-form";
import {
  formatOptionalNumber,
  toAutoRaiseOverrideMode,
  toTpCloseModeOverride,
  type AccountData,
  type AccountFormData,
} from "./types";

function buildBaseForm(account: AccountData): AccountFormData {
  const sourceChannelNames = account.channelNames || {};
  return {
    duplicateFromId: null,
    name: account.name,
    sourceType: account.sourceType || "discord",
    method: (account.sourceData?.method as string) || "bot",
    token: "",
    refreshToken: "",
    autoRefresh: (account.sourceData?.autoRefresh as boolean) ?? true,
    botToken: "",
    channels: account.channelIds.map((channelId: string) => ({
      id: channelId,
      name: sourceChannelNames[channelId] || "",
      riskPerTradePercent: formatOptionalNumber(
        account.channelConfigs?.[channelId]?.riskOverrides?.riskPerTradePercent,
      ),
      autoRaiseMinOrderMode: toAutoRaiseOverrideMode(
        account.channelConfigs?.[channelId]?.riskOverrides?.autoRaiseMinOrderEnabled,
      ),
      autoRaiseMinOrderMaxMarginUsdt: formatOptionalNumber(
        account.channelConfigs?.[channelId]?.riskOverrides?.autoRaiseMinOrderMaxMarginUsdt,
      ),
      autoRaiseTpCountMode: toAutoRaiseOverrideMode(
        account.channelConfigs?.[channelId]?.riskOverrides?.autoRaiseTpCountEnabled,
      ),
      autoRaiseTpCountMaxMarginUsdt: formatOptionalNumber(
        account.channelConfigs?.[channelId]?.riskOverrides?.autoRaiseTpCountMaxMarginUsdt,
      ),
      tpCloseMode: toTpCloseModeOverride(
        account.channelConfigs?.[channelId]?.riskOverrides?.tpCloseMode,
      ),
    })),
    accountRiskPerTradePercent: formatOptionalNumber(
      account.riskOverrides?.riskPerTradePercent,
    ),
    accountAutoRaiseMinOrderMode: toAutoRaiseOverrideMode(
      account.riskOverrides?.autoRaiseMinOrderEnabled,
    ),
    accountAutoRaiseMinOrderMaxMarginUsdt: formatOptionalNumber(
      account.riskOverrides?.autoRaiseMinOrderMaxMarginUsdt,
    ),
    accountAutoRaiseTpCountMode: toAutoRaiseOverrideMode(
      account.riskOverrides?.autoRaiseTpCountEnabled,
    ),
    accountAutoRaiseTpCountMaxMarginUsdt: formatOptionalNumber(
      account.riskOverrides?.autoRaiseTpCountMaxMarginUsdt,
    ),
    accountTpCloseMode: toTpCloseModeOverride(
      account.riskOverrides?.tpCloseMode,
    ),
    tradingPlatform: resolveAccountFormTradingPlatform(account.tradingPlatform),
    exchangeValues: buildExchangeFormValues(account.exchangeData),
    exchangeIsDemo: getExchangeSimulationValue(account.exchangeData),
  };
}

export function mapAccountToEditForm(account: AccountData): AccountFormData {
  return buildBaseForm(account);
}

export function mapAccountToDuplicateForm(account: AccountData): AccountFormData {
  const baseForm = buildBaseForm(account);
  return {
    ...baseForm,
    duplicateFromId: account._id,
    name: `${account.name} Copy`,
  };
}
