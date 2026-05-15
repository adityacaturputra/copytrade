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
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-white">
          Proxy IPs ({proxyProviderInfo.validCount}/{proxyProviderInfo.total} valid):
        </p>
        <button
          type="button"
          onClick={() => void handleCopyProxyIpCsv()}
          disabled={!proxyProviderInfo.ipList.length}
          className="text-[11px] bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-2 py-1 rounded text-slate-200 transition"
        >
          {proxyIpCsvCopied ? "✅ Copied CSV" : "📋 Copy CSV"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {proxyProviderInfo.ipList.map((ip) => (
          <span key={ip} className="text-xs font-mono bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">
            {ip}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        Copy CSV format: <span className="font-mono">ip1,ip2,ip3</span>
      </p>

      {proxyProviderInfo.telemetry && (
        <div className="pt-3 border-t border-slate-700 space-y-2">
          <p className="text-xs text-slate-400">
            IP changes since last snapshot
            {proxyProviderInfo.telemetry.snapshotUpdatedAt
              ? ` (${new Date(proxyProviderInfo.telemetry.snapshotUpdatedAt).toLocaleString()})`
              : ""}
          </p>
          <TelemetryList
            title="Added"
            tone="emerald"
            items={proxyProviderInfo.telemetry.addedIps || []}
            prefix="+"
          />
          <TelemetryList
            title="Removed"
            tone="amber"
            items={proxyProviderInfo.telemetry.removedIps || []}
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
