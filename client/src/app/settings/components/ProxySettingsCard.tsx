import { ProxyTelemetryPanel } from "./ProxyTelemetryPanel";
import type { ProxyConfigState, ProxyProviderInfo } from "../system-types";

export function ProxySettingsCard({
  proxyConfig,
  setProxyConfig,
  proxyProviderInfo,
  proxyLoading,
  proxyRefreshing,
  proxySaving,
  proxyError,
  customProxy,
  setCustomProxy,
  webshareApiKeysText,
  setWebshareApiKeysText,
  webshareActiveKeyIndex,
  setWebshareActiveKeyIndex,
  webshareAllowedCountriesText,
  setWebshareAllowedCountriesText,
  manualReferenceIpsText,
  setManualReferenceIpsText,
  proxyIpCsvCopied,
  handleProxyRefresh,
  handleProxySave,
  handleCopyProxyIpCsv,
}: {
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
  manualReferenceIpsText: string;
  setManualReferenceIpsText: React.Dispatch<React.SetStateAction<string>>;
  proxyIpCsvCopied: boolean;
  handleProxyRefresh: () => void | Promise<void>;
  handleProxySave: () => void | Promise<void>;
  handleCopyProxyIpCsv: () => void | Promise<void>;
}) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">🌐 Proxy Configuration</h2>
      {proxyLoading ? (
        <div className="spinner mx-auto" />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              checked={proxyConfig?.enabled ?? false}
              onChange={(e) =>
                setProxyConfig((prev) => ({
                  enabled: e.target.checked,
                  provider: prev?.provider || "webshare",
                  custom: prev?.custom,
                }))
              }
              className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
              id="proxyEnabled"
            />
            <label htmlFor="proxyEnabled" className="text-sm text-slate-400">
              Enable Proxy for Exchange API Calls
            </label>
          </div>

          {proxyConfig?.enabled && (
            <>
              <div className="mb-4">
                <label className="block text-xs text-slate-400 mb-1">Provider</label>
                <select
                  value={proxyConfig.provider}
                  onChange={(e) =>
                    setProxyConfig((prev) => ({
                      enabled: prev?.enabled ?? true,
                      provider: e.target.value as "webshare" | "custom",
                      custom: prev?.custom,
                    }))
                  }
                  className="w-full sm:w-64 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                >
                  <option value="webshare">Webshare (Static IP)</option>
                  <option value="custom">Custom Proxy</option>
                </select>
              </div>

              {proxyConfig.provider === "custom" ? (
                <CustomProxyFields customProxy={customProxy} setCustomProxy={setCustomProxy} />
              ) : (
                <WebshareFields
                  webshareApiKeysText={webshareApiKeysText}
                  setWebshareApiKeysText={setWebshareApiKeysText}
                  webshareActiveKeyIndex={webshareActiveKeyIndex}
                  setWebshareActiveKeyIndex={setWebshareActiveKeyIndex}
                  webshareAllowedCountriesText={webshareAllowedCountriesText}
                  setWebshareAllowedCountriesText={setWebshareAllowedCountriesText}
                  manualReferenceIpsText={manualReferenceIpsText}
                  setManualReferenceIpsText={setManualReferenceIpsText}
                  handleProxySave={handleProxySave}
                  proxySaving={proxySaving}
                  savedManualIps={proxyConfig?.manualReferenceIps}
                />
              )}

              {proxyProviderInfo && (
                <ProxyTelemetryPanel
                  proxyProviderInfo={proxyProviderInfo}
                  proxyIpCsvCopied={proxyIpCsvCopied}
                  handleCopyProxyIpCsv={handleCopyProxyIpCsv}
                />
              )}
            </>
          )}

          {proxyError && <p className="text-red-400 text-xs mb-2">⚠️ {proxyError}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void handleProxyRefresh()}
              disabled={proxyRefreshing || proxySaving}
              className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm transition"
            >
              {proxyRefreshing ? "Refreshing..." : "🔄 Refresh Proxy Info"}
            </button>
            <button
              onClick={() => void handleProxySave()}
              disabled={proxySaving || proxyRefreshing}
              className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              {proxySaving ? "Saving..." : "💾 Save Proxy Config"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CustomProxyFields({ customProxy, setCustomProxy }: {
  customProxy: { host: string; port: number; username: string; password: string };
  setCustomProxy: React.Dispatch<React.SetStateAction<{ host: string; port: number; username: string; password: string }>>;
}) {
  const update = (key: keyof typeof customProxy, value: string | number) => {
    setCustomProxy((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <InputField label="Host" value={customProxy.host} onChange={(value) => update("host", value)} />
      <InputField label="Port" type="number" value={String(customProxy.port)} onChange={(value) => update("port", Number(value))} />
      <InputField label="Username" value={customProxy.username} onChange={(value) => update("username", value)} />
      <InputField label="Password" type="password" value={customProxy.password} onChange={(value) => update("password", value)} />
    </div>
  );
}

function WebshareFields({
  webshareApiKeysText,
  setWebshareApiKeysText,
  webshareActiveKeyIndex,
  setWebshareActiveKeyIndex,
  webshareAllowedCountriesText,
  setWebshareAllowedCountriesText,
  manualReferenceIpsText,
  setManualReferenceIpsText,
  handleProxySave,
  proxySaving,
  savedManualIps,
}: {
  webshareApiKeysText: string;
  setWebshareApiKeysText: React.Dispatch<React.SetStateAction<string>>;
  webshareActiveKeyIndex: number;
  setWebshareActiveKeyIndex: React.Dispatch<React.SetStateAction<number>>;
  webshareAllowedCountriesText: string;
  setWebshareAllowedCountriesText: React.Dispatch<React.SetStateAction<string>>;
  manualReferenceIpsText: string;
  setManualReferenceIpsText: React.Dispatch<React.SetStateAction<string>>;
  handleProxySave: () => void | Promise<void>;
  proxySaving: boolean;
  savedManualIps?: string[];
}) {
  return (
    <div className="space-y-4 mb-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Webshare API Key Pool</label>
        <textarea
          value={webshareApiKeysText}
          onChange={(e) => setWebshareApiKeysText(e.target.value)}
          rows={5}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
        />
      </div>
      <InputField
        label="Active API Key Index"
        type="number"
        value={String(webshareActiveKeyIndex)}
        onChange={(value) => setWebshareActiveKeyIndex(Number(value))}
      />
      <div>
        <label className="block text-xs text-slate-400 mb-1">Allowed Countries</label>
        <input
          type="text"
          value={webshareAllowedCountriesText}
          onChange={(e) => setWebshareAllowedCountriesText(e.target.value)}
          placeholder="US,SG,JP"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
        />
        <p className="mt-2 text-xs text-slate-500">
          If set, proxy selection will prioritize only these ISO country codes.
        </p>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Manual Whitelisted Exchange IPs</label>
        <textarea
          value={manualReferenceIpsText}
          onChange={(e) => setManualReferenceIpsText(e.target.value)}
          rows={3}
          placeholder="Paste IPs from Exchange here (one per line or comma-separated)"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
        />
        <p className="mt-2 text-xs text-slate-500">
          If set, Telemetry will compare Webshare IPs against this manual list instead of the last auto-snapshot.
        </p>
        {savedManualIps && savedManualIps.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-slate-400 mb-1">Saved IPs ({savedManualIps.length})</p>
            <div className="flex flex-wrap gap-1">
              {savedManualIps.map((ip) => (
                <span key={ip} className="text-xs font-mono bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">
                  {ip}
                </span>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={() => void handleProxySave()}
          disabled={proxySaving}
          className="mt-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs transition border border-slate-600 text-slate-200"
        >
          {proxySaving ? "Saving..." : "💾 Save Manual IPs"}
        </button>
      </div>
    </div>
  );
}

function InputField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string; }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
      />
    </div>
  );
}
