"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DEFAULT_ACCOUNT_EXCHANGE_PROVIDER,
  DEFAULT_EXCHANGE_PROVIDER,
  getExchangeProviderConfig,
  getExchangeProviderOptions,
  validateExchangeCredentials,
  type ExchangeProviderConfig,
} from "@copytrade/shared/lib/exchange/provider-config";
import {
  buildExchangeDataPayload,
  buildExchangeDataPreview,
  buildExchangeFormValues,
  createEmptyExchangeFormValues,
  getExchangeFieldConfigs,
  getExchangeFieldLabel,
  getExchangeFieldPlaceholder,
  getExchangeSimulationValue,
  resolveAccountFormTradingPlatform,
  type AccountExchangeData,
  type ExchangeFormValues,
} from "./exchange-form";

// ─── Types ───────────────────────────────────────────────────

interface AccountData {
  _id: string;
  name: string;
  sourceType: string;
  sourceData: {
    method?: string;
    token?: string;
    refreshToken?: string;
    autoRefresh?: boolean;
    tokenExpiresAt?: string;
    botToken?: string;
    [key: string]: unknown;
  };
  channelIds: string[];
  channelNames?: Record<string, string>;
  disabledChannelIds?: string[];
  tradingPlatform: string;
  exchangeData?: AccountExchangeData;
  isActive: boolean;
  lastFetchedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface HealthStatus {
  valid: boolean;
  error?: string;
  needsRefresh: boolean;
}

interface ChannelEntry {
  id: string;
  name: string;
}

interface AccountFormData {
  name: string;
  sourceType: string;
  // Discord
  method: string;
  token: string;
  refreshToken: string;
  autoRefresh: boolean;
  // Telegram
  botToken: string;
  // Channels
  channels: ChannelEntry[];
  // Exchange
  tradingPlatform: string;
  exchangeValues: ExchangeFormValues;
  exchangeIsDemo: boolean;
}

const emptyForm: AccountFormData = {
  name: "",
  sourceType: "discord",
  method: "bot",
  token: "",
  refreshToken: "",
  autoRefresh: true,
  botToken: "",
  channels: [{ id: "", name: "" }],
  tradingPlatform: DEFAULT_ACCOUNT_EXCHANGE_PROVIDER,
  exchangeValues: createEmptyExchangeFormValues(),
  exchangeIsDemo: false,
};

function createEmptyAccountForm(): AccountFormData {
  return {
    ...emptyForm,
    channels: [{ id: "", name: "" }],
    exchangeValues: createEmptyExchangeFormValues(),
  };
}

interface RiskConfig {
  riskPerTradePercent: number;
  maxLeverage: number;
  minLeverage: number;
  skipNoSL: boolean;
  defaultRR: number;
  defaultPositionSize: number;
  defaultLeverage: number;
  maxPositions: number;
}

const defaultRiskConfig: RiskConfig = {
  riskPerTradePercent: 1,
  maxLeverage: 100,
  minLeverage: 1,
  skipNoSL: true,
  defaultRR: 3,
  defaultPositionSize: 50,
  defaultLeverage: 10,
  maxPositions: 5,
};

interface SignalConfigType {
  fetchLimit: number;
  timeWindowHours: number;
}

const defaultSignalConfig: SignalConfigType = {
  fetchLimit: 10,
  timeWindowHours: 24,
};

const RECOMMENDED_SCHEDULES: Record<
  string,
  { label: string; description: string }
> = {
  "signal-check": {
    label: "Every 5 minutes",
    description:
      "Check sources for new signals frequently. Recommended: 5 min.",
  },
  "position-monitor": {
    label: "Every 30 minutes",
    description: "Monitor open positions for changes. Recommended: 30 min.",
  },
  "tp-sl-monitor": {
    label: "Every 5 minutes",
    description: "Place TP/SL for filled limit orders. Recommended: 5 min.",
  },
};

const EXCHANGE_PROVIDER_OPTIONS = getExchangeProviderOptions();

function getTradingPlatformConfig(provider: string) {
  return (
    getExchangeProviderConfig(provider) ||
    getExchangeProviderConfig(DEFAULT_EXCHANGE_PROVIDER)
  );
}

// ─── Component ──────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"accounts" | "system">("accounts");

  // ─── Account state ────────────────────────────────────────
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AccountFormData>(createEmptyAccountForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<
    Record<string, HealthStatus>
  >({});
  const [checkingHealth, setCheckingHealth] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // ─── Risk state ───────────────────────────────────────────
  const [riskConfig, setRiskConfigState] =
    useState<RiskConfig>(defaultRiskConfig);
  const [riskSaving, setRiskSaving] = useState(false);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskSuccess, setRiskSuccess] = useState(false);

  // ─── Signal config state ──────────────────────────────────
  const [signalCfg, setSignalCfg] = useState({
    fetchLimit: 10,
    timeWindowHours: 24,
    batchSize: 5,
    includeImageUrls: false,
    visionAIEnabled: false,
  });
  const [signalSaving, setSignalSaving] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [signalSuccess, setSignalSuccess] = useState(false);

