import { CRON_PROVIDER_OPTIONS } from "@copytrade/shared/lib/cron/client";
import { RECOMMENDED_SCHEDULES } from "../types";
import type { CronSettingsCardProps } from "../system-types";

export function CronSettingsCard({
  cronProvider,
  setCronProvider,
  cronBaseUrl,
  setCronBaseUrl,
  cronJobs,
  setCronJobs,
  cronSaving,
  cronError,
  cronSuccess,
  cronPulling,
  cronLiveStatus,
  handleCronSave,
  handleCronPull,
}: CronSettingsCardProps) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">⏰ Cron Jobs (Scheduled Tasks)</h2>
      <div className="mb-4 space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-2">Cron Provider</label>
          <div className="grid gap-2 md:grid-cols-2">
            {CRON_PROVIDER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setCronProvider(option.value)}
                className={`rounded-lg border px-3 py-3 text-left transition ${
                  cronProvider === option.value
                    ? "border-primary-500 bg-primary-500/10"
                    : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
                }`}
              >
                <div className="text-sm font-medium text-white">{option.label}</div>
                <div className="mt-1 text-xs text-slate-400">{option.description}</div>
              </button>
            ))}
          </div>
        </div>

        {cronProvider === "cron-job.org" ? (
          <div>
            <label className="block text-xs text-slate-400 mb-1">Deployment Base URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={cronBaseUrl}
                onChange={(e) => setCronBaseUrl(e.target.value)}
                placeholder="https://your-app.vercel.app"
                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
              />
              <button
                onClick={() => void handleCronPull()}
                disabled={cronPulling}
                className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-2 rounded-lg text-sm transition whitespace-nowrap"
              >
                {cronPulling ? "..." : "☁️ Sync from Cloud"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Use this when cron-job.org should call your deployed app.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-3 text-xs text-slate-400">
            The backend app will run these schedules itself on your VPS.
          </div>
        )}
      </div>

      <div className="space-y-3">
        {cronJobs.map((job, idx) => {
          const recommended = RECOMMENDED_SCHEDULES[job.type]?.label || "Custom";
          const liveJob = cronLiveStatus.find((item) => item.type === job.type);
          return (
            <div key={job.type} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={job.enabled}
                    onChange={(e) =>
                      setCronJobs((prev) => {
                        const updated = [...prev];
                        updated[idx] = { ...updated[idx], enabled: e.target.checked };
                        return updated;
                      })
                    }
                    className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-white">{job.title}</span>
                  {liveJob && <LiveStatusBadge liveJob={liveJob} cronProvider={cronProvider} />}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Every</span>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={job.schedule.minutes}
                    onChange={(e) =>
                      setCronJobs((prev) => {
                        const updated = [...prev];
                        updated[idx] = {
                          ...updated[idx],
                          schedule: {
                            ...updated[idx].schedule,
                            minutes: Number(e.target.value),
                          },
                        };
                        return updated;
                      })
                    }
                    className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white text-center"
                  />
                  <span className="text-xs text-slate-500">min</span>
                  <span className="text-xs text-slate-500">(rec: {recommended})</span>
                </div>
              </div>
              {liveJob?.progress && (
                <p className="mt-2 text-xs text-slate-500">{liveJob.progress}</p>
              )}
            </div>
          );
        })}
      </div>

      {cronError && <p className="text-red-400 text-xs mt-2">⚠️ {cronError}</p>}
      {cronSuccess && (
        <p className="text-emerald-400 text-xs mt-2">
          ✅ {cronProvider === "cron-job.org" ? "Cron jobs synced" : "Cron provider saved"}
        </p>
      )}
      <button
        onClick={() => void handleCronSave()}
        disabled={cronSaving}
        className="mt-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
      >
        {cronSaving
          ? "Saving..."
          : cronProvider === "cron-job.org"
            ? "🔄 Sync Cron Jobs to Cloud"
            : "💾 Save App Cron Provider"}
      </button>
    </div>
  );
}

function LiveStatusBadge({ liveJob, cronProvider }: { liveJob: CronSettingsCardProps["cronLiveStatus"][number]; cronProvider: CronSettingsCardProps["cronProvider"]; }) {
  return (
    <>
      <span
        className={`text-xs px-1.5 py-0.5 rounded ${
          liveJob.status === "active"
            ? "bg-emerald-700/50 text-emerald-300"
            : liveJob.status === "disabled"
              ? "bg-slate-700 text-slate-300"
              : "bg-red-700/50 text-red-300"
        }`}
      >
        {liveJob.status === "active"
          ? cronProvider === "app"
            ? "APP"
            : "LIVE"
          : liveJob.status === "disabled"
            ? "DISABLED"
            : "NOT FOUND"}
      </span>
      {liveJob.running && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-700/50 text-amber-300">
          RUNNING
        </span>
      )}
    </>
  );
}
