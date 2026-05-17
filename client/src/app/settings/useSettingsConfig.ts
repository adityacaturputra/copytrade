import { useCallback, useEffect, useState } from "react";
import { type CronProvider } from "@copytrade/shared/lib/cron/client";
import { defaultRiskConfig, withActionPassword, type RiskConfig } from "./types";
import type { CronJobFormData, CronLiveStatusItem, SignalSettingsForm } from "./system-types";
import { DEFAULT_CRON_JOBS, DEFAULT_SIGNAL_SETTINGS } from "./settings-defaults";

export function useSettingsConfig(check403: (res: Response) => boolean) {
  const [riskConfig, setRiskConfigState] = useState<RiskConfig>(defaultRiskConfig);
  const [riskSaving, setRiskSaving] = useState(false);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskSuccess, setRiskSuccess] = useState(false);
  const [signalCfg, setSignalCfg] = useState<SignalSettingsForm>(DEFAULT_SIGNAL_SETTINGS);
  const [signalSaving, setSignalSaving] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);
  const [signalSuccess, setSignalSuccess] = useState(false);
  const [cronProvider, setCronProvider] = useState<CronProvider>("cron-job.org");
  const [cronBaseUrl, setCronBaseUrl] = useState("");
  const [cronJobs, setCronJobs] = useState<CronJobFormData[]>(DEFAULT_CRON_JOBS);
  const [cronSaving, setCronSaving] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);
  const [cronSuccess, setCronSuccess] = useState(false);
  const [cronPulling, setCronPulling] = useState(false);
  const [cronLiveStatus, setCronLiveStatus] = useState<CronLiveStatusItem[]>([]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const json = await res.json();
      if (!json.success) return;
      if (json.risk) setRiskConfigState(json.risk);
      if (json.signal) {
        setSignalCfg({
          fetchLimit: json.signal.fetchLimit,
          timeWindowHours: json.signal.timeWindowHours,
          batchSize: json.signal.batchSize || 5,
          includeImageUrls: json.signal.includeImageUrls || false,
          monitorVisionImages: json.signal.monitorVisionImages || false,
        });
      }
    } catch {}
  }, []);

  const fetchCronSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/cron-settings");
      const json = await res.json();
      if (!json.success) return;
      if (json.settings?.provider) setCronProvider(json.settings.provider);
      if ("baseUrl" in (json.settings || {})) setCronBaseUrl(json.settings.baseUrl || "");
      if (json.settings?.jobs?.length > 0) {
        setCronJobs((prevDefaults) => mergeCronJobs(prevDefaults, json.settings.jobs));
      }
      if (json.liveStatus) setCronLiveStatus(json.liveStatus);
    } catch {}
  }, []);

  useEffect(() => {
    void fetchSettings();
    void fetchCronSettings();
  }, [fetchSettings, fetchCronSettings]);

  const handleRiskSave = async () => {
    setRiskSaving(true);
    setRiskError(null);
    setRiskSuccess(false);
    if (riskConfig.autoRaiseMinOrderEnabled && riskConfig.autoRaiseMinOrderMaxMarginUsdt <= 0) {
      setRiskError("Auto-raise max margin must be greater than 0 when the global setting is enabled.");
      setRiskSaving(false);
      return;
    }
    if (riskConfig.autoRaiseTpCountEnabled && riskConfig.autoRaiseTpCountMaxMarginUsdt <= 0) {
      setRiskError("TP auto-raise max margin must be greater than 0 when the global setting is enabled.");
      setRiskSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/settings", { method: "POST", headers: withActionPassword({ "Content-Type": "application/json" }), body: JSON.stringify({ risk: riskConfig }) });
      if (check403(res)) {
        setRiskSaving(false);
        return;
      }
      const json = await res.json();
      if (json.success) flashSuccess(setRiskSuccess);
      else setRiskError(json.error || "Failed to save");
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
      const res = await fetch("/api/settings", { method: "POST", headers: withActionPassword({ "Content-Type": "application/json" }), body: JSON.stringify({ signal: signalCfg }) });
      if (check403(res)) {
        setSignalSaving(false);
        return;
      }
      const json = await res.json();
      if (json.success) flashSuccess(setSignalSuccess);
      else setSignalError(json.error || "Failed to save");
    } catch (err) {
      setSignalError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSignalSaving(false);
    }
  };

  const handleCronSave = async () => {
    if (cronProvider === "cron-job.org" && (!cronBaseUrl || !cronBaseUrl.startsWith("http"))) {
      setCronError("Base URL is required. Click '☁️ Sync from Cloud' first to auto-detect your deployment URL, or enter it manually.");
      return;
    }
    setCronSaving(true);
    setCronError(null);
    setCronSuccess(false);
    try {
      const res = await fetch("/api/cron-settings", { method: "POST", headers: withActionPassword({ "Content-Type": "application/json" }), body: JSON.stringify({ provider: cronProvider, baseUrl: cronBaseUrl, jobs: cronJobs }) });
      if (check403(res)) {
        setCronSaving(false);
        return;
      }
      const json = await res.json();
      if (json.success) {
        flashSuccess(setCronSuccess);
        setCronError(Array.isArray(json.errors) && json.errors.length > 0 ? json.errors.join("; ") : null);
        if (json.settings?.jobs) setCronJobs(json.settings.jobs);
        await fetchCronSettings();
      } else setCronError(json.error || "Failed to sync cron jobs");
    } catch (err) {
      setCronError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCronSaving(false);
    }
  };

  const handleCronPull = async () => {
    if (cronProvider !== "cron-job.org") {
      setCronError("Cloud sync is only available for the cron-job.org provider.");
      return;
    }
    setCronPulling(true);
    setCronError(null);
    setCronSuccess(false);
    try {
      const res = await fetch("/api/cron-settings", { method: "PUT", headers: withActionPassword() });
      if (check403(res)) {
        setCronPulling(false);
        return;
      }
      const json = await res.json();
      if (json.success) {
        if ("baseUrl" in (json.settings || {})) setCronBaseUrl(json.settings.baseUrl || "");
        if (json.settings?.jobs) setCronJobs(json.settings.jobs);
        if (json.liveStatus) setCronLiveStatus(json.liveStatus);
        flashSuccess(setCronSuccess);
      } else setCronError(json.error || "Failed to pull from cloud");
    } catch (err) {
      setCronError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCronPulling(false);
    }
  };

  return {
    riskConfig, setRiskConfigState, riskSaving, riskError, riskSuccess,
    signalCfg, setSignalCfg, signalSaving, signalError, signalSuccess,
    cronProvider, setCronProvider, cronBaseUrl, setCronBaseUrl, cronJobs, setCronJobs, cronSaving, cronError, cronSuccess, cronPulling, cronLiveStatus,
    handleRiskSave, handleSignalSave, handleCronSave, handleCronPull,
  };
}

function mergeCronJobs(defaults: CronJobFormData[], savedJobs: Array<Record<string, any>>) {
  const savedByType = new Map<string, (typeof defaults)[number]>(savedJobs.map((job) => [job.type as string, job as (typeof defaults)[number]]));
  return defaults.map((defaultJob) => {
    const saved = savedByType.get(defaultJob.type);
    if (!saved) return defaultJob;
    const minutes = Number(saved.schedule?.minutes);
    return {
      ...defaultJob,
      ...saved,
      schedule: {
        ...defaultJob.schedule,
        ...(saved.schedule || {}),
        minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : defaultJob.schedule.minutes,
      },
    };
  });
}

function flashSuccess(setter: React.Dispatch<React.SetStateAction<boolean>>) {
  setter(true);
  setTimeout(() => setter(false), 3000);
}
