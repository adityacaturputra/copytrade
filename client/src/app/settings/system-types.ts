import type { Dispatch, SetStateAction } from "react";
import type { CronProvider } from "@copytrade/shared/lib/cron/client";
import type { RiskConfig } from "./types";

export interface SignalSettingsForm {
  fetchLimit: number;
  timeWindowHours: number;
  batchSize: number;
  includeImageUrls: boolean;
  monitorVisionImages: boolean;
}

export interface CronJobFormData {
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
}

export interface CronLiveStatusItem {
  type: string;
  title: string;
  enabled: boolean;
  url: string;
  status: "active" | "missing" | "disabled";
  running?: boolean;
  result?: "success" | "error" | null;
  progress?: string;
  lastExecution?: string;
}

export interface ProxyConfigState {
  enabled: boolean;
  provider: "webshare" | "custom";
  custom?: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  manualReferenceIps?: string[];
}

export interface ProxyProviderInfo {
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
  ipListsByKey?: string[][];
  allIpList?: string[];
  total: number;
  validCount: number;
  telemetry?: {
    snapshotUpdatedAt?: string;
    cacheExpiresAt?: string;
    previousIps?: string[];
    currentIps?: string[];
    addedIps?: string[];
    removedIps?: string[];
    isUsingManualReference?: boolean;
  };
}

export interface LogCleanupResult {
  success: boolean;
  message: string;
  data?: {
    scannedCount: number;
    deletedCount: number;
    remainingCount: number;
    deletedFileCount: number;
    deletedMongoCount: number;
  };
}

export interface ResetResult {
  success: boolean;
  message: string;
  results?: Array<{
    status: string;
    step: string;
    message: string;
  }>;
}

export interface RiskSettingsCardProps {
  riskConfig: RiskConfig;
  setRiskConfigState: Dispatch<SetStateAction<RiskConfig>>;
  riskSaving: boolean;
  riskError: string | null;
  riskSuccess: boolean;
  handleRiskSave: () => void | Promise<void>;
}

export interface SignalSettingsCardProps {
  signalCfg: SignalSettingsForm;
  setSignalCfg: Dispatch<SetStateAction<SignalSettingsForm>>;
  signalSaving: boolean;
  signalError: string | null;
  signalSuccess: boolean;
  handleSignalSave: () => void | Promise<void>;
}

export interface CronSettingsCardProps {
  cronProvider: CronProvider;
  setCronProvider: Dispatch<SetStateAction<CronProvider>>;
  cronBaseUrl: string;
  setCronBaseUrl: Dispatch<SetStateAction<string>>;
  cronJobs: CronJobFormData[];
  setCronJobs: Dispatch<SetStateAction<CronJobFormData[]>>;
  cronSaving: boolean;
  cronError: string | null;
  cronSuccess: boolean;
  cronPulling: boolean;
  cronLiveStatus: CronLiveStatusItem[];
  handleCronSave: () => void | Promise<void>;
  handleCronPull: () => void | Promise<void>;
}
