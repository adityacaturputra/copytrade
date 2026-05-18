import { useCallback, useEffect, useState } from "react";
import { withActionPassword } from "./types";
import type { LogCleanupResult, ProxyConfigState, ProxyProviderInfo, ResetResult } from "./system-types";

export function useSettingsOperations(check403: (res: Response) => boolean) {
  const [proxyConfig, setProxyConfig] = useState<ProxyConfigState | null>(null);
  const [proxyProviderInfo, setProxyProviderInfo] = useState<ProxyProviderInfo | null>(null);
  const [proxyLoading, setProxyLoading] = useState(true);
  const [proxyRefreshing, setProxyRefreshing] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [customProxy, setCustomProxy] = useState({ host: "", port: 1080, username: "", password: "" });
  const [webshareApiKeysText, setWebshareApiKeysText] = useState("");
  const [webshareActiveKeyIndex, setWebshareActiveKeyIndex] = useState(0);
  const [webshareAllowedCountriesText, setWebshareAllowedCountriesText] = useState("");
  const [proxyIpCsvCopied, setProxyIpCsvCopied] = useState(false);
  const [logCleanupLoading, setLogCleanupLoading] = useState<string | null>(null);
  const [logCleanupDays, setLogCleanupDays] = useState("30");
  const [logCleanupResult, setLogCleanupResult] = useState<LogCleanupResult | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [resetShowConfirm, setResetShowConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  const fetchProxies = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy");
      const json = await res.json();
      if (json.success) {
        setProxyConfig(json.config);
        setProxyProviderInfo(json.providerInfo || null);
        if (json.webshareApiKeyPool) {
          setWebshareApiKeysText((json.webshareApiKeyPool.keys || []).join("\n"));
          setWebshareActiveKeyIndex(Number(json.webshareApiKeyPool.activeIndex || 0));
          setWebshareAllowedCountriesText((json.webshareApiKeyPool.allowedCountryCodes || []).join("\n"));
        }
        if (json.config?.custom) setCustomProxy(json.config.custom);
        setProxyError(null);
      } else setProxyError(json.error || "Failed to load proxy config");
    } catch {
      setProxyError("Failed to fetch proxy info from server.");
    } finally {
      setProxyLoading(false);
      setProxyRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchProxies();
  }, [fetchProxies]);

  const handleProxySave = async () => {
    setProxySaving(true);
    setProxyError(null);
    try {
      const body: Record<string, unknown> = { enabled: proxyConfig?.enabled ?? false, provider: proxyConfig?.provider ?? "webshare" };
      if (proxyConfig?.provider === "custom") body.custom = customProxy;
      if ((proxyConfig?.provider || "webshare") === "webshare") {
        body.webshareApiKeyPool = {
          keys: webshareApiKeysText.split("\n").map((line) => line.trim()).filter(Boolean),
          activeIndex: webshareActiveKeyIndex,
          allowedCountryCodes: webshareAllowedCountriesText.split("\n").map((line) => line.trim().toUpperCase()).filter(Boolean),
        };
      }
      const res = await fetch("/api/proxy", { method: "POST", headers: withActionPassword({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (check403(res)) {
        setProxySaving(false);
        return;
      }
      const json = await res.json();
      if (json.success) {
        setProxyConfig(json.config);
        setProxyProviderInfo(json.providerInfo || null);
        if (json.webshareApiKeyPool) {
          setWebshareApiKeysText((json.webshareApiKeyPool.keys || []).join("\n"));
          setWebshareActiveKeyIndex(Number(json.webshareApiKeyPool.activeIndex || 0));
          setWebshareAllowedCountriesText((json.webshareApiKeyPool.allowedCountryCodes || []).join("\n"));
        }
      } else setProxyError(json.error || "Failed to save proxy config");
    } catch (err) {
      setProxyError(err instanceof Error ? err.message : "Failed to save proxy config");
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyRefresh = async () => {
    setProxyRefreshing(true);
    await fetchProxies();
  };

  const handleCopyProxyIpCsv = async () => {
    const ipList =
      proxyProviderInfo?.allIpList?.length
        ? proxyProviderInfo.allIpList
        : proxyProviderInfo?.ipList || [];
    if (!ipList.length) return;
    await navigator.clipboard.writeText(ipList.join(","));
    setProxyIpCsvCopied(true);
    setTimeout(() => setProxyIpCsvCopied(false), 1800);
  };

  const handleReset = async () => {
    setResetLoading(true);
    setResetResult(null);
    try {
      const res = await fetch("/api/reset-all", { method: "POST", headers: withActionPassword({ "Content-Type": "application/json" }), body: JSON.stringify({}) });
      if (check403(res)) {
        setResetLoading(false);
        setResetShowConfirm(false);
        setResetConfirmText("");
        return;
      }
      setResetResult(await res.json());
    } catch (err) {
      setResetResult({ success: false, message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setResetLoading(false);
      setResetShowConfirm(false);
      setResetConfirmText("");
    }
  };

  const runLogCleanup = async (mode: "noisy-json" | "retention") => {
    if (mode === "retention") {
      const parsedDays = Number.parseInt(logCleanupDays, 10);
      if (!Number.isFinite(parsedDays) || parsedDays < 1) {
        setLogCleanupResult({ success: false, message: "Keep days must be a number greater than or equal to 1." });
        return;
      }
    }
    setLogCleanupLoading(mode);
    setLogCleanupResult(null);
    try {
      const payload: Record<string, unknown> = { mode };
      if (mode === "retention") payload.keepDays = Number.parseInt(logCleanupDays, 10);
      const res = await fetch("/api/logs/cleanup", { method: "POST", headers: withActionPassword({ "Content-Type": "application/json" }), body: JSON.stringify(payload) });
      if (check403(res)) {
        setLogCleanupLoading(null);
        return;
      }
      const json = await res.json();
      if (json.success) {
        const resultData = json.data || null;
        setLogCleanupResult({ success: true, message: mode === "noisy-json" ? `Deleted ${resultData?.deletedCount || 0} noisy log(s).` : `Deleted ${resultData?.deletedCount || 0} log(s) and kept the last ${resultData?.keepDays || payload.keepDays} day(s).`, data: resultData || undefined });
      } else setLogCleanupResult({ success: false, message: json.error || "Failed to clean up logs." });
    } catch (err) {
      setLogCleanupResult({ success: false, message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setLogCleanupLoading(null);
    }
  };

  return {
    proxyConfig, setProxyConfig, proxyProviderInfo, proxyLoading, proxyRefreshing, proxySaving, proxyError,
    customProxy, setCustomProxy, webshareApiKeysText, setWebshareApiKeysText, webshareActiveKeyIndex, setWebshareActiveKeyIndex,
    webshareAllowedCountriesText, setWebshareAllowedCountriesText, proxyIpCsvCopied,
    logCleanupLoading, logCleanupDays, setLogCleanupDays, logCleanupResult,
    resetLoading, resetResult, resetShowConfirm, setResetShowConfirm, resetConfirmText, setResetConfirmText,
    handleProxySave, handleProxyRefresh, handleCopyProxyIpCsv, handleReset, runLogCleanup,
  };
}
