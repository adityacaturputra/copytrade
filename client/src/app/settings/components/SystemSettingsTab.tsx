import { RiskSettingsCard } from "./RiskSettingsCard";
import { SignalSettingsCard } from "./SignalSettingsCard";
import { CronSettingsCard } from "./CronSettingsCard";
import { ProxySettingsCard } from "./ProxySettingsCard";
import { LogCleanupCard } from "./LogCleanupCard";
import { ResetSettingsCard } from "./ResetSettingsCard";
import type {
  CronJobFormData,
  CronLiveStatusItem,
  LogCleanupResult,
  ProxyConfigState,
  ProxyProviderInfo,
  ResetResult,
  SignalSettingsForm,
} from "../system-types";
import type { CronProvider } from "@copytrade/shared/lib/cron/client";
import type { RiskConfig } from "../types";

export function SystemSettingsTab(props: {
  riskConfig: RiskConfig;
  setRiskConfigState: React.Dispatch<React.SetStateAction<RiskConfig>>;
  riskSaving: boolean;
  riskError: string | null;
  riskSuccess: boolean;
  handleRiskSave: () => void | Promise<void>;
  signalCfg: SignalSettingsForm;
  setSignalCfg: React.Dispatch<React.SetStateAction<SignalSettingsForm>>;
  signalSaving: boolean;
  signalError: string | null;
  signalSuccess: boolean;
  handleSignalSave: () => void | Promise<void>;
  cronProvider: CronProvider;
  setCronProvider: React.Dispatch<React.SetStateAction<CronProvider>>;
  cronBaseUrl: string;
  setCronBaseUrl: React.Dispatch<React.SetStateAction<string>>;
  cronJobs: CronJobFormData[];
  setCronJobs: React.Dispatch<React.SetStateAction<CronJobFormData[]>>;
  cronSaving: boolean;
  cronError: string | null;
  cronSuccess: boolean;
  cronPulling: boolean;
  cronLiveStatus: CronLiveStatusItem[];
  handleCronSave: () => void | Promise<void>;
  handleCronPull: () => void | Promise<void>;
  proxyConfig: ProxyConfigState | null;
  setProxyConfig: React.Dispatch<React.SetStateAction<ProxyConfigState | null>>;
  proxyProviderInfo: ProxyProviderInfo | null;
  proxyLoading: boolean;
  proxyRefreshing: boolean;
  proxySaving: boolean;
  proxyError: string | null;
  customProxy: { host: string; port: number; username: string; password: string };
  setCustomProxy: React.Dispatch<React.SetStateAction<{ host: string; port: number; username: string; password: string }>>;
  webshareApiKeysText: string;
  setWebshareApiKeysText: React.Dispatch<React.SetStateAction<string>>;
  webshareActiveKeyIndex: number;
  setWebshareActiveKeyIndex: React.Dispatch<React.SetStateAction<number>>;
  webshareAllowedCountriesText: string;
  setWebshareAllowedCountriesText: React.Dispatch<React.SetStateAction<string>>;
  proxyIpCsvCopied: boolean;
  handleProxyRefresh: () => void | Promise<void>;
  handleProxySave: () => void | Promise<void>;
  handleCopyProxyIpCsv: () => void | Promise<void>;
  logCleanupLoading: string | null;
  logCleanupDays: string;
  setLogCleanupDays: React.Dispatch<React.SetStateAction<string>>;
  runLogCleanup: (mode: "noisy-json" | "retention") => void | Promise<void>;
  logCleanupResult: LogCleanupResult | null;
  resetShowConfirm: boolean;
  setResetShowConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  resetConfirmText: string;
  setResetConfirmText: React.Dispatch<React.SetStateAction<string>>;
  resetLoading: boolean;
  handleReset: () => void | Promise<void>;
  resetResult: ResetResult | null;
}) {
  return (
    <>
      <RiskSettingsCard
        riskConfig={props.riskConfig}
        setRiskConfigState={props.setRiskConfigState}
        riskSaving={props.riskSaving}
        riskError={props.riskError}
        riskSuccess={props.riskSuccess}
        handleRiskSave={props.handleRiskSave}
      />
      <SignalSettingsCard
        signalCfg={props.signalCfg}
        setSignalCfg={props.setSignalCfg}
        signalSaving={props.signalSaving}
        signalError={props.signalError}
        signalSuccess={props.signalSuccess}
        handleSignalSave={props.handleSignalSave}
      />
      <CronSettingsCard
        cronProvider={props.cronProvider}
        setCronProvider={props.setCronProvider}
        cronBaseUrl={props.cronBaseUrl}
        setCronBaseUrl={props.setCronBaseUrl}
        cronJobs={props.cronJobs}
        setCronJobs={props.setCronJobs}
        cronSaving={props.cronSaving}
        cronError={props.cronError}
        cronSuccess={props.cronSuccess}
        cronPulling={props.cronPulling}
        cronLiveStatus={props.cronLiveStatus}
        handleCronSave={props.handleCronSave}
        handleCronPull={props.handleCronPull}
      />
      <ProxySettingsCard
        proxyConfig={props.proxyConfig}
        setProxyConfig={props.setProxyConfig}
        proxyProviderInfo={props.proxyProviderInfo}
        proxyLoading={props.proxyLoading}
        proxyRefreshing={props.proxyRefreshing}
        proxySaving={props.proxySaving}
        proxyError={props.proxyError}
        customProxy={props.customProxy}
        setCustomProxy={props.setCustomProxy}
        webshareApiKeysText={props.webshareApiKeysText}
        setWebshareApiKeysText={props.setWebshareApiKeysText}
        webshareActiveKeyIndex={props.webshareActiveKeyIndex}
        setWebshareActiveKeyIndex={props.setWebshareActiveKeyIndex}
        webshareAllowedCountriesText={props.webshareAllowedCountriesText}
        setWebshareAllowedCountriesText={props.setWebshareAllowedCountriesText}
        proxyIpCsvCopied={props.proxyIpCsvCopied}
        handleProxyRefresh={props.handleProxyRefresh}
        handleProxySave={props.handleProxySave}
        handleCopyProxyIpCsv={props.handleCopyProxyIpCsv}
      />
      <LogCleanupCard
        logCleanupLoading={props.logCleanupLoading}
        logCleanupDays={props.logCleanupDays}
        setLogCleanupDays={props.setLogCleanupDays}
        runLogCleanup={props.runLogCleanup}
        logCleanupResult={props.logCleanupResult}
      />
      <ResetSettingsCard
        resetShowConfirm={props.resetShowConfirm}
        setResetShowConfirm={props.setResetShowConfirm}
        resetConfirmText={props.resetConfirmText}
        setResetConfirmText={props.setResetConfirmText}
        resetLoading={props.resetLoading}
        handleReset={props.handleReset}
        resetResult={props.resetResult}
      />
    </>
  );
}
