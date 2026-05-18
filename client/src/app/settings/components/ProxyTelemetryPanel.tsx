import type { ProxyProviderInfo } from "../system-types";

export function ProxyTelemetryPanel({
  proxyProviderInfo,
  proxyIpCsvCopied,
  handleCopyProxyIpCsv,
}: {
  proxyProviderInfo: ProxyProviderInfo;
  proxyIpCsvCopied: boolean;
  handleCopyProxyIpCsv: () => void | Promise<void>;
}) {
  const ipList = Array.isArray(proxyProviderInfo?.ipList)
    ? proxyProviderInfo.ipList
    : [];
  const allIpList = Array.isArray(proxyProviderInfo?.allIpList)
    ? proxyProviderInfo.allIpList
    : ipList;
  const ipListsByKey = Array.isArray(proxyProviderInfo?.ipListsByKey)
    ? proxyProviderInfo.ipListsByKey
    : [];
  const telemetry = proxyProviderInfo?.telemetry;
  const addedIps = Array.isArray(telemetry?.addedIps) ? telemetry.addedIps : [];
  const removedIps = Array.isArray(telemetry?.removedIps)
    ? telemetry.removedIps
    : [];

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-white">
          Proxy IPs ({proxyProviderInfo.validCount}/{proxyProviderInfo.total} valid):
        </p>
        <button
          type="button"
          onClick={() => void handleCopyProxyIpCsv()}
          disabled={!allIpList.length}
          className="text-[11px] bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-2 py-1 rounded text-slate-200 transition"
        >
          {proxyIpCsvCopied ? "✅ Copied CSV" : "📋 Copy CSV"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {allIpList.map((ip) => (
          <span key={ip} className="text-xs font-mono bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">
            {ip}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        Copy CSV format: <span className="font-mono">ip1,ip2,ip3</span>
      </p>

      {ipListsByKey.length > 1 && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">Grouped by Webshare API key</p>
          <div className="space-y-2">
            {ipListsByKey.map((ips, index) => (
              <div key={`key-${index}`} className="space-y-1">
                <p className="text-[11px] text-slate-400">
                  API Key {index + 1} ({ips.length})
                </p>
                <div className="flex flex-wrap gap-1">
                  {ips.map((ip) => (
                    <span
                      key={`key-${index}-${ip}`}
                      className="text-xs font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300"
                    >
                      {ip}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {telemetry && (
        <div className="pt-3 border-t border-slate-700 space-y-2">
          <p className="text-xs text-slate-400">
            IP changes since last snapshot
            {telemetry.snapshotUpdatedAt
              ? ` (${new Date(telemetry.snapshotUpdatedAt).toLocaleString()})`
              : ""}
          </p>
          <TelemetryList
            title="Added"
            tone="emerald"
            items={addedIps}
            prefix="+"
          />
          <TelemetryList
            title="Removed"
            tone="amber"
            items={removedIps}
            prefix="-"
          />
        </div>
      )}
    </div>
  );
}

function TelemetryList({
  title,
  tone,
  items,
  prefix,
}: {
  title: string;
  tone: "emerald" | "amber";
  items: string[];
  prefix: string;
}) {
  const titleClass = tone === "emerald" ? "text-emerald-400" : "text-amber-400";
  const pillClass =
    tone === "emerald"
      ? "bg-emerald-900/40 border-emerald-700 text-emerald-200"
      : "bg-amber-900/40 border-amber-700 text-amber-200";

  return (
    <div>
      <p className={`text-[11px] ${titleClass} mb-1`}>
        {title} ({items.length})
      </p>
      <div className="flex flex-wrap gap-1">
        {items.length ? (
          items.map((ip) => (
            <span key={`${title}-${ip}`} className={`text-xs font-mono border px-1.5 py-0.5 rounded ${pillClass}`}>
              {prefix} {ip}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-500">none</span>
        )}
      </div>
    </div>
  );
}
