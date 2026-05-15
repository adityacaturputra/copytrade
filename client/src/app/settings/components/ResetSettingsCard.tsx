import type { ResetResult } from "../system-types";

export function ResetSettingsCard({
  resetShowConfirm,
  setResetShowConfirm,
  resetConfirmText,
  setResetConfirmText,
  resetLoading,
  handleReset,
  resetResult,
}: {
  resetShowConfirm: boolean;
  setResetShowConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  resetConfirmText: string;
  setResetConfirmText: React.Dispatch<React.SetStateAction<string>>;
  resetLoading: boolean;
  handleReset: () => void | Promise<void>;
  resetResult: ResetResult | null;
}) {
  return (
    <div className="card border-red-700/50">
      <h2 className="text-lg font-semibold mb-2 text-red-400">⚠️ Danger Zone</h2>
      <p className="text-xs text-slate-400 mb-4">
        This will delete ALL positions, drafts, and trade logs. Account configurations will be preserved.
      </p>

      {!resetShowConfirm ? (
        <button
          onClick={() => setResetShowConfirm(true)}
          className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-medium transition"
        >
          🗑️ Reset All Data
        </button>
      ) : (
        <div className="space-y-3 bg-red-900/20 border border-red-700/50 rounded-lg p-4">
          <p className="text-sm text-red-300">
            Type <strong>RESET</strong> to confirm:
          </p>
          <input
            type="text"
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value)}
            placeholder="RESET"
            className="w-full sm:w-48 bg-slate-800 border border-red-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void handleReset()}
              disabled={resetConfirmText !== "RESET" || resetLoading}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              {resetLoading ? "Resetting..." : "🗑️ Confirm Reset"}
            </button>
            <button
              onClick={() => {
                setResetShowConfirm(false);
                setResetConfirmText("");
              }}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {resetResult && (
        <div
          className={`mt-3 rounded-lg p-3 text-sm ${
            resetResult.success ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-300"
          }`}
        >
          <p>{resetResult.message}</p>
          {resetResult.results && (
            <ul className="mt-2 space-y-1 text-xs">
              {resetResult.results.map((result, index) => (
                <li key={index}>
                  {result.status === "success" ? "✅" : "❌"} {result.step}: {result.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
