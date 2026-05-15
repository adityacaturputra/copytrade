import type { SignalSettingsCardProps } from "../system-types";

export function SignalSettingsCard({
  signalCfg,
  setSignalCfg,
  signalSaving,
  signalError,
  signalSuccess,
  handleSignalSave,
}: SignalSettingsCardProps) {
  return (
    <>
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">📡 Signal Configuration</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            label="Fetch Limit (messages per channel)"
            value={signalCfg.fetchLimit}
            min={1}
            max={100}
            onChange={(value) =>
              setSignalCfg((prev) => ({ ...prev, fetchLimit: value }))
            }
          />
          <NumberField
            label="Time Window (hours)"
            value={signalCfg.timeWindowHours}
            min={1}
            max={168}
            onChange={(value) =>
              setSignalCfg((prev) => ({ ...prev, timeWindowHours: value }))
            }
          />
          <NumberField
            label="Batch Size (signals per AI call)"
            value={signalCfg.batchSize}
            min={1}
            max={20}
            onChange={(value) =>
              setSignalCfg((prev) => ({ ...prev, batchSize: value }))
            }
          />
          <CheckboxField
            id="includeImageUrls"
            label="Include image URLs in AI analysis"
            checked={signalCfg.includeImageUrls}
            onChange={(checked) =>
              setSignalCfg((prev) => ({ ...prev, includeImageUrls: checked }))
            }
          />
        </div>
        <SignalSaveState
          signalError={signalError}
          signalSuccess={signalSuccess}
          signalSaving={signalSaving}
          label="💾 Save Signal Config"
          onSave={handleSignalSave}
        />
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">🤖 Position Monitor Vision</h2>
        <p className="text-xs text-slate-400 mb-4">
          When enabled, Discord chart images from signal threads will be injected
          into the position monitor agent for visual analysis.
        </p>
        <CheckboxField
          id="monitorVisionImages"
          label="Enable Discord chart images in position monitor"
          checked={signalCfg.monitorVisionImages}
          onChange={(checked) =>
            setSignalCfg((prev) => ({ ...prev, monitorVisionImages: checked }))
          }
        />
        <SignalSaveState
          signalError={signalError}
          signalSuccess={signalSuccess}
          signalSaving={signalSaving}
          label="💾 Save Vision Setting"
          onSave={handleSignalSave}
        />
      </div>
    </>
  );
}

function SignalSaveState({
  signalError,
  signalSuccess,
  signalSaving,
  label,
  onSave,
}: {
  signalError: string | null;
  signalSuccess: boolean;
  signalSaving: boolean;
  label: string;
  onSave: () => void | Promise<void>;
}) {
  return (
    <>
      {signalError && <p className="text-red-400 text-xs mt-2">⚠️ {signalError}</p>}
      {signalSuccess && (
        <p className="text-emerald-400 text-xs mt-2">✅ Signal config saved</p>
      )}
      <button
        onClick={() => void onSave()}
        disabled={signalSaving}
        className="mt-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
      >
        {signalSaving ? "Saving..." : label}
      </button>
    </>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
      />
    </div>
  );
}

function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2 justify-center">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={id}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
        />
        <label htmlFor={id} className="text-sm text-slate-400">
          {label}
        </label>
      </div>
    </div>
  );
}
