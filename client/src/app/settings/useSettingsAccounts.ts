import { useCallback, useEffect, useState } from "react";
import {
  buildExchangeDataPayload,
  buildExchangeDataPreview,
  createEmptyExchangeFormValues,
} from "./exchange-form";
import { mapAccountToDuplicateForm, mapAccountToEditForm } from "./account-form-mappers";
import {
  DEFAULT_ACCOUNT_EXCHANGE_PROVIDER,
  DEFAULT_EXCHANGE_PROVIDER,
  getExchangeProviderConfig,
  getExchangeProviderOptions,
  validateExchangeCredentials,
} from "@copytrade/shared/lib/exchange/provider-config";
import {
  createEmptyAccountForm,
  formatOptionalNumber,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveNumber,
  toAutoRaiseOverrideMode,
  withActionPassword,
  type AccountData,
  type AccountFormData,
  type HealthStatus,
} from "./types";

export function useSettingsAccounts(check403: (res: Response) => boolean) {
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountFormData>(createEmptyAccountForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, HealthStatus>>({});
  const [checkingHealth, setCheckingHealth] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openAccountMenuId, setOpenAccountMenuId] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      if (json.success) {
        setAccounts(json.accounts || []);
        setError(null);
      } else {
        setError(json.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (!openAccountMenuId) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-account-actions-menu]")) return;
      setOpenAccountMenuId(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openAccountMenuId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const validChannels = form.channels.filter((channel) => channel.id.trim() !== "");
    const channelIdsArray = validChannels.map((channel) => channel.id.trim());
    const channelNames = Object.fromEntries(validChannels.map((channel) => [channel.id.trim(), channel.name.trim()]));
    const accountRiskOverrides: Record<string, unknown> = {};
    const channelConfigs: Record<string, unknown> = {};

    for (const channel of validChannels) {
      const channelRiskPerTradePercent = parseOptionalPositiveNumber(channel.riskPerTradePercent);
      const channelRiskOverrides: Record<string, unknown> = {};
      if (channelRiskPerTradePercent !== null) channelRiskOverrides.riskPerTradePercent = channelRiskPerTradePercent;
      if (channel.autoRaiseMinOrderMode !== "inherit") channelRiskOverrides.autoRaiseMinOrderEnabled = channel.autoRaiseMinOrderMode === "enabled";
      const channelAutoRaiseCap = parseOptionalNonNegativeNumber(channel.autoRaiseMinOrderMaxMarginUsdt);
      if (channelAutoRaiseCap !== null) channelRiskOverrides.autoRaiseMinOrderMaxMarginUsdt = channelAutoRaiseCap;
      if (Object.keys(channelRiskOverrides).length > 0) channelConfigs[channel.id.trim()] = { riskOverrides: channelRiskOverrides };
    }

    const accountRiskPerTradePercent = parseOptionalPositiveNumber(form.accountRiskPerTradePercent);
    const accountAutoRaiseCap = parseOptionalNonNegativeNumber(form.accountAutoRaiseMinOrderMaxMarginUsdt);
    if (accountRiskPerTradePercent !== null) accountRiskOverrides.riskPerTradePercent = accountRiskPerTradePercent;
    if (form.accountAutoRaiseMinOrderMode !== "inherit") accountRiskOverrides.autoRaiseMinOrderEnabled = form.accountAutoRaiseMinOrderMode === "enabled";
    if (accountAutoRaiseCap !== null) accountRiskOverrides.autoRaiseMinOrderMaxMarginUsdt = accountAutoRaiseCap;

    if (!form.name.trim()) return setAndStop(setFormError, setSaving, "Account name is required.");
    if (channelIdsArray.length === 0) return setAndStop(setFormError, setSaving, "At least one channel is required.");
    if (form.accountRiskPerTradePercent.trim() && accountRiskPerTradePercent === null) return setAndStop(setFormError, setSaving, "Account Risk Per Trade override must be a positive number.");
    if (form.accountAutoRaiseMinOrderMode === "enabled" && accountAutoRaiseCap !== null && accountAutoRaiseCap <= 0) return setAndStop(setFormError, setSaving, "Account auto-raise max margin override must be greater than 0 when enabled.");
    const invalidChannelAutoRaise = validChannels.find((channel) => channel.autoRaiseMinOrderMode === "enabled" && channel.autoRaiseMinOrderMaxMarginUsdt.trim() && parseOptionalNonNegativeNumber(channel.autoRaiseMinOrderMaxMarginUsdt) === 0);
    if (invalidChannelAutoRaise) return setAndStop(setFormError, setSaving, `Channel auto-raise max margin override for ${invalidChannelAutoRaise.id || "selected chat"} must be greater than 0 when enabled.`);
    const invalidChannelRisk = validChannels.find((channel) => channel.riskPerTradePercent.trim() && parseOptionalPositiveNumber(channel.riskPerTradePercent) === null);
    if (invalidChannelRisk) return setAndStop(setFormError, setSaving, `Channel Risk Per Trade override for ${invalidChannelRisk.id || "selected chat"} must be a positive number.`);

    const exchangeProvider = form.tradingPlatform || DEFAULT_ACCOUNT_EXCHANGE_PROVIDER;
    const exchangeConfig = getExchangeProviderConfig(exchangeProvider) || getExchangeProviderConfig(DEFAULT_EXCHANGE_PROVIDER);
    const exchangeDataPreview = buildExchangeDataPreview(exchangeProvider, form.exchangeValues);
    if (exchangeConfig?.authMode !== "none") {
      const validation = validateExchangeCredentials(exchangeProvider, exchangeDataPreview);
      if (!validation.valid) return setAndStop(setFormError, setSaving, validation.error || "Invalid exchange credentials.");
    }

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      sourceType: form.sourceType,
      channelIds: channelIdsArray,
      channelNames,
      tradingPlatform: exchangeProvider,
      exchangeData: buildExchangeDataPayload(exchangeProvider, form.exchangeValues, form.exchangeIsDemo),
      riskOverrides: Object.keys(accountRiskOverrides).length > 0 ? accountRiskOverrides : null,
      channelConfigs,
    };
    if (editingId) body.id = editingId;
    if (form.duplicateFromId && !editingId) body.duplicateFromId = form.duplicateFromId;
    if (form.sourceType === "discord") body.sourceData = { method: form.method, token: form.token || undefined, refreshToken: form.refreshToken || undefined, autoRefresh: form.autoRefresh };
    if (form.sourceType === "telegram") body.sourceData = { botToken: form.botToken || undefined };

    try {
      const res = await fetch("/api/accounts", { method: editingId ? "PUT" : "POST", headers: withActionPassword({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (check403(res)) {
        setSaving(false);
        return;
      }
      const json = await res.json();
      if (json.success) {
        setShowForm(false);
        setEditingId(null);
        setForm(createEmptyAccountForm());
        await fetchAccounts();
      } else {
        setFormError(json.error || "Failed to save");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (account: AccountData) => {
    setEditingId(account._id);
    setForm(mapAccountToEditForm(account));
    setShowForm(true);
    setFormError(null);
  };

  const handleDuplicate = (account: AccountData) => {
    setEditingId(null);
    setForm(mapAccountToDuplicateForm(account));
    setShowForm(true);
    setFormError(null);
  };

  const closeAccountActionsMenu = () => setOpenAccountMenuId(null);
  const toggleAccountActionsMenu = (accountId: string) => setOpenAccountMenuId((currentId) => currentId === accountId ? null : accountId);

  const handleDelete = async (id: string) => mutateAccount(id, setDeleting, async () => {
    const res = await fetch(`/api/accounts?id=${id}`, { method: "DELETE", headers: withActionPassword() });
    if (check403(res)) return;
    const json = await res.json();
    if (json.success) await fetchAccounts();
    else alert(`Failed: ${json.error}`);
  });

  const handleToggleActive = async (account: AccountData, newActive: boolean) => {
    await simpleAccountUpdate(check403, fetchAccounts, { id: account._id, isActive: newActive });
  };

  const handleToggleChannel = async (account: AccountData, channelId: string) => {
    const disabled = new Set(account.disabledChannelIds || []);
    if (disabled.has(channelId)) disabled.delete(channelId);
    else disabled.add(channelId);
    await simpleAccountUpdate(check403, fetchAccounts, { id: account._id, disabledChannelIds: Array.from(disabled) });
  };

  const checkHealth = async (id?: string) => {
    setCheckingHealth(id || "all");
    try {
      const res = await fetch("/api/accounts/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id || undefined }) });
      const json = await res.json();
      if (!json.success) return;
      if (id) setHealthResults((prev) => ({ ...prev, [id]: json.health }));
      else {
        const newResults: Record<string, HealthStatus> = {};
        for (const result of json.results || []) newResults[result.accountId || result.sourceId] = result.health;
        setHealthResults(newResults);
      }
    } catch (err) {
      console.error("Health check error:", err);
    } finally {
      setCheckingHealth(null);
    }
  };

  return {
    accounts, loading, error, showForm, editingId, form, saving, formError, healthResults, checkingHealth, deleting, openAccountMenuId,
    setEditingId, setForm, setShowForm, setFormError,
    handleSubmit, handleEdit, handleDuplicate, closeAccountActionsMenu, toggleAccountActionsMenu,
    handleDelete, handleToggleActive, handleToggleChannel, checkHealth,
  };
}

function setAndStop(
  setFormError: React.Dispatch<React.SetStateAction<string | null>>,
  setSaving: React.Dispatch<React.SetStateAction<boolean>>,
  message: string,
) {
  setFormError(message);
  setSaving(false);
}

async function simpleAccountUpdate(check403: (res: Response) => boolean, fetchAccounts: () => Promise<void>, body: Record<string, unknown>) {
  try {
    const res = await fetch("/api/accounts", { method: "PUT", headers: withActionPassword({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
    if (check403(res)) return;
    const json = await res.json();
    if (json.success) await fetchAccounts();
    else alert(`Failed: ${json.error}`);
  } catch (err) {
    alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
  }
}

async function mutateAccount(id: string, setDeleting: React.Dispatch<React.SetStateAction<string | null>>, run: () => Promise<void>) {
  if (!confirm("Are you sure you want to delete this account?")) return;
  setDeleting(id);
  try {
    await run();
  } finally {
    setDeleting(null);
  }
}
