"use client";

import { useState, useEffect, useCallback } from "react";

interface DiscordSource {
  _id: string;
  name: string;
  method: "bot" | "user";
  token: string;
  refreshToken?: string;
  channelIds: string[];
  isActive: boolean;
  lastFetchedAt?: string;
  lastError?: string;
  tokenExpiresAt?: string;
  autoRefresh: boolean;
  createdAt: string;
  updatedAt: string;
}

interface HealthStatus {
  valid: boolean;
  error?: string;
  needsRefresh: boolean;
}

interface SourceFormData {
  name: string;
  method: "bot" | "user";
  token: string;
  refreshToken: string;
  channelIds: string; // comma-separated
  autoRefresh: boolean;
}

const emptyForm: SourceFormData = {
  name: "",
  method: "bot",
  token: "",
  refreshToken: "",
  channelIds: "",
  autoRefresh: true,
};

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

export default function SettingsPage() {
  const [sources, setSources] = useState<DiscordSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SourceFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<
    Record<string, HealthStatus>
  >({});
  const [checkingHealth, setCheckingHealth] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showExtract, setShowExtract] = useState(false);
  const [extractToken, setExtractToken] = useState("");
  const [extractName, setExtractName] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  // Risk management state
  const [riskConfig, setRiskConfigState] =
    useState<RiskConfig>(defaultRiskConfig);
  const [riskSaving, setRiskSaving] = useState(false);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskSuccess, setRiskSuccess] = useState(false);

  // Reset state
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

  // Signal config state
  const [signalCfg, setSignalCfg] = useState({
    fetchLimit: 10,
    timeWindowHours: 24,
    batchSize: 5,
    includeImageUrls: false,
  });
  const [signalSaving, setSignalSaving] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [signalSuccess, setSignalSuccess] = useState(false);

  // Proxy state
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
  const [showProxyPasswords, setShowProxyPasswords] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  // Custom proxy form
  const [customProxy, setCustomProxy] = useState({
    host: "",
    port: 1080,
    username: "",
    password: "",
  });

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/discord-sources");
      const json = await res.json();
      if (json.success) {
        setSources(json.sources);
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

  useEffect(() => {
    fetchSources();
    fetchSettings();
    fetchProxies();
  }, [fetchSources, fetchSettings, fetchProxies]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const channelIdsArray = form.channelIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (
      !form.name ||
      (!editingId && !form.token) ||
      channelIdsArray.length === 0
    ) {
      setFormError(
        editingId
          ? "Name and at least one channel ID are required."
          : "Name, token, and at least one channel ID are required.",
      );
      setSaving(false);
      return;
    }

    try {
      let res: Response;
      if (editingId) {
        res = await fetch("/api/discord-sources", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingId,
            name: form.name,
            method: form.method,
            token: form.token,
            refreshToken: form.refreshToken || undefined,
            channelIds: channelIdsArray,
            autoRefresh: form.autoRefresh,
          }),
        });
      } else {
        res = await fetch("/api/discord-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            method: form.method,
            token: form.token,
            refreshToken: form.refreshToken || undefined,
            channelIds: channelIdsArray,
            autoRefresh: form.autoRefresh,
          }),
        });
      }

      const json = await res.json();
      if (json.success) {
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm);
        await fetchSources();
      } else {
        setFormError(json.error || "Failed to save");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (source: DiscordSource) => {
    setEditingId(source._id);
    setForm({
      name: source.name,
      method: source.method,
      token: "", // Leave empty = keep existing token
      refreshToken: "", // Leave empty = keep existing
      channelIds: source.channelIds.join(", "),
      autoRefresh: source.autoRefresh,
    });
    setShowForm(true);
    setFormError(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this Discord source?"))
      return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/discord-sources?id=${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (json.success) {
        await fetchSources();
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
    source: DiscordSource,
    newActive: boolean,
  ) => {
    try {
      const res = await fetch("/api/discord-sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: source._id, isActive: newActive }),
      });
      const json = await res.json();
      if (json.success) {
        await fetchSources();
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
      const res = await fetch("/api/discord-sources/health", {
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
          // All results
          const newResults: Record<string, HealthStatus> = {};
          for (const r of json.results || []) {
            newResults[r.sourceId] = r.health;
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-700 bg-dark-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <a
                href="/"
                className="text-slate-400 hover:text-white transition"
              >
                ← Dashboard
              </a>
              <div className="w-px h-6 bg-slate-700" />
              <h1 className="text-xl font-bold text-white">⚙️ Settings</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => checkHealth()}
                disabled={checkingHealth !== null}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                {checkingHealth === "all" ? (
                  <div className="spinner w-4 h-4 border-2" />
                ) : (
                  "🩺"
                )}
                Check All Health
              </button>
              <button
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                  setShowForm(true);
                  setFormError(null);
                }}
                className="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                ➕ Add Source
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Info Banner */}
        <div className="card bg-slate-800/50 border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">
            📡 Discord Sources
          </h2>
          <p className="text-xs text-slate-400">
            Configure multiple Discord servers and channels to monitor for
            trading signals. Each source can use a Bot token (requires bot in
            server) or a User token (personal account). Token health is checked
            automatically before each signal fetch. If a token expires, the
            source is disabled — update the token here to re-enable.
          </p>
        </div>

        {/* Add/Edit Form */}
        {showForm && (
          <div className="card border-primary-700/50">
            <h3 className="text-lg font-semibold mb-4">
              {editingId ? "✏️ Edit Source" : "➕ Add New Source"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Source Name *
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., VIP Signals Group"
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                  />
                </div>
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
                    {editingId ? "New Token (leave empty to keep)" : "Token *"}
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
                      setForm({ ...form, refreshToken: e.target.value })
                    }
                    placeholder="For auto-refresh when token expires"
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Channel IDs * (comma-separated)
                </label>
                <input
                  type="text"
                  value={form.channelIds}
                  onChange={(e) =>
                    setForm({ ...form, channelIds: e.target.value })
                  }
                  placeholder="e.g., 123456789, 987654321"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">
                  To get channel ID: Enable Developer Mode in Discord → Right
                  click channel → Copy Channel ID
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoRefresh"
                  checked={form.autoRefresh}
                  onChange={(e) =>
                    setForm({ ...form, autoRefresh: e.target.checked })
                  }
                  className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="autoRefresh" className="text-sm text-slate-400">
                  Auto health check before each signal fetch (recommended)
                </label>
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
                      <div className="spinner w-4 h-4 border-2" /> Validating &
                      Saving...
                    </span>
                  ) : editingId ? (
                    "💾 Update Source"
                  ) : (
                    "✅ Create Source"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setForm(emptyForm);
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
          <div className="card border-red-700/50 bg-red-950/20">
            <p className="text-red-400 text-sm">⚠️ {error}</p>
          </div>
        )}

        {/* Sources List */}
        {sources.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-5xl mb-3">📡</div>
            <h3 className="text-lg font-semibold text-white mb-2">
              No Discord Sources Configured
            </h3>
            <p className="text-sm text-slate-400 mb-4 max-w-md mx-auto">
              Add your first Discord source to start monitoring trading signal
              channels. You can configure multiple servers and channels.
            </p>
            <button
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
                setShowForm(true);
              }}
              className="bg-primary-600 hover:bg-primary-700 px-6 py-2 rounded-lg text-sm font-medium transition"
            >
              ➕ Add Your First Source
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {sources.map((source) => {
              const health = healthResults[source._id];
              return (
                <div
                  key={source._id}
                  className={`card border ${
                    !source.isActive
                      ? "border-red-700/50 bg-red-950/10"
                      : source.lastError
                        ? "border-amber-700/50 bg-amber-950/10"
                        : "border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            source.isActive ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                        <span className="text-lg font-bold text-white">
                          {source.name}
                        </span>
                        <span
                          className={`badge ${source.method === "bot" ? "badge-info" : "badge-warning"}`}
                        >
                          {source.method === "bot" ? "🤖 Bot" : "👤 User"}
                        </span>
                        {health && (
                          <span
                            className={`badge ${health.valid ? "badge-success" : "badge-danger"}`}
                          >
                            {health.valid ? "✅ Healthy" : "❌ Unhealthy"}
                          </span>
                        )}
                        {!source.isActive && (
                          <span className="badge badge-danger">Disabled</span>
                        )}
                      </div>

                      {/* Token */}
                      <div className="text-sm text-slate-400 mb-1">
                        <span className="text-slate-500">Token:</span>{" "}
                        <code className="text-xs bg-slate-800 px-1.5 py-0.5 rounded">
                          {source.token}
                        </code>
                      </div>

                      {/* Channels */}
                      <div className="text-sm text-slate-400 mb-2">
                        <span className="text-slate-500">
                          Channels ({source.channelIds.length}):
                        </span>{" "}
                        {source.channelIds.map((cid, i) => (
                          <code
                            key={i}
                            className="text-xs bg-slate-800 px-1.5 py-0.5 rounded mr-1"
                          >
                            {cid}
                          </code>
                        ))}
                      </div>

                      {/* Status info */}
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                        {source.lastFetchedAt && (
                          <span>
                            🕐 Last fetch:{" "}
                            {new Date(source.lastFetchedAt).toLocaleString()}
                          </span>
                        )}
                        {source.lastError && (
                          <span className="text-red-400">
                            ⚠️ Error: {source.lastError}
                          </span>
                        )}
                        {source.autoRefresh && (
                          <span className="text-emerald-400">
                            🔄 Auto health check
                          </span>
                        )}
                      </div>

                      {/* Health Details */}
                      {health && !health.valid && (
                        <div className="mt-2 bg-red-900/30 border border-red-800/50 rounded px-3 py-2 text-xs text-red-300">
                          <p className="font-semibold mb-1">
                            Token Health Issue:
                          </p>
                          <p>{health.error}</p>
                          {health.needsRefresh && (
                            <p className="mt-1 text-amber-300">
                              💡 Update the token to re-enable this source.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 min-w-[140px]">
                      <button
                        onClick={() =>
                          handleToggleActive(source, !source.isActive)
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                          source.isActive
                            ? "bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50"
                            : "bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-700/50"
                        }`}
                      >
                        {source.isActive ? "⏸ Disable" : "▶ Enable"}
                      </button>
                      <button
                        onClick={() => checkHealth(source._id)}
                        disabled={checkingHealth === source._id}
                        className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs transition"
                      >
                        {checkingHealth === source._id ? (
                          <span className="flex items-center gap-1">
                            <div className="spinner w-3 h-3 border-2" />{" "}
                            Checking...
                          </span>
                        ) : (
                          "🩺 Health"
                        )}
                      </button>
                      <button
                        onClick={() => handleEdit(source)}
                        className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg text-xs transition"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDelete(source._id)}
                        disabled={deleting === source._id}
                        className="bg-red-600/20 text-red-400 hover:bg-red-600/30 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs transition border border-red-700/50"
                      >
                        {deleting === source._id ? (
                          <span className="flex items-center gap-1">
                            <div className="spinner w-3 h-3 border-2" />{" "}
                            Deleting...
                          </span>
                        ) : (
                          "🗑 Delete"
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Auto Extract Token */}
        <div className="card border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-300">
              🪄 Auto-Extract User Token
            </h3>
            <button
              onClick={() => setShowExtract(!showExtract)}
              className="text-xs text-primary-400 hover:text-primary-300 transition"
            >
              {showExtract ? "▼ Hide" : "▶ Show"} extraction tool
            </button>
          </div>

          {showExtract && (
            <div className="space-y-4">
              <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-3 text-xs text-amber-300">
                <p className="font-semibold mb-1">⚠️ Important Notice</p>
                <p>
                  This extracts your personal Discord user token. It is against
                  Discord ToS and could result in account termination. Use at
                  your own risk. Never share your token with anyone.
                </p>
              </div>

              {/* Method 1: Console Script */}
              <div className="border border-slate-600 rounded-lg overflow-hidden">
                <div className="bg-slate-800 px-4 py-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">
                    📋 Method 1: Browser Console Script
                  </span>
                  <button
                    onClick={() => {
                      const script = `(async()=>{try{const w=(window.webpackChunkdiscord_app||[]).flatMap(x=>x[1].modules||x[1]);const t=Object.values(w).find(m=>m?.exports?.default?.getToken!==void 0)?.exports?.default?.getToken();if(t){const s=(Object.values(w).find(m=>m?.exports?.default?.getGuilds)?.exports?.default?.getGuilds?.()||{});const guilds=Object.entries(s);let channels=[];guilds.forEach(([gid,g])=>{g.channels?.forEach(ch=>{if(ch.type===0||ch.type===5)channels.push(ch.id)})});const uniqueChannels=[...new Set(channels)].slice(0,20);window.copytradeToken=t;window.copytradeChannels=uniqueChannels;console.log('%c✅ Token Extracted!','color:#22c55e;font-size:16px;font-weight:bold');console.log('Token:',t);console.log('Channels:',uniqueChannels);console.log('%cCopy the token below and paste it in CopyTrade Settings:','color:#60a5fa;font-size:12px');console.log(t)}else{console.error('Could not find token. Make sure you are on discord.com/app')}}catch(e){console.error('Extraction failed:',e)}})();`;
                      navigator.clipboard.writeText(script);
                      setCopiedScript(true);
                      setTimeout(() => setCopiedScript(false), 3000);
                    }}
                    className="bg-primary-600 hover:bg-primary-700 px-3 py-1 rounded text-xs font-medium transition"
                  >
                    {copiedScript ? "✅ Copied!" : "📋 Copy Script"}
                  </button>
                </div>
                <div className="px-4 py-3 space-y-2">
                  <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-400">
                    <li>
                      Open{" "}
                      <a
                        href="https://discord.com/app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-400 hover:text-primary-300 underline"
                      >
                        Discord Web App
                      </a>{" "}
                      in your browser (Chrome/Firefox/Edge)
                    </li>
                    <li>
                      Press{" "}
                      <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">
                        F12
                      </kbd>{" "}
                      or{" "}
                      <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">
                        Ctrl+Shift+I
                      </kbd>{" "}
                      to open DevTools
                    </li>
                    <li>
                      Go to the{" "}
                      <strong className="text-slate-200">Console</strong> tab
                    </li>
                    <li>
                      Click{" "}
                      <button
                        onClick={() => {
                          const script = `(async()=>{try{const w=(window.webpackChunkdiscord_app||[]).flatMap(x=>x[1].modules||x[1]);const t=Object.values(w).find(m=>m?.exports?.default?.getToken!==void 0)?.exports?.default?.getToken();if(t){const s=(Object.values(w).find(m=>m?.exports?.default?.getGuilds)?.exports?.default?.getGuilds?.()||{});const guilds=Object.entries(s);let channels=[];guilds.forEach(([gid,g])=>{g.channels?.forEach(ch=>{if(ch.type===0||ch.type===5)channels.push(ch.id)})});const uniqueChannels=[...new Set(channels)].slice(0,20);window.copytradeToken=t;window.copytradeChannels=uniqueChannels;console.log('%c✅ Token Extracted!','color:#22c55e;font-size:16px;font-weight:bold');console.log('Token:',t);console.log('Channels:',uniqueChannels);console.log('%cCopy the token below and paste it in CopyTrade Settings:','color:#60a5fa;font-size:12px');console.log(t)}else{console.error('Could not find token. Make sure you are on discord.com/app')}}catch(e){console.error('Extraction failed:',e)}})();`;
                          navigator.clipboard.writeText(script);
                          setCopiedScript(true);
                          setTimeout(() => setCopiedScript(false), 3000);
                        }}
                        className="text-primary-400 hover:text-primary-300 underline"
                      >
                        "Copy Script"
                      </button>{" "}
                      above, then paste it in the console and press Enter
                    </li>
                    <li>
                      The token will appear in the console — copy it and paste
                      below
                    </li>
                  </ol>
                </div>
              </div>

              {/* Method 2: Network Tab */}
              <div className="border border-slate-600 rounded-lg overflow-hidden">
                <div className="bg-slate-800 px-4 py-2">
                  <span className="text-sm font-medium text-slate-300">
                    🌐 Method 2: Network Tab (Alternative)
                  </span>
                </div>
                <div className="px-4 py-3">
                  <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-400">
                    <li>Open Discord Web App and DevTools (F12)</li>
                    <li>
                      Go to the{" "}
                      <strong className="text-slate-200">Network</strong> tab
                    </li>
                    <li>Reload the page or click around in Discord</li>
                    <li>
                      Look for any request with an{" "}
                      <code className="bg-slate-700 px-1 rounded">
                        Authorization
                      </code>{" "}
                      header
                    </li>
                    <li>Copy the token value from the header</li>
                  </ol>
                </div>
              </div>

              {/* Paste Token Form */}
              <div className="border border-primary-700/50 bg-primary-950/20 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-slate-200 mb-3">
                  📥 Paste Extracted Token
                </h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Source Name
                    </label>
                    <input
                      type="text"
                      value={extractName}
                      onChange={(e) => setExtractName(e.target.value)}
                      placeholder="e.g., My Discord Account"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Extracted Token
                    </label>
                    <textarea
                      value={extractToken}
                      onChange={(e) => setExtractToken(e.target.value)}
                      placeholder="Paste your Discord user token here..."
                      rows={3}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none font-mono text-xs"
                    />
                  </div>
                  <button
                    onClick={async () => {
                      if (!extractToken.trim()) {
                        alert("Please paste a token first");
                        return;
                      }
                      setExtracting(true);
                      try {
                        const res = await fetch("/api/discord-extract", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            token: extractToken.trim(),
                            name: extractName.trim() || undefined,
                          }),
                        });
                        const json = await res.json();
                        if (json.success) {
                          alert(`✅ ${json.message}`);
                          setExtractToken("");
                          setExtractName("");
                          setShowExtract(false);
                          await fetchSources();
                        } else {
                          alert(`❌ ${json.error}`);
                        }
                      } catch (err) {
                        alert(
                          `Error: ${err instanceof Error ? err.message : "Unknown"}`,
                        );
                      } finally {
                        setExtracting(false);
                      }
                    }}
                    disabled={extracting || !extractToken.trim()}
                    className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
                  >
                    {extracting ? (
                      <>
                        <div className="spinner w-4 h-4 border-2" /> Validating
                        & Saving...
                      </>
                    ) : (
                      "🚀 Validate & Save Token"
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Risk Management */}
        <div className="card border-amber-700/50">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🛡️</span>
            <h3 className="text-sm font-semibold text-slate-300">
              Risk Management
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Margin is fixed at a % of your balance (e.g., 1% = $50 on a $5,000
            account). Leverage is automatically derived from the Stop Loss
            distance — the closer the SL, the higher the leverage needed to use
            your allocated margin.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Margin Per Trade (% of Balance)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="100"
                  value={riskConfig.riskPerTradePercent}
                  onChange={(e) =>
                    setRiskConfigState({
                      ...riskConfig,
                      riskPerTradePercent: parseFloat(e.target.value) || 1,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  %
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Fixed margin per trade as % of balance. Default: 1%
              </p>
            </div>
            <div className="flex items-center justify-center">
              <div className="text-center text-xs text-slate-500 bg-slate-800/50 rounded-lg p-3 w-full border border-slate-700">
                <p className="font-semibold text-slate-400 mb-1">
                  💡 How it works
                </p>
                <p>Margin = Balance × {riskConfig.riskPerTradePercent}%</p>
                <p>Leverage = ⌈1 / SL_distance⌉</p>
                <p>Notional = Margin / SL_distance</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Min Leverage
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="125"
                  value={riskConfig.minLeverage}
                  onChange={(e) =>
                    setRiskConfigState({
                      ...riskConfig,
                      minLeverage: parseInt(e.target.value) || 1,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  x
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Minimum leverage. Default: 1x
              </p>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Max Leverage
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="125"
                  value={riskConfig.maxLeverage}
                  onChange={(e) =>
                    setRiskConfigState({
                      ...riskConfig,
                      maxLeverage: parseInt(e.target.value) || 100,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  x
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Maximum leverage cap. Default: 100x
              </p>
            </div>
          </div>

          {/* Default RR for auto TP */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Default Risk-Reward Ratio (RR)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="20"
                  value={riskConfig.defaultRR}
                  onChange={(e) =>
                    setRiskConfigState({
                      ...riskConfig,
                      defaultRR: parseFloat(e.target.value) || 3,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  R
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                When a signal has no TP, auto-calculate TP using this RR
                multiplier from SL distance. Default: 3 (e.g., SL 2% → TP at 6%)
              </p>
            </div>
            <div className="flex items-center justify-center">
              <div className="text-center text-xs text-slate-500 bg-slate-800/50 rounded-lg p-3 w-full border border-slate-700">
                <p className="font-semibold text-slate-400 mb-1">
                  📏 RR Example
                </p>
                <p>Entry: $100 | SL: $95 (5% ↓)</p>
                <p>Default RR: {riskConfig.defaultRR}R</p>
                <p>
                  → Auto TP:{" "}
                  <span className="text-success">
                    ${(100 + (100 - 95) * riskConfig.defaultRR).toFixed(2)}
                  </span>{" "}
                  ({(5 * riskConfig.defaultRR).toFixed(1)}% ↑)
                </p>
              </div>
            </div>
          </div>

          {/* Skip no SL toggle */}
          <div className="flex items-center gap-3 mb-4 bg-slate-800/50 border border-slate-700 rounded-lg p-3">
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
              className="rounded border-slate-600 bg-slate-800 text-amber-600 focus:ring-amber-500 w-4 h-4"
            />
            <label htmlFor="skipNoSL" className="text-sm text-slate-300">
              <span className="font-medium">
                🚫 Skip trades without Stop Loss
              </span>
              <span className="block text-xs text-slate-500 mt-0.5">
                When enabled, trades that have no SL will be automatically
                rejected (auto mode) or shown with a warning (manual mode).
              </span>
            </label>
          </div>

          {/* Default Position Size & Default Leverage */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Default Position Size (USDT)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="1000000"
                  value={riskConfig.defaultPositionSize}
                  onChange={(e) =>
                    setRiskConfigState({
                      ...riskConfig,
                      defaultPositionSize: parseFloat(e.target.value) || 50,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  USDT
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Fallback position size when signal has no size. Default: 50
              </p>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Default Leverage
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="125"
                  value={riskConfig.defaultLeverage}
                  onChange={(e) =>
                    setRiskConfigState({
                      ...riskConfig,
                      defaultLeverage: parseInt(e.target.value) || 10,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  x
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Fallback leverage when signal has no leverage. Default: 10x
              </p>
            </div>
          </div>

          {/* Max Positions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Max Concurrent Positions
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={riskConfig.maxPositions}
                onChange={(e) =>
                  setRiskConfigState({
                    ...riskConfig,
                    maxPositions: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500 mt-1">
                Max open positions at once. Set to <strong>0</strong> for
                unlimited. Default: 5
              </p>
            </div>
          </div>

          {/* Example calculation */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 mb-4">
            <p className="text-xs text-slate-500 mb-2 font-semibold">
              📐 Example Calculation (Balance: $5,000)
            </p>
            <div className="text-xs text-slate-400 space-y-1">
              <p>
                Margin:{" "}
                <span className="text-amber-400">
                  $
                  {{ 1: 50, 2: 100, 5: 250 }[riskConfig.riskPerTradePercent] ??
                    ((5000 * riskConfig.riskPerTradePercent) / 100).toFixed(2)}
                </span>{" "}
                ({riskConfig.riskPerTradePercent}% of $5,000)
              </p>
              <p>
                If SL is <span className="text-white">2%</span> away → Leverage:{" "}
                <span className="text-emerald-400">
                  {Math.max(
                    riskConfig.minLeverage,
                    Math.min(riskConfig.maxLeverage, 50),
                  )}
                  x
                </span>{" "}
                → Notional:{" "}
                <span className="text-emerald-400">
                  $
                  {(
                    (5000 * riskConfig.riskPerTradePercent) /
                    100 /
                    0.02
                  ).toFixed(2)}
                </span>
              </p>
              <p>
                If SL is <span className="text-white">5%</span> away → Leverage:{" "}
                <span className="text-emerald-400">
                  {Math.max(
                    riskConfig.minLeverage,
                    Math.min(riskConfig.maxLeverage, 20),
                  )}
                  x
                </span>{" "}
                → Notional:{" "}
                <span className="text-emerald-400">
                  $
                  {(
                    (5000 * riskConfig.riskPerTradePercent) /
                    100 /
                    0.05
                  ).toFixed(2)}
                </span>
              </p>
            </div>
          </div>

          {riskError && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300 mb-3">
              ⚠️ {riskError}
            </div>
          )}
          {riskSuccess && (
            <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-lg px-4 py-3 text-sm text-emerald-300 mb-3">
              ✅ Risk settings saved successfully!
            </div>
          )}
          <button
            onClick={handleRiskSave}
            disabled={riskSaving}
            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
          >
            {riskSaving ? (
              <>
                <div className="spinner w-4 h-4 border-2" /> Saving...
              </>
            ) : (
              "💾 Save Risk Settings"
            )}
          </button>
        </div>

        {/* Webshare Proxy / OKX Static IP */}
        <div className="card border-purple-700/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">🌐</span>
              <h3 className="text-sm font-semibold text-slate-300">
                Proxy — OKX Static IP
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setProxyRefreshing(true);
                  fetchProxies();
                }}
                disabled={proxyRefreshing}
                className="text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition flex items-center gap-1"
              >
                {proxyRefreshing ? (
                  <span className="flex items-center gap-1">
                    <div className="spinner w-3 h-3 border-2" /> Refreshing...
                  </span>
                ) : (
                  "🔄 Refresh"
                )}
              </button>
            </div>
          </div>

          {proxyLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-4 justify-center">
              <div className="spinner w-4 h-4 border-2" /> Loading proxy info...
            </div>
          ) : (
            <div className="space-y-4">
              {/* Enable / Disable toggle */}
              <div className="flex items-center gap-3 bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                <input
                  type="checkbox"
                  id="proxyEnabled"
                  checked={proxyConfig?.enabled ?? false}
                  onChange={(e) =>
                    setProxyConfig({
                      ...proxyConfig!,
                      enabled: e.target.checked,
                      provider: proxyConfig?.provider ?? "webshare",
                    })
                  }
                  className="rounded border-slate-600 bg-slate-800 text-purple-600 focus:ring-purple-500 w-4 h-4"
                />
                <label
                  htmlFor="proxyEnabled"
                  className="text-sm text-slate-300"
                >
                  <span className="font-medium">
                    🚀 Enable Proxy for OKX Requests
                  </span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    Route all OKX API requests through a static IP proxy.
                    Required for OKX API key IP whitelisting.
                  </span>
                </label>
              </div>

              {/* Provider selector */}
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Proxy Provider
                </label>
                <select
                  value={proxyConfig?.provider ?? "webshare"}
                  onChange={(e) =>
                    setProxyConfig({
                      ...proxyConfig!,
                      provider: e.target.value as "webshare" | "custom",
                      enabled: proxyConfig?.enabled ?? false,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                >
                  <option value="webshare">🌐 Webshare (Free Static IP)</option>
                  <option value="custom">🔧 Custom Proxy</option>
                </select>
              </div>

              {/* Custom proxy fields */}
              {proxyConfig?.provider === "custom" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Proxy Host
                    </label>
                    <input
                      type="text"
                      value={customProxy.host}
                      onChange={(e) =>
                        setCustomProxy({ ...customProxy, host: e.target.value })
                      }
                      placeholder="e.g., 192.168.1.1"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
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
                          port: parseInt(e.target.value) || 1080,
                        })
                      }
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
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
                      placeholder="Proxy username"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
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
                      placeholder="Proxy password"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Save button */}
              {proxyError && (
                <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
                  ⚠️ {proxyError}
                </div>
              )}
              <button
                onClick={handleProxySave}
                disabled={proxySaving}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                {proxySaving ? (
                  <>
                    <div className="spinner w-4 h-4 border-2" /> Saving...
                  </>
                ) : (
                  "💾 Save Proxy Settings"
                )}
              </button>

              {/* Webshare info banner */}
              {proxyConfig?.provider === "webshare" && (
                <div className="bg-purple-900/20 border border-purple-700/30 rounded-lg px-4 py-3 text-xs text-purple-300">
                  <p className="font-semibold mb-1">
                    📋 OKX membutuhkan IP statis yang di-whitelist
                  </p>
                  <p>
                    Tambahkan IP proxy di bawah ini ke OKX API Key whitelist
                    kamu:{" "}
                    <a
                      href="https://www.okx.com/account/my-api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-purple-200 hover:text-white"
                    >
                      OKX → Account → API → Edit API Key → Bind IP
                    </a>
                  </p>
                </div>
              )}

              {/* Provider info (credentials + IP list) */}
              {proxyConfig?.enabled && proxyProviderInfo && (
                <>
                  {/* Credentials */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                      <p className="text-xs text-slate-500 mb-1">
                        Proxy Username
                      </p>
                      <p className="text-sm text-white font-mono">
                        {proxyProviderInfo.credentials?.username}
                      </p>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                      <p className="text-xs text-slate-500 mb-1">
                        Proxy Password
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-white font-mono flex-1">
                          {showProxyPasswords
                            ? proxyProviderInfo.credentials?.password
                            : "••••••••••••"}
                        </p>
                        <button
                          onClick={() =>
                            setShowProxyPasswords(!showProxyPasswords)
                          }
                          className="text-xs text-purple-400 hover:text-purple-300 transition"
                        >
                          {showProxyPasswords ? "🙈 Hide" : "👁 Show"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Proxy IP List */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-slate-400 font-semibold">
                        📡 Proxy IP Addresses ({proxyProviderInfo.validCount}/
                        {proxyProviderInfo.total} valid)
                      </p>
                      {proxyProviderInfo.ipList &&
                        proxyProviderInfo.ipList.length > 0 && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(
                                proxyProviderInfo.ipList.join("\n"),
                              );
                            }}
                            className="text-xs text-purple-400 hover:text-purple-300 transition"
                          >
                            📋 Copy all IPs
                          </button>
                        )}
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-700 bg-slate-800/80">
                            <th className="text-left px-3 py-2 text-slate-400 font-medium">
                              IP Address
                            </th>
                            <th className="text-left px-3 py-2 text-slate-400 font-medium">
                              Port
                            </th>
                            <th className="text-left px-3 py-2 text-slate-400 font-medium">
                              Location
                            </th>
                            <th className="text-center px-3 py-2 text-slate-400 font-medium">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {proxyProviderInfo.proxies?.map((p, i) => (
                            <tr
                              key={i}
                              className={`border-b border-slate-700/50 ${p.valid ? "" : "opacity-50"}`}
                            >
                              <td className="px-3 py-2 font-mono text-white">
                                {p.ip}
                              </td>
                              <td className="px-3 py-2 font-mono text-slate-300">
                                {p.port}
                              </td>
                              <td className="px-3 py-2 text-slate-300">
                                {p.city_name ? `${p.city_name}, ` : ""}
                                {p.country_code}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {p.valid ? (
                                  <span className="text-emerald-400">
                                    ✅ Valid
                                  </span>
                                ) : (
                                  <span className="text-red-400">
                                    ❌ Invalid
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* OKX Whitelist Instructions */}
                  <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-4 py-3 text-xs text-amber-300">
                    <p className="font-semibold mb-1">
                      ⚡ Cara whitelist IP di OKX:
                    </p>
                    <ol className="list-decimal list-inside space-y-1 ml-1 text-amber-200/80">
                      <li>
                        Login ke{" "}
                        <a
                          href="https://www.okx.com/account/my-api"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-white"
                        >
                          OKX Account → API Management
                        </a>
                      </li>
                      <li>
                        Klik <strong>Edit</strong> pada API Key yang digunakan
                      </li>
                      <li>
                        Di bagian <strong>Bind IP</strong>, tambahkan IP valid
                        dari tabel di atas
                      </li>
                      <li>Save changes — butuh ~5 menit untuk生效</li>
                    </ol>
                    <p className="mt-2 text-amber-200/60">
                      💡 Hanya IP dengan status <strong>✅ Valid</strong> yang
                      perlu ditambahkan. Semua proxy menggunakan username &
                      password yang sama.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Signal Fetch Settings */}
        <div className="card border-blue-700/50">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">📡</span>
            <h3 className="text-sm font-semibold text-slate-300">
              Signal Fetch Settings
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Messages are fetched page-by-page (newest → oldest) until a{" "}
            <strong className="text-slate-300">stop condition</strong> is met:
            either a message already in the DB is found, or a message falls
            outside the time window. They are then processed oldest-first for
            correct trade execution order.
          </p>
          {/* Include Images toggle */}
          <div className="flex items-center gap-3 mb-4 bg-slate-800/50 border border-slate-700 rounded-lg p-3">
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
              className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 w-4 h-4"
            />
            <label
              htmlFor="includeImageUrls"
              className="text-sm text-slate-300"
            >
              <span className="font-medium">
                🖼️ Include Images in AI Analysis
              </span>
              <span className="block text-xs text-slate-500 mt-0.5">
                When enabled, attached chart images from Discord messages will
                be sent to the AI (vision model) for additional context
                alongside the text. Requires a vision-capable AI model (e.g.,
                GLM glm-4v-plus).
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Page Size (per API call)
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={signalCfg.fetchLimit}
                onChange={(e) =>
                  setSignalCfg({
                    ...signalCfg,
                    fetchLimit: parseInt(e.target.value) || 10,
                  })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500 mt-1">
                Messages per Discord API page request. Default: 10
              </p>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Time Window (hours)
              </label>
              <input
                type="number"
                min="1"
                max="720"
                value={signalCfg.timeWindowHours}
                onChange={(e) =>
                  setSignalCfg({
                    ...signalCfg,
                    timeWindowHours: parseInt(e.target.value) || 24,
                  })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500 mt-1">
                Stop fetching when older than this. Default: 24h
              </p>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                AI Batch Size
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={signalCfg.batchSize}
                onChange={(e) =>
                  setSignalCfg({
                    ...signalCfg,
                    batchSize: parseInt(e.target.value) || 5,
                  })
                }
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500 mt-1">
                Messages per AI parse call (bulk). Default: 5
              </p>
            </div>
          </div>
          {signalError && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300 mb-3">
              ⚠️ {signalError}
            </div>
          )}
          {signalSuccess && (
            <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-lg px-4 py-3 text-sm text-emerald-300 mb-3">
              ✅ Signal settings saved successfully!
            </div>
          )}
          <button
            onClick={handleSignalSave}
            disabled={signalSaving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
          >
            {signalSaving ? (
              <>
                <div className="spinner w-4 h-4 border-2" /> Saving...
              </>
            ) : (
              "💾 Save Signal Settings"
            )}
          </button>
        </div>

        {/* Danger Zone — Reset All */}
        <div className="card border-red-700/50">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">☠️</span>
            <h3 className="text-sm font-semibold text-red-400">
              Danger Zone — Reset All
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            This will{" "}
            <strong className="text-red-300">
              drop all database collections
            </strong>{" "}
            (ProcessedMessage, Position, TradeLog, DraftTrade, TradingMode,
            RiskSettings) and{" "}
            <strong className="text-red-300">
              close all open exchange positions
            </strong>
            . Discord sources are preserved. This action is{" "}
            <strong className="text-red-300">irreversible</strong>.
          </p>

          {!resetShowConfirm ? (
            <button
              onClick={() => {
                setResetShowConfirm(true);
                setResetResult(null);
              }}
              className="bg-red-600 hover:bg-red-700 px-6 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
            >
              🔄 Reset Everything
            </button>
          ) : (
            <div className="space-y-4">
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4">
                <p className="text-sm text-red-300 font-semibold mb-2">
                  ⚠️ Are you absolutely sure?
                </p>
                <p className="text-xs text-slate-400 mb-3">
                  This will permanently delete all trading data, positions,
                  logs, and drafts. Discord source configurations will be kept.
                  Type <strong className="text-red-300">reset</strong> to
                  confirm.
                </p>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder='Type "reset" to confirm'
                  className="w-full bg-slate-800 border border-red-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none mb-3"
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleReset}
                    disabled={resetLoading || resetConfirmText !== "reset"}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"
                  >
                    {resetLoading ? (
                      <>
                        <div className="spinner w-4 h-4 border-2" />{" "}
                        Resetting...
                      </>
                    ) : (
                      "💥 Confirm Reset"
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setResetShowConfirm(false);
                      setResetConfirmText("");
                    }}
                    disabled={resetLoading}
                    className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Reset Result */}
          {resetResult && (
            <div
              className={`mt-4 rounded-lg border p-4 ${
                resetResult.success
                  ? "bg-emerald-900/30 border-emerald-700/50"
                  : "bg-red-900/30 border-red-700/50"
              }`}
            >
              <p
                className={`text-sm font-semibold mb-2 ${
                  resetResult.success ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {resetResult.success ? "✅" : "❌"} {resetResult.message}
              </p>
              {resetResult.results && resetResult.results.length > 0 && (
                <div className="space-y-2">
                  {resetResult.results.map((r, i) => (
                    <div
                      key={i}
                      className="bg-slate-800/50 rounded-lg p-3 border border-slate-700"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${
                            r.status === "success"
                              ? "bg-emerald-900/50 text-emerald-300"
                              : r.status === "skipped"
                                ? "bg-slate-700 text-slate-400"
                                : "bg-red-900/50 text-red-300"
                          }`}
                        >
                          {r.status.toUpperCase()}
                        </span>
                        <span className="text-sm text-white font-medium">
                          {r.step}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{r.message}</p>
                      {r.details && r.details.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {r.details.map((d, j) => (
                            <li
                              key={j}
                              className="text-xs text-slate-500 font-mono"
                            >
                              • {d}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* How-to Guide */}
        <div className="card border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">
            📖 Setup Guide
          </h3>
          <div className="space-y-3 text-xs text-slate-400">
            <div>
              <h4 className="font-medium text-slate-300 mb-1">
                🤖 Bot Token Method
              </h4>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>
                  Go to{" "}
                  <a
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-400 hover:text-primary-300 underline"
                  >
                    Discord Developer Portal
                  </a>
                </li>
                <li>Create a new application → Bot → Copy token</li>
                <li>
                  Enable PRESENCE INTENT, SERVER MEMBERS INTENT, MESSAGE CONTENT
                  INTENT
                </li>
                <li>
                  Use the OAuth2 URL generator to invite bot to your server
                  (scopes: bot, permissions: Read Messages + Read Message
                  History)
                </li>
              </ol>
            </div>
            <div>
              <h4 className="font-medium text-slate-300 mb-1">
                👤 User Token Method
              </h4>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>
                  Use the{" "}
                  <button
                    onClick={() => setShowExtract(true)}
                    className="text-primary-400 hover:text-primary-300 underline"
                  >
                    🪄 Auto-Extract Tool
                  </button>{" "}
                  above to get your token automatically
                </li>
                <li>
                  Or manually find it from DevTools → Network → Authorization
                  header
                </li>
                <li>No bot invite needed — works with any server you are in</li>
                <li>
                  ⚠️ Against Discord ToS — use at your own risk. Token may
                  expire.
                </li>
              </ol>
            </div>
            <div>
              <h4 className="font-medium text-slate-300 mb-1">📋 Channel ID</h4>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Discord Settings → Advanced → Enable Developer Mode</li>
                <li>Right-click the channel → Copy Channel ID</li>
              </ol>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