  // ─── Cron state ───────────────────────────────────────────
  const [cronBaseUrl, setCronBaseUrl] = useState("");
  const [cronJobs, setCronJobs] = useState<
    Array<{
      id: string;
      type: string;
      enabled: boolean;
      title: string;
      url: string;
      schedule: {
        minutes: number;
        hours: number[];
        mdays: number[];
        months: number[];
        wdays: number[];
      };
    }>
  >([
    {
      type: "signal-check",
      enabled: true,
      title: "CopyTrade — Signal Check",
      url: "/api/cron/signal-check",
      id: "",
      schedule: { minutes: 5, hours: [], mdays: [], months: [], wdays: [] },
    },
    {
      type: "position-monitor",
      enabled: true,
      title: "CopyTrade — Position Monitor",
      url: "/api/cron/position-monitor",
      id: "",
      schedule: { minutes: 30, hours: [], mdays: [], months: [], wdays: [] },
    },
    {
      type: "tp-sl-monitor",
      enabled: true,
      title: "CopyTrade — TP/SL Monitor",
      url: "/api/cron/tp-sl-monitor",
      id: "",
      schedule: { minutes: 5, hours: [], mdays: [], months: [], wdays: [] },
    },
  ]);
  const [cronSaving, setCronSaving] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);
  const [cronSuccess, setCronSuccess] = useState(false);
  const [cronPulling, setCronPulling] = useState(false);
  const [cronLiveStatus, setCronLiveStatus] = useState<
    Array<{
      type: string;
      title: string;
      enabled: boolean;
      url: string;
      status: "active" | "missing";
    }>
  >([]);

  // ─── Proxy state ──────────────────────────────────────────
  const [proxyConfig, setProxyConfig] = useState<{
    enabled: boolean;
    provider: "webshare" | "custom";
    custom?: {
      host: string;
      port: number;
      username: string;
      password: string;
    };
  } | null>(null);
  const [proxyProviderInfo, setProxyProviderInfo] = useState<{
    providerName: string;
    credentials: { username: string; password: string };
    proxies: {
      ip: string;
      port: number;
      country_code: string;
      city_name: string;
      valid: boolean;
    }[];
    ipList: string[];
    total: number;
    validCount: number;
  } | null>(null);
  const [proxyLoading, setProxyLoading] = useState(true);
  const [proxyRefreshing, setProxyRefreshing] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [customProxy, setCustomProxy] = useState({
    host: "",
    port: 1080,
    username: "",
    password: "",
  });

  // ─── Reset state ──────────────────────────────────────────
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<{
    success: boolean;
    message: string;
    results?: {
      step: string;
      status: string;
      message: string;
      details?: string[];
    }[];
  } | null>(null);
  const [resetShowConfirm, setResetShowConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  // ─── Fetch functions ──────────────────────────────────────

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

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const json = await res.json();
      if (json.success) {
        if (json.risk) setRiskConfigState(json.risk);
        if (json.signal)
          setSignalCfg({
            fetchLimit: json.signal.fetchLimit,
            timeWindowHours: json.signal.timeWindowHours,
            batchSize: json.signal.batchSize || 5,
            includeImageUrls: json.signal.includeImageUrls || false,
            visionAIEnabled: json.signal.visionAIEnabled || false,
          });
      }
    } catch {
      // Use defaults
    }
  }, []);

  const fetchProxies = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy");
      const json = await res.json();
      if (json.success) {
        setProxyConfig(json.config);
        setProxyProviderInfo(json.providerInfo || null);
        if (json.config?.custom) {
          setCustomProxy(json.config.custom);
        }
        setProxyError(null);
      } else {
        setProxyError(json.error || "Failed to load proxy config");
      }
    } catch {
      setProxyError("Failed to fetch proxy info from server.");
    } finally {
      setProxyLoading(false);
      setProxyRefreshing(false);
    }
  }, []);

  const fetchCronSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/cron-settings");
      const json = await res.json();
      if (json.success) {
        if (json.settings?.baseUrl) setCronBaseUrl(json.settings.baseUrl);
        if (json.settings?.jobs?.length > 0) setCronJobs(json.settings.jobs);
        if (json.liveStatus) setCronLiveStatus(json.liveStatus);
      }
    } catch {
      // Use defaults
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchSettings();
    fetchProxies();
    fetchCronSettings();
  }, [fetchAccounts, fetchSettings, fetchProxies, fetchCronSettings]);

  // ─── Account handlers ─────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const validChannels = form.channels.filter((c) => c.id.trim() !== "");
    const channelIdsArray = validChannels.map((c) => c.id.trim());
    const channelNamesMap: Record<string, string> = {};
    validChannels.forEach((c) => {
      if (c.name.trim()) {
        channelNamesMap[c.id.trim()] = c.name.trim();
      }
    });

    // Validation
    if (!form.name || channelIdsArray.length === 0) {
      setFormError("Name and at least one channel ID are required.");
      setSaving(false);
      return;
    }

    if (form.sourceType === "discord" && !editingId && !form.token) {
      setFormError("Discord token is required for new accounts.");
      setSaving(false);
      return;
    }

    if (form.sourceType === "telegram" && !editingId && !form.botToken) {
      setFormError("Telegram bot token is required for new accounts.");
      setSaving(false);
      return;
    }

    const exchangeConfig = getTradingPlatformConfig(form.tradingPlatform);
    const exchangeDataPreview = buildExchangeDataPreview(
      form.tradingPlatform,
      form.exchangeValues,
    );

    const exchangeValidation: {
      valid: boolean;
      error?: string;
    } =
      !editingId && exchangeConfig
        ? validateExchangeCredentials(form.tradingPlatform, exchangeDataPreview)
        : { valid: true };

    if (!exchangeValidation.valid) {
      setFormError(exchangeValidation.error || "Invalid exchange configuration.");
      setSaving(false);
      return;
    }

    try {
      // Build sourceData based on sourceType
      const sourceData: Record<string, unknown> = {};
      if (form.sourceType === "discord") {
        sourceData.method = form.method;
        if (form.token) sourceData.token = form.token;
        if (form.refreshToken) sourceData.refreshToken = form.refreshToken;
        sourceData.autoRefresh = form.autoRefresh;
      } else if (form.sourceType === "telegram") {
        if (form.botToken) sourceData.botToken = form.botToken;
      }

      // Build exchangeData
      const exchangeData = buildExchangeDataPayload(
        form.tradingPlatform,
        form.exchangeValues,
        form.exchangeIsDemo,
      );

      const body = {
        id: editingId || undefined,
        name: form.name,
        sourceType: form.sourceType,
        sourceData,
        channelIds: channelIdsArray,
        channelNames: channelNamesMap,
        tradingPlatform: form.tradingPlatform,
        exchangeData,
      };

      const res = await fetch("/api/accounts", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

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
    const sourceChannelNames = account.channelNames || {};
    setEditingId(account._id);
    setForm({
      name: account.name,
      sourceType: account.sourceType || "discord",
      // Discord fields
      method: (account.sourceData?.method as string) || "bot",
      token: "", // Leave empty = keep existing
      refreshToken: "",
      autoRefresh: (account.sourceData?.autoRefresh as boolean) ?? true,
      // Telegram fields
      botToken: "",
      // Channels
      channels: account.channelIds.map((cid: string) => ({
        id: cid,
        name: sourceChannelNames[cid] || "",
      })),
      // Exchange
      tradingPlatform: resolveAccountFormTradingPlatform(
        account.tradingPlatform,
      ),
      exchangeValues: buildExchangeFormValues(account.exchangeData),
      exchangeIsDemo: getExchangeSimulationValue(account.exchangeData),
    });
    setShowForm(true);
    setFormError(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this account?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        await fetchAccounts();
      } else {
        alert(`Failed: ${json.error}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleActive = async (
    account: AccountData,
    newActive: boolean,
  ) => {
    try {
      const res = await fetch("/api/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account._id, isActive: newActive }),
      });
      const json = await res.json();
      if (json.success) {
        await fetchAccounts();
      } else {
        alert(`Failed: ${json.error}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  };

  const handleToggleChannel = async (
    account: AccountData,
    channelId: string,
  ) => {
    const disabled = new Set(account.disabledChannelIds || []);
    if (disabled.has(channelId)) {
      disabled.delete(channelId);
    } else {
      disabled.add(channelId);
    }
    try {
      const res = await fetch("/api/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: account._id,
          disabledChannelIds: Array.from(disabled),
        }),
      });
      const json = await res.json();
      if (json.success) {
        await fetchAccounts();
      } else {
        alert(`Failed: ${json.error}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  };

  const checkHealth = async (id?: string) => {
    setCheckingHealth(id || "all");
    try {
      const res = await fetch("/api/accounts/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        if (id) {
          setHealthResults((prev) => ({
            ...prev,
            [id]: json.health,
          }));
        } else {
          const newResults: Record<string, HealthStatus> = {};
          for (const r of json.results || []) {
            newResults[r.accountId || r.sourceId] = r.health;
          }
          setHealthResults(newResults);
        }
      }
    } catch (err) {
      console.error("Health check error:", err);
    } finally {
      setCheckingHealth(null);
    }
  };

  // ─── Settings handlers ────────────────────────────────────

  const handleRiskSave = async () => {
    setRiskSaving(true);
    setRiskError(null);
    setRiskSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ risk: riskConfig }),
      });
      const json = await res.json();
      if (json.success) {
        setRiskSuccess(true);
        setTimeout(() => setRiskSuccess(false), 3000);
      } else {
        setRiskError(json.error || "Failed to save");
      }
    } catch (err) {
      setRiskError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRiskSaving(false);
    }
  };

  const handleSignalSave = async () => {
    setSignalSaving(true);
    setSignalError(null);
    setSignalSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal: signalCfg }),
      });
      const json = await res.json();
      if (json.success) {
        setSignalSuccess(true);
        setTimeout(() => setSignalSuccess(false), 3000);
      } else {
        setSignalError(json.error || "Failed to save");
      }
    } catch (err) {
      setSignalError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSignalSaving(false);
    }
  };

  const handleCronSave = async () => {
    if (!cronBaseUrl || !cronBaseUrl.startsWith("http")) {
      setCronError(
        "Base URL is required. Click '☁️ Sync from Cloud' first to auto-detect your deployment URL, or enter it manually.",
      );
      return;
    }
    setCronSaving(true);
    setCronError(null);
    setCronSuccess(false);
    try {
      const res = await fetch("/api/cron-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: cronBaseUrl, jobs: cronJobs }),
      });
      const json = await res.json();
      if (json.success) {
        setCronSuccess(true);
        if (json.settings?.jobs) setCronJobs(json.settings.jobs);
        await fetchCronSettings();
        setTimeout(() => setCronSuccess(false), 3000);
      } else {
        setCronError(json.error || "Failed to sync cron jobs");
      }
    } catch (err) {
      setCronError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCronSaving(false);
    }
  };

  const handleCronPull = async () => {
    setCronPulling(true);
    setCronError(null);
    setCronSuccess(false);
    try {
      const res = await fetch("/api/cron-settings", { method: "PUT" });
      const json = await res.json();
      if (json.success) {
        if (json.settings?.baseUrl) setCronBaseUrl(json.settings.baseUrl);
        if (json.settings?.jobs) setCronJobs(json.settings.jobs);
        if (json.liveStatus) setCronLiveStatus(json.liveStatus);
        setCronSuccess(true);
        setTimeout(() => setCronSuccess(false), 3000);
      } else {
        setCronError(json.error || "Failed to pull from cloud");
      }
    } catch (err) {
      setCronError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCronPulling(false);
    }
  };

  const handleProxySave = async () => {
    setProxySaving(true);
    setProxyError(null);
    try {
      const body: Record<string, unknown> = {
        enabled: proxyConfig?.enabled ?? false,
        provider: proxyConfig?.provider ?? "webshare",
      };
      if (proxyConfig?.provider === "custom") {
        body.custom = customProxy;
      }
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setProxyConfig(json.config);
        setProxyProviderInfo(json.providerInfo || null);
      } else {
        setProxyError(json.error || "Failed to save proxy config");
      }
    } catch (err) {
      setProxyError(
        err instanceof Error ? err.message : "Failed to save proxy config",
      );
    } finally {
      setProxySaving(false);
    }
  };

  const handleReset = async () => {
    setResetLoading(true);
    setResetResult(null);
    try {
      const res = await fetch("/api/reset-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      setResetResult(json);
    } catch (err) {
      setResetResult({
        success: false,
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setResetLoading(false);
      setResetShowConfirm(false);
      setResetConfirmText("");
    }
  };

  // ─── Loading state ────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-slate-400">Loading settings...</p>
        </div>
      </div>
    );
  }

  const activeExchangeConfig = getTradingPlatformConfig(form.tradingPlatform);
  const activeExchangeFieldConfigs = getExchangeFieldConfigs(
    form.tradingPlatform,
  );

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-700 bg-dark-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <a
                href="/"
                className="text-slate-400 hover:text-white transition text-sm shrink-0"
              >
                ← <span className="hidden sm:inline">Dashboard</span>
              </a>
              <div className="w-px h-5 sm:h-6 bg-slate-700" />
              <h1 className="text-base sm:text-xl font-bold text-white truncate">
                ⚙️ Settings
              </h1>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-slate-700 bg-dark-200">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
          <nav className="flex gap-1">
            <button
              onClick={() => setActiveTab("accounts")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === "accounts"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              📡 Accounts
            </button>
            <button
              onClick={() => setActiveTab("system")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === "system"
                  ? "border-primary-500 text-primary-400"
                  : "border-transparent text-slate-400 hover:text-slate-300"
              }`}
            >
              🔧 System Settings
            </button>
          </nav>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* ═══════════ ACCOUNTS TAB ═══════════ */}
        {activeTab === "accounts" && (
          <>
            {/* Info Banner */}
            <div className="card bg-slate-800/50 border-slate-700">
              <h2 className="text-sm font-semibold text-slate-300 mb-2">
                📡 Trading Accounts
              </h2>
              <p className="text-xs text-slate-400">
                Each account links a signal source (Discord/Telegram) with an
                exchange (OKX/Binance/Bybit/MEXC/MetaTrader/Paper). Signals
                from the source channels are auto-executed on the linked
                exchange.
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => checkHealth()}
                disabled={checkingHealth !== null}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1.5"
              >
                {checkingHealth === "all" ? (
                  <div className="spinner w-4 h-4 border-2" />
                ) : (
                  "🩺"
                )}
                Check Health
              </button>
              <button
                onClick={() => {
                  setEditingId(null);
                  setForm(createEmptyAccountForm());
                  setShowForm(true);
                  setFormError(null);
                }}
                className="bg-primary-600 hover:bg-primary-700 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1.5"
              >
                ➕ Add Account
              </button>
            </div>

            {/* Add/Edit Form */}
            {showForm && (
              <div className="card border-primary-700/50">
                <h3 className="text-lg font-semibold mb-4">
                  {editingId ? "✏️ Edit Account" : "➕ Add New Account"}
                </h3>
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* ── Basic Info ── */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">
                        Account Name *
                      </label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                        placeholder="e.g., VIP Signals Group"
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">
                        Source Type *
                      </label>
                      <select
                        value={form.sourceType}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            sourceType: e.target.value,
                          })
                        }
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                      >
                        <option value="discord">🤖 Discord</option>
                        <option value="telegram">✈️ Telegram</option>
                      </select>
                    </div>
                  </div>

                  {/* ── Source Config (Discord) ── */}
                  {form.sourceType === "discord" && (
                    <div className="space-y-4 border border-slate-700 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-slate-300">
                        🤖 Discord Configuration
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-slate-400 mb-1">
                            Method *
                          </label>
                          <select
                            value={form.method}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                method: e.target.value as "bot" | "user",
                              })
                            }
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                          >
                            <option value="bot">
                              🤖 Bot Token (requires bot in server)
                            </option>
                            <option value="user">
                              👤 User Token (personal account)
                            </option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm text-slate-400 mb-1">
                            {editingId
                              ? "New Token (leave empty to keep)"
                              : "Token *"}
                          </label>
                          <input
                            type="password"
                            value={form.token}
                            onChange={(e) =>
                              setForm({ ...form, token: e.target.value })
                            }
                            placeholder={
                              editingId
                                ? "Leave empty to keep current token"
                                : "Discord token"
                            }
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-slate-400 mb-1">
                            Refresh Token (optional)
                          </label>
                          <input
                            type="password"
                            value={form.refreshToken}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                refreshToken: e.target.value,
                              })
                            }
                            placeholder="For auto-refresh when token expires"
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="autoRefresh"
                            checked={form.autoRefresh}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                autoRefresh: e.target.checked,
                              })
                            }
                            className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                          />
                          <label
                            htmlFor="autoRefresh"
                            className="text-sm text-slate-400"
                          >
                            Auto health check before each signal fetch
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Source Config (Telegram) ── */}
                  {form.sourceType === "telegram" && (
                    <div className="space-y-4 border border-slate-700 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-slate-300">
                        ✈️ Telegram Configuration
                      </h4>
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">
                          {editingId
                            ? "Bot Token (leave empty to keep)"
                            : "Bot Token *"}
                        </label>
                        <input
                          type="password"
                          value={form.botToken}
                          onChange={(e) =>
                            setForm({ ...form, botToken: e.target.value })
                          }
                          placeholder={
                            editingId
                              ? "Leave empty to keep current token"
                              : "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                          }
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                          Get this from @BotFather on Telegram
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ── Channels ── */}
                  <div className="space-y-2">
                    <label className="block text-sm text-slate-400">
                      Channels *
                    </label>
                    <div className="space-y-2">
                      {form.channels.map((ch, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            type="text"
                            value={ch.id}
                            onChange={(e) => {
                              const updated = [...form.channels];
                              updated[idx] = {
                                ...updated[idx],
                                id: e.target.value,
                              };
                              setForm({ ...form, channels: updated });
                            }}
                            placeholder={
                              form.sourceType === "telegram"
                                ? "@channel_username or -100xxx"
                                : "Channel ID"
                            }
                            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none font-mono"
                          />
                          <input
                            type="text"
                            value={ch.name}
                            onChange={(e) => {
                              const updated = [...form.channels];
                              updated[idx] = {
                                ...updated[idx],
                                name: e.target.value,
                              };
                              setForm({ ...form, channels: updated });
                            }}
                            placeholder="Display name (optional)"
                            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                          />
                          {form.channels.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const updated = form.channels.filter(
                                  (_, i) => i !== idx,
                                );
                                setForm({ ...form, channels: updated });
                              }}
                              className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-2 rounded-lg text-sm transition border border-red-700/50"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            channels: [...form.channels, { id: "", name: "" }],
                          })
                        }
                        className="text-xs text-primary-400 hover:text-primary-300 transition flex items-center gap-1"
                      >
                        ➕ Add another channel
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      {form.sourceType === "discord"
                        ? "To get channel ID: Enable Developer Mode in Discord → Right click channel → Copy Channel ID"
                        : "Use @username for public channels or numeric ID for private channels"}
                    </p>
                  </div>

                  {/* ── Exchange Config ── */}
                  <div className="space-y-4 border border-slate-700 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-slate-300">
                      💱 Exchange Configuration
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-slate-400 mb-1">
                          Exchange Platform *
                        </label>
                        <select
                          value={form.tradingPlatform}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              tradingPlatform: e.target.value,
                            })
                          }
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                        >
                          {EXCHANGE_PROVIDER_OPTIONS.map((option: ExchangeProviderConfig) => (
                            <option key={option.provider} value={option.provider}>
                              {option.optionLabel || option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="exchangeIsDemo"
                          checked={form.exchangeIsDemo}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              exchangeIsDemo: e.target.checked,
                            })
                          }
                          className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                        />
                        <label
                          htmlFor="exchangeIsDemo"
                          className="text-sm text-slate-400"
                        >
                          Demo / Simulated Trading
                        </label>
                      </div>
                    </div>

                    {activeExchangeConfig?.authMode !== "none" && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {activeExchangeFieldConfigs.map((fieldConfig) => {
                          const value = form.exchangeValues[fieldConfig.field] || "";
                          const className = `w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white ${
                            fieldConfig.monospace ? "font-mono " : ""
                          }placeholder-slate-500 focus:border-primary-500 focus:outline-none`;

                          return (
                            <div key={fieldConfig.field}>
                              <label className="block text-sm text-slate-400 mb-1">
                                {getExchangeFieldLabel(
                                  fieldConfig,
                                  activeExchangeConfig?.requiredFields || [],
                                  Boolean(editingId),
                                )}
                              </label>
                              {fieldConfig.inputType === "select" ? (
                                <select
                                  value={value}
                                  onChange={(e) =>
                                    setForm({
                                      ...form,
                                      exchangeValues: {
                                        ...form.exchangeValues,
                                        [fieldConfig.field]: e.target.value,
                                      },
                                    })
                                  }
                                  className={className}
                                >
                                  {(fieldConfig.options || []).map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={fieldConfig.inputType}
                                  value={value}
                                  onChange={(e) =>
                                    setForm({
                                      ...form,
                                      exchangeValues: {
                                        ...form.exchangeValues,
                                        [fieldConfig.field]: e.target.value,
                                      },
                                    })
                                  }
                                  placeholder={getExchangeFieldPlaceholder(
                                    fieldConfig,
                                    Boolean(editingId),
                                  )}
                                  className={className}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {formError && (
                    <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
                      ⚠️ {formError}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-medium transition"
                    >
                      {saving ? (
                        <span className="flex items-center gap-2">
                          <div className="spinner w-4 h-4 border-2" /> Saving...
                        </span>
                      ) : editingId ? (
                        "💾 Update Account"
                      ) : (
                        "✅ Create Account"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditingId(null);
                        setForm(createEmptyAccountForm());
                        setFormError(null);
                      }}
                      className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
                ⚠️ {error}
              </div>
            )}

            {/* Account Cards */}
            {accounts.length === 0 && !showForm ? (
              <div className="card text-center py-8">
                <p className="text-slate-400 text-lg mb-2">No accounts yet</p>
                <p className="text-slate-500 text-sm mb-4">
                  Add your first trading account to start receiving and
                  executing signals.
                </p>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setForm(createEmptyAccountForm());
                    setShowForm(true);
                    setFormError(null);
                  }}
                  className="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg text-sm font-medium transition"
                >
                  ➕ Add Account
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {accounts.map((account) => {
                  const health = healthResults[account._id];
                  return (
                    <div key={account._id} className="card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Header row */}
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <h3 className="text-lg font-semibold text-white truncate">
                              {account.name}
                            </h3>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                              {account.sourceType === "telegram"
                                ? "✈️ Telegram"
                                : "🤖 Discord"}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                              💱{" "}
                              {account.tradingPlatform?.toUpperCase() ||
                                DEFAULT_ACCOUNT_EXCHANGE_PROVIDER.toUpperCase()}
                            </span>
                            {Boolean(account.exchangeData?.simulated) && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-700/50 text-amber-300">
                                DEMO
                              </span>
                            )}
                            <button
                              onClick={() =>
                                handleToggleActive(account, !account.isActive)
                              }
                              className={`text-xs px-2 py-0.5 rounded-full cursor-pointer transition ${
                                account.isActive
                                  ? "bg-emerald-700/50 text-emerald-300"
                                  : "bg-red-700/50 text-red-300"
                              }`}
                            >
                              {account.isActive ? "● ACTIVE" : "○ DISABLED"}
                            </button>
                          </div>

                          {/* Health */}
                          {health && (
                            <div
                              className={`text-xs mb-2 ${health.valid ? "text-emerald-400" : "text-red-400"}`}
                            >
                              {health.valid
                                ? "✅ Token valid"
                                : `❌ ${health.error || "Invalid token"}`}
                              {health.needsRefresh && " ⚠️ Needs refresh"}
                            </div>
                          )}

                          {/* Channels */}
                          <div className="flex flex-wrap gap-1.5">
                            {(account.channelIds || []).map((cid: string) => {
                              const isDisabled = (
                                account.disabledChannelIds || []
                              ).includes(cid);
                              const cname = account.channelNames?.[cid] || cid;
                              return (
                                <button
                                  key={cid}
                                  onClick={() =>
                                    handleToggleChannel(account, cid)
                                  }
                                  className={`text-xs px-2 py-1 rounded transition border ${
                                    isDisabled
                                      ? "bg-red-900/30 border-red-700/50 text-red-400 line-through"
                                      : "bg-slate-700/50 border-slate-600/50 text-slate-300 hover:bg-slate-600/50"
                                  }`}
                                  title={
                                    isDisabled
                                      ? `Click to enable ${cid}`
                                      : `Click to disable ${cid}`
                                  }
                                >
                                  {cname}
                                </button>
                              );
                            })}
                          </div>

                          {/* Meta info */}
                          <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                            {account.lastFetchedAt && (
                              <span>
                                Last fetch:{" "}
                                {new Date(
                                  account.lastFetchedAt,
                                ).toLocaleString()}
                              </span>
                            )}
                            {account.lastError && (
                              <span className="text-red-400">
                                Error: {account.lastError}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => checkHealth(account._id)}
                            disabled={checkingHealth !== null}
                            className="text-slate-400 hover:text-emerald-400 transition p-1.5"
                            title="Check health"
                          >
                            {checkingHealth === account._id ? (
                              <div className="spinner w-4 h-4 border-2" />
                            ) : (
                              "🩺"
                            )}
                          </button>
                          <button
                            onClick={() => handleEdit(account)}
                            className="text-slate-400 hover:text-white transition p-1.5"
                            title="Edit"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDelete(account._id)}
                            disabled={deleting === account._id}
                            className="text-slate-400 hover:text-red-400 transition p-1.5"
                            title="Delete"
                          >
                            {deleting === account._id ? (
                              <div className="spinner w-4 h-4 border-2" />
                            ) : (
                              "🗑️"
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══════════ SYSTEM SETTINGS TAB ═══════════ */}
        {activeTab === "system" && (
          <>
            {/* ─── Risk Management ──────────────────── */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">🛡️ Risk Management</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Risk Per Trade (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={riskConfig.riskPerTradePercent}
                    onChange={(e) =>
                      setRiskConfigState({
                        ...riskConfig,
                        riskPerTradePercent: parseFloat(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Default Position Size (USDT)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={riskConfig.defaultPositionSize}
                    onChange={(e) =>
                      setRiskConfigState({
                        ...riskConfig,
                        defaultPositionSize: parseFloat(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Default Leverage
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={riskConfig.defaultLeverage}
                    onChange={(e) =>
                      setRiskConfigState({
                        ...riskConfig,
                        defaultLeverage: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Max Leverage
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={riskConfig.maxLeverage}
                    onChange={(e) =>
                      setRiskConfigState({
                        ...riskConfig,
                        maxLeverage: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Default Risk/Reward Ratio
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={riskConfig.defaultRR}
                    onChange={(e) =>
                      setRiskConfigState({
                        ...riskConfig,
                        defaultRR: parseFloat(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Max Open Positions
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={riskConfig.maxPositions}
                    onChange={(e) =>
                      setRiskConfigState({
                        ...riskConfig,
                        maxPositions: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  id="skipNoSL"
                  checked={riskConfig.skipNoSL}
                  onChange={(e) =>
                    setRiskConfigState({
                      ...riskConfig,
                      skipNoSL: e.target.checked,
                    })
                  }
                  className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="skipNoSL" className="text-sm text-slate-400">
                  Skip signals without Stop Loss
                </label>
              </div>
              {riskError && (
                <p className="text-red-400 text-xs mt-2">⚠️ {riskError}</p>
              )}
              {riskSuccess && (
                <p className="text-emerald-400 text-xs mt-2">
                  ✅ Risk config saved
                </p>
              )}
              <button
                onClick={handleRiskSave}
                disabled={riskSaving}
                className="mt-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                {riskSaving ? "Saving..." : "💾 Save Risk Config"}
              </button>
            </div>

            {/* ─── Signal Configuration ────────────── */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">
                📡 Signal Configuration
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Fetch Limit (messages per channel)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={signalCfg.fetchLimit}
                    onChange={(e) =>
                      setSignalCfg({
                        ...signalCfg,
                        fetchLimit: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Time Window (hours)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={signalCfg.timeWindowHours}
                    onChange={(e) =>
                      setSignalCfg({
                        ...signalCfg,
                        timeWindowHours: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Batch Size (signals per AI call)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={signalCfg.batchSize}
                    onChange={(e) =>
                      setSignalCfg({
                        ...signalCfg,
                        batchSize: parseInt(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-2 justify-center">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="includeImageUrls"
                      checked={signalCfg.includeImageUrls}
                      onChange={(e) =>
                        setSignalCfg({
                          ...signalCfg,
                          includeImageUrls: e.target.checked,
                        })
                      }
                      className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                    />
                    <label
                      htmlFor="includeImageUrls"
                      className="text-sm text-slate-400"
                    >
                      Include image URLs in AI analysis
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="visionAIEnabled"
                      checked={signalCfg.visionAIEnabled}
                      onChange={(e) =>
                        setSignalCfg({
                          ...signalCfg,
                          visionAIEnabled: e.target.checked,
                        })
                      }
                      className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                    />
                    <label
                      htmlFor="visionAIEnabled"
                      className="text-sm text-slate-400"
                    >
                      Enable Vision AI (Gemini chart reading)
                    </label>
                  </div>
                </div>
              </div>
              {signalError && (
                <p className="text-red-400 text-xs mt-2">⚠️ {signalError}</p>
              )}
              {signalSuccess && (
                <p className="text-emerald-400 text-xs mt-2">
                  ✅ Signal config saved
                </p>
              )}
              <button
                onClick={handleSignalSave}
                disabled={signalSaving}
                className="mt-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                {signalSaving ? "Saving..." : "💾 Save Signal Config"}
              </button>
            </div>

            {/* ─── Cron Jobs ────────────────────────── */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">
                ⏰ Cron Jobs (Scheduled Tasks)
              </h2>

              {/* Base URL */}
              <div className="mb-4">
                <label className="block text-xs text-slate-400 mb-1">
                  Deployment Base URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={cronBaseUrl}
                    onChange={(e) => setCronBaseUrl(e.target.value)}
                    placeholder="https://your-app.vercel.app"
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                  />
                  <button
                    onClick={handleCronPull}
                    disabled={cronPulling}
                    className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-2 rounded-lg text-sm transition whitespace-nowrap"
                  >
                    {cronPulling ? "..." : "☁️ Sync from Cloud"}
                  </button>
                </div>
              </div>

              {/* Jobs */}
              <div className="space-y-3">
                {cronJobs.map((job, idx) => {
                  const recommended =
                    RECOMMENDED_SCHEDULES[job.type]?.label || "Custom";
                  const liveJob = cronLiveStatus.find(
                    (l) => l.type === job.type,
                  );
                  return (
                    <div
                      key={job.type}
                      className="bg-slate-800/50 border border-slate-700 rounded-lg p-3"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={job.enabled}
                            onChange={(e) => {
                              const updated = [...cronJobs];
                              updated[idx] = {
                                ...updated[idx],
                                enabled: e.target.checked,
                              };
                              setCronJobs(updated);
                            }}
                            className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-sm font-medium text-white">
                            {job.title}
                          </span>
                          {liveJob && (
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${liveJob.status === "active" ? "bg-emerald-700/50 text-emerald-300" : "bg-red-700/50 text-red-300"}`}
                            >
                              {liveJob.status === "active"
                                ? "LIVE"
                                : "NOT FOUND"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Every</span>
                          <input
                            type="number"
                            min="1"
                            max="1440"
                            value={job.schedule.minutes}
                            onChange={(e) => {
                              const updated = [...cronJobs];
                              updated[idx] = {
                                ...updated[idx],
                                schedule: {
                                  ...updated[idx].schedule,
                                  minutes: parseInt(e.target.value),
                                },
                              };
                              setCronJobs(updated);
                            }}
                            className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white text-center"
                          />
                          <span className="text-xs text-slate-500">min</span>
                          <span className="text-xs text-slate-500">
                            (rec: {recommended})
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {cronError && (
                <p className="text-red-400 text-xs mt-2">⚠️ {cronError}</p>
              )}
              {cronSuccess && (
                <p className="text-emerald-400 text-xs mt-2">
                  ✅ Cron jobs synced
                </p>
              )}
              <button
                onClick={handleCronSave}
                disabled={cronSaving}
                className="mt-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                {cronSaving ? "Syncing..." : "🔄 Sync Cron Jobs to Cloud"}
              </button>
            </div>

            {/* ─── Proxy Configuration ─────────────── */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">
                🌐 Proxy Configuration
              </h2>

              {proxyLoading ? (
                <div className="spinner mx-auto" />
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <input
                      type="checkbox"
                      checked={proxyConfig?.enabled ?? false}
                      onChange={(e) =>
                        setProxyConfig({
                          ...proxyConfig,
                          enabled: e.target.checked,
                          provider:
                            proxyConfig?.provider || ("webshare" as const),
                        })
                      }
                      className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                      id="proxyEnabled"
                    />
                    <label
                      htmlFor="proxyEnabled"
                      className="text-sm text-slate-400"
                    >
                      Enable Proxy for Exchange API Calls
                    </label>
                  </div>

                  {proxyConfig?.enabled && (
                    <>
                      <div className="mb-4">
                        <label className="block text-xs text-slate-400 mb-1">
                          Provider
                        </label>
                        <select
                          value={proxyConfig?.provider || "webshare"}
                          onChange={(e) =>
                            setProxyConfig({
                              ...proxyConfig,
                              provider: e.target.value as "webshare" | "custom",
                            })
                          }
                          className="w-full sm:w-64 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                        >
                          <option value="webshare">Webshare (Static IP)</option>
                          <option value="custom">Custom Proxy</option>
                        </select>
                      </div>

                      {proxyConfig?.provider === "custom" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">
                              Host
                            </label>
                            <input
                              type="text"
                              value={customProxy.host}
                              onChange={(e) =>
                                setCustomProxy({
                                  ...customProxy,
                                  host: e.target.value,
                                })
                              }
                              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">
                              Port
                            </label>
                            <input
                              type="number"
                              value={customProxy.port}
                              onChange={(e) =>
                                setCustomProxy({
                                  ...customProxy,
                                  port: parseInt(e.target.value),
                                })
                              }
                              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">
                              Username
                            </label>
                            <input
                              type="text"
                              value={customProxy.username}
                              onChange={(e) =>
                                setCustomProxy({
                                  ...customProxy,
                                  username: e.target.value,
                                })
                              }
                              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">
                              Password
                            </label>
                            <input
                              type="password"
                              value={customProxy.password}
                              onChange={(e) =>
                                setCustomProxy({
                                  ...customProxy,
                                  password: e.target.value,
                                })
                              }
                              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {proxyProviderInfo && (
                        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 mb-4">
                          <p className="text-xs text-slate-400 mb-1">
                            Proxy IPs ({proxyProviderInfo.validCount}/
                            {proxyProviderInfo.total} valid):
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {proxyProviderInfo.ipList.map((ip) => (
                              <span
                                key={ip}
                                className="text-xs font-mono bg-slate-700 px-1.5 py-0.5 rounded text-slate-300"
                              >
                                {ip}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {proxyError && (
                    <p className="text-red-400 text-xs mb-2">⚠️ {proxyError}</p>
                  )}
                  <button
                    onClick={handleProxySave}
                    disabled={proxySaving}
                    className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    {proxySaving ? "Saving..." : "💾 Save Proxy Config"}
                  </button>
                </>
              )}
            </div>

            {/* ─── Reset ────────────────────────────── */}
            <div className="card border-red-700/50">
              <h2 className="text-lg font-semibold mb-2 text-red-400">
                ⚠️ Danger Zone
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                This will delete ALL positions, drafts, and trade logs. Account
                configurations will be preserved.
              </p>

              {!resetShowConfirm ? (
                <button
                  onClick={() => setResetShowConfirm(true)}
                  className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-medium transition"
                >
                  🗑️ Reset All Data
                </button>
              ) : (
                <div className="space-y-3 bg-red-900/20 border border-red-700/50 rounded-lg p-4">
                  <p className="text-sm text-red-300">
                    Type <strong>RESET</strong> to confirm:
                  </p>
                  <input
                    type="text"
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    placeholder="RESET"
                    className="w-full sm:w-48 bg-slate-800 border border-red-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleReset}
                      disabled={resetConfirmText !== "RESET" || resetLoading}
                      className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
                    >
                      {resetLoading ? "Resetting..." : "🗑️ Confirm Reset"}
                    </button>
                    <button
                      onClick={() => {
                        setResetShowConfirm(false);
                        setResetConfirmText("");
                      }}
                      className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {resetResult && (
                <div
                  className={`mt-3 rounded-lg p-3 text-sm ${
                    resetResult.success
                      ? "bg-emerald-900/30 text-emerald-300"
                      : "bg-red-900/30 text-red-300"
                  }`}
                >
                  <p>{resetResult.message}</p>
                  {resetResult.results && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {resetResult.results.map((r, i) => (
                        <li key={i}>
                          {r.status === "success" ? "✅" : "❌"} {r.step}:{" "}
                          {r.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
