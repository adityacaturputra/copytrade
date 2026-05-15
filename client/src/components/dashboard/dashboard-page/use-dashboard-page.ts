"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CronRunStatus, DashboardData, DraftAction } from "@/components/dashboard/types";
import { buildBackendApiUrl } from "@/lib/backend-url";
import { getStoredActionPassword } from "@/lib/action-auth";
import { useActionAuth } from "@/lib/action-auth-context";

export function useDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingExchange, setLoadingExchange] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"positions" | "drafts" | "signals" | "logs">("drafts");
  const [triggeringCron, setTriggeringCron] = useState<string | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [actingDraft, setActingDraft] = useState<string | null>(null);
  const [cronStatus, setCronStatus] = useState<Record<string, CronRunStatus> | null>(null);
  const [expandedCron, setExpandedCron] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("all");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCronMenu, setShowCronMenu] = useState(false);
  const [menuPassword, setMenuPassword] = useState("");
  const [cronWarning, setCronWarning] = useState<{ allConfigured: boolean; missing: string[] } | null>(null);
  const prevCronRunning = useRef<Record<string, boolean>>({});
  const cronMenuRef = useRef<HTMLDivElement>(null);
  const auth = useActionAuth();

  const fetchExchangeData = useCallback(async () => {
    setLoadingExchange(true);
    try {
      const res = await fetch("/api/dashboard/exchange");
      const json = await res.json();
      if (json.success) {
        setData((prev) => {
          if (!prev) return json.data;
          return {
            ...prev,
            accounts: json.data.accounts,
            openPositions: json.data.openPositions,
            stats: json.data.stats,
            account: json.data.account,
            exchangeProvider: json.data.exchangeProvider,
            exchangeError: json.data.exchangeError,
          };
        });
      }
    } catch (err) {
      console.error("Failed to fetch exchange data", err);
    } finally {
      setLoadingExchange(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setError(null);
        fetchExchangeData();
      } else {
        setError(json.error || "Failed to load data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [fetchExchangeData]);

  const fetchCronStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cron/status");
      const json = await res.json();
      if (json.success) setCronStatus(json.cronStatus);
    } catch {}
  }, []);

  useEffect(() => {
    fetchData();
    fetchCronStatus();
  }, [fetchData, fetchCronStatus]);

  useEffect(() => {
    if (!cronStatus) return;
    for (const [name, status] of Object.entries(cronStatus)) {
      const wasRunning = prevCronRunning.current[name];
      if (wasRunning && !status.running && status.result) {
        setRefreshKey((value) => value + 1);
      }
      prevCronRunning.current[name] = status.running;
    }
  }, [cronStatus]);

  useEffect(() => {
    if (auth.unlockRequested) {
      setShowCronMenu(true);
      auth.consumeUnlockRequest();
    }
  }, [auth]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cronMenuRef.current && !cronMenuRef.current.contains(e.target as Node)) {
        setShowCronMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const triggerCron = async (type: "signal-check" | "position-monitor" | "tp-sl-monitor" | "orphan-cleanup") => {
    setTriggeringCron(type);
    try {
      const actionPassword = getStoredActionPassword();
      const headers: Record<string, string> = {};
      if (actionPassword) headers["x-action-password"] = actionPassword;
      const res = await fetch(`/api/cron/${type}`, { method: "POST", headers });
      if (res.status === 403) {
        auth.requestShowUnlock();
        return;
      }
      const json = await res.json();
      if (json.success) {
        fetchCronStatus();
      } else {
        alert(`${type} failed: ${json.error}`);
      }
      await fetchData();
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setTriggeringCron(null);
    }
  };

  const toggleMode = async () => {
    if (!data) return;
    const newMode = data.tradingMode === "auto" ? "manual" : "auto";
    setSwitchingMode(true);
    try {
      const actionPassword = getStoredActionPassword();
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(actionPassword ? { "x-action-password": actionPassword } : {}),
        },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.status === 403) {
        auth.requestShowUnlock();
        return;
      }
      const json = await res.json();
      if (json.success) {
        setData({ ...data, tradingMode: newMode });
      }
    } catch {
      alert("Failed to switch mode");
    } finally {
      setSwitchingMode(false);
    }
  };

  const handleDraftAction = async (draftId: string, action: DraftAction, extraBody?: Record<string, unknown>) => {
    setActingDraft(draftId);
    try {
      const actionPassword = getStoredActionPassword();
      const draftHeaders: Record<string, string> = extraBody ? { "Content-Type": "application/json" } : {};
      if (actionPassword) draftHeaders["x-action-password"] = actionPassword;
      const res = await fetch(buildBackendApiUrl(`/api/drafts/${draftId}/${action}`), {
        method: "POST",
        headers: draftHeaders,
        body: extraBody ? JSON.stringify(extraBody) : undefined,
      });
      if (res.status === 403) {
        auth.requestShowUnlock();
        return;
      }
      const json = await res.json();
      if (json.success) {
        const successMessage = json.data?.message || (action === "accept" ? "Draft accepted successfully!" : action === "reject" ? "Draft rejected successfully!" : action === "redraft" ? "Draft created again successfully!" : "Draft re-analyzed successfully!");
        alert(successMessage);
        setRefreshKey((value) => value + 1);
        await fetchData();
      } else {
        setRefreshKey((value) => value + 1);
        await fetchData();
        const processSuffix = json.processId ? `\nProcess: ${json.processId}` : "";
        alert(`Failed: ${json.error}${processSuffix}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setActingDraft(null);
    }
  };

  return {
    data, loading, loadingExchange, error, authError: auth.error, activeTab, setActiveTab,
    triggeringCron, switchingMode, actingDraft, cronStatus, expandedCron,
    setExpandedCron, selectedChannelId, setSelectedChannelId, selectedAccountId,
    setSelectedAccountId, refreshKey, prevCronRunning, cronMenuRef, cronWarning,
    setCronWarning, showCronMenu, setShowCronMenu, menuPassword, setMenuPassword,
    fetchData, fetchCronStatus, triggerCron, toggleMode, handleDraftAction,
    isUnlocked: auth.isUnlocked,
    isVerifying: auth.isVerifying,
    unlock: auth.unlock,
    lock: auth.lock,
    unlockRequested: auth.unlockRequested,
    requestShowUnlock: auth.requestShowUnlock,
    consumeUnlockRequest: auth.consumeUnlockRequest,
  };
}
