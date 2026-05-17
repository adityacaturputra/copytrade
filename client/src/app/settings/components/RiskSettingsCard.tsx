import type { RiskSettingsCardProps } from "../system-types";

export function RiskSettingsCard({
  riskConfig,
  setRiskConfigState,
  riskSaving,
  riskError,
  riskSuccess,
  handleRiskSave,
}: RiskSettingsCardProps) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">🛡️ Risk Management</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <NumberField
          label="Risk Per Trade (%)"
          value={riskConfig.riskPerTradePercent}
          inputProps={{ step: "0.1", min: "0.1", max: "100" }}
          onChange={(value) =>
            setRiskConfigState((prev) => ({
              ...prev,
              riskPerTradePercent: value,
            }))
          }
        />
        <NumberField
          label="Default Position Size (USDT)"
          value={riskConfig.defaultPositionSize}
          inputProps={{ step: "1", min: "1" }}
          onChange={(value) =>
            setRiskConfigState((prev) => ({
              ...prev,
              defaultPositionSize: value,
            }))
          }
        />
        <NumberField
          label="Default Leverage"
          value={riskConfig.defaultLeverage}
          inputProps={{ min: "1", max: "200" }}
          onChange={(value) =>
            setRiskConfigState((prev) => ({ ...prev, defaultLeverage: value }))
          }
        />
        <NumberField
          label="Max Leverage"
          value={riskConfig.maxLeverage}
          inputProps={{ min: "1", max: "200" }}
          onChange={(value) =>
            setRiskConfigState((prev) => ({ ...prev, maxLeverage: value }))
          }
        />
        <NumberField
          label="Default Risk/Reward Ratio"
          value={riskConfig.defaultRR}
          inputProps={{ step: "0.1", min: "0.5" }}
          onChange={(value) =>
            setRiskConfigState((prev) => ({ ...prev, defaultRR: value }))
          }
        />
        <NumberField
          label="Max Open Positions"
          value={riskConfig.maxPositions}
          inputProps={{ min: "1", max: "50" }}
          onChange={(value) =>
            setRiskConfigState((prev) => ({ ...prev, maxPositions: value }))
          }
        />
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="block text-xs text-slate-400 mb-1">
            Minimum Order Auto-Raise
          </label>
          <label className="flex items-center gap-2 h-[42px] px-3 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white">
            <input
              type="checkbox"
              checked={riskConfig.autoRaiseMinOrderEnabled}
              onChange={(e) =>
                setRiskConfigState((prev) => ({
                  ...prev,
                  autoRaiseMinOrderEnabled: e.target.checked,
                }))
              }
              className="rounded border-slate-500 bg-slate-900 text-primary-500 focus:ring-primary-500"
            />
            <span>Allow auto-raise to exchange minimum</span>
          </label>
        </div>
        <NumberField
          label="Auto-Raise Max Margin (USDT)"
          value={riskConfig.autoRaiseMinOrderMaxMarginUsdt}
          inputProps={{ step: "0.01", min: "0" }}
          onChange={(value) =>
            setRiskConfigState((prev) => ({
              ...prev,
              autoRaiseMinOrderMaxMarginUsdt: value,
            }))
          }
        />
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="block text-xs text-slate-400 mb-1">
            Full TP Count Auto-Raise
          </label>
          <label className="flex items-center gap-2 h-[42px] px-3 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white">
            <input
              type="checkbox"
              checked={riskConfig.autoRaiseTpCountEnabled}
              onChange={(e) =>
                setRiskConfigState((prev) => ({
                  ...prev,
                  autoRaiseTpCountEnabled: e.target.checked,
                }))
              }
              className="rounded border-slate-500 bg-slate-900 text-primary-500 focus:ring-primary-500"
            />
            <span>Allow auto-raise to fit all TP legs</span>
          </label>
        </div>
        <NumberField
          label="TP Auto-Raise Max Margin (USDT)"
          value={riskConfig.autoRaiseTpCountMaxMarginUsdt}
          inputProps={{ step: "0.01", min: "0" }}
          onChange={(value) =>
            setRiskConfigState((prev) => ({
              ...prev,
              autoRaiseTpCountMaxMarginUsdt: value,
            }))
          }
        />
      </div>
      <div className="flex items-center gap-2 mt-4">
        <input
          type="checkbox"
          id="skipNoSL"
          checked={riskConfig.skipNoSL}
          onChange={(e) =>
            setRiskConfigState((prev) => ({ ...prev, skipNoSL: e.target.checked }))
          }
          className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
        />
        <label htmlFor="skipNoSL" className="text-sm text-slate-400">
          Skip signals without Stop Loss
        </label>
      </div>
      {riskError && <p className="text-red-400 text-xs mt-2">⚠️ {riskError}</p>}
      {riskSuccess && (
        <p className="text-emerald-400 text-xs mt-2">✅ Risk config saved</p>
      )}
      <button
        onClick={() => void handleRiskSave()}
        disabled={riskSaving}
        className="mt-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition"
      >
        {riskSaving ? "Saving..." : "💾 Save Risk Config"}
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  inputProps,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
        {...inputProps}
      />
    </div>
  );
}
