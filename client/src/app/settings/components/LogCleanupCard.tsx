import type { LogCleanupResult } from "../system-types";

export function LogCleanupCard({
  logCleanupLoading,
  logCleanupDays,
  setLogCleanupDays,
  runLogCleanup,
  logCleanupResult,
}: {
  logCleanupLoading: string | null;
  logCleanupDays: string;
  setLogCleanupDays: React.Dispatch<React.SetStateAction<string>>;
  runLogCleanup: (mode: "noisy-json" | "retention") => void | Promise<void>;
  logCleanupResult: LogCleanupResult | null;
}) {
  return (
    <div className="card border-amber-700/40">
      <h2 className="text-lg font-semibold mb-2 text-amber-300">🧹 Log Cleanup</h2>
      <p className="text-xs text-slate-400 mb-4">
        Clean up noisy JSON-like logs without touching recent useful entries, or delete old logs while keeping only the last N days.
      </p>

      <div className="space-y-4">
        <ActionPanel
          title="Delete noisy JSON logs"
          description="Removes cron start/end noise and logs whose details, result, or error are large JSON payloads."
          buttonLabel={logCleanupLoading === "noisy-json" ? "Cleaning..." : "🧹 Delete Noisy Logs"}
          buttonClass="bg-amber-600 hover:bg-amber-700"
          disabled={logCleanupLoading !== null}
          onClick={() => runLogCleanup("noisy-json")}
        />

        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
          <p className="text-sm text-white mb-2">Delete old logs and keep the last N days</p>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              type="number"
              min="1"
              step="1"
              value={logCleanupDays}
              onChange={(e) => setLogCleanupDays(e.target.value)}
              className="w-24 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
            />
            <span className="text-xs text-slate-400">day(s)</span>
          </div>
          <button
            onClick={() => void runLogCleanup("retention")}
            disabled={logCleanupLoading !== null}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            {logCleanupLoading === "retention" ? "Cleaning..." : "🗑️ Delete Old Logs"}
          </button>
        </div>
      </div>

      {logCleanupResult && (
        <div
          className={`mt-4 rounded-lg p-3 text-sm ${
            logCleanupResult.success ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-300"
          }`}
        >
          <p>{logCleanupResult.message}</p>
          {logCleanupResult.data && (
            <p className="mt-2 text-xs">
              Scanned: {logCleanupResult.data.scannedCount} | Deleted: {logCleanupResult.data.deletedCount} | Remaining: {logCleanupResult.data.remainingCount} | File: {logCleanupResult.data.deletedFileCount} | Mongo: {logCleanupResult.data.deletedMongoCount}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ActionPanel({
  title,
  description,
  buttonLabel,
  buttonClass,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  buttonClass: string;
  disabled: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
      <p className="text-sm text-white mb-2">{title}</p>
      <p className="text-xs text-slate-400 mb-3">{description}</p>
      <button
        onClick={() => void onClick()}
        disabled={disabled}
        className={`${buttonClass} disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition`}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
