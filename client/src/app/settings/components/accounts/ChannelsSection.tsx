import type { AccountFormData, AutoRaiseOverrideMode, TpCloseModeOverride } from "../../types";

export function ChannelsSection({
  form,
  setForm,
}: {
  form: AccountFormData;
  setForm: React.Dispatch<React.SetStateAction<AccountFormData>>;
}) {
  const updateChannel = (
    index: number,
    patch: Partial<AccountFormData["channels"][number]>,
  ) => {
    setForm((prev) => {
      const updated = [...prev.channels];
      updated[index] = { ...updated[index], ...patch };
      return { ...prev, channels: updated };
    });
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm text-slate-400">Channels *</label>
      <div className="rounded-lg border border-slate-700 p-4 bg-slate-900/30">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <InputField
            label="Account Risk Per Trade Override (%)"
            type="number"
            value={form.accountRiskPerTradePercent}
            placeholder="Leave empty to use global setting"
            onChange={(value) =>
              setForm((prev) => ({ ...prev, accountRiskPerTradePercent: value }))
            }
          />
          <div>
            <label className="block text-sm text-slate-400 mb-1">Account Min Order Auto-Raise</label>
            <select
              value={form.accountAutoRaiseMinOrderMode}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  accountAutoRaiseMinOrderMode: e.target.value as AutoRaiseOverrideMode,
                }))
              }
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="inherit">Use inherited</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <InputField
            label="Account Auto-Raise Max Margin (USDT)"
            type="number"
            value={form.accountAutoRaiseMinOrderMaxMarginUsdt}
            placeholder="Leave empty to use inherited cap"
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                accountAutoRaiseMinOrderMaxMarginUsdt: value,
              }))
            }
          />
          <div>
            <label className="block text-sm text-slate-400 mb-1">Account TP Auto-Raise</label>
            <select
              value={form.accountAutoRaiseTpCountMode}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  accountAutoRaiseTpCountMode: e.target.value as AutoRaiseOverrideMode,
                }))
              }
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="inherit">Use inherited</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <InputField
            label="Account TP Auto-Raise Max Margin (USDT)"
            type="number"
            value={form.accountAutoRaiseTpCountMaxMarginUsdt}
            placeholder="Leave empty to use inherited TP cap"
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                accountAutoRaiseTpCountMaxMarginUsdt: value,
              }))
            }
          />
          <div>
            <label className="block text-sm text-slate-400 mb-1">Account TP Close Mode</label>
            <select
              value={form.accountTpCloseMode}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  accountTpCloseMode: e.target.value as TpCloseModeOverride,
                }))
              }
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="inherit">Use inherited</option>
              <option value="equal">Equal</option>
              <option value="halving">Halving</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Override account berlaku di atas global. Channel tertentu tetap bisa override lagi, termasuk saat account di-set disabled dan channel di-set enabled.
        </p>
      </div>

      <div className="space-y-2">
        {form.channels.map((channel, index) => (
          <div
            key={index}
            className="rounded-lg border border-slate-700 bg-slate-900/30 p-3"
          >
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            <InputField
              value={channel.id}
              placeholder={form.sourceType === "telegram" ? "@channel_username or -100xxx" : "Channel ID"}
              onChange={(value) => updateChannel(index, { id: value })}
              className="font-mono"
            />
            <InputField
              value={channel.name}
              placeholder="Display name (optional)"
              onChange={(value) => updateChannel(index, { name: value })}
            />
            <InputField
              type="number"
              value={channel.riskPerTradePercent}
              placeholder="Channel RPT override %"
              onChange={(value) => updateChannel(index, { riskPerTradePercent: value })}
            />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,220px)_minmax(0,220px)_auto]">
            <select
              value={channel.autoRaiseMinOrderMode}
              onChange={(e) =>
                updateChannel(index, {
                  autoRaiseMinOrderMode: e.target.value as AutoRaiseOverrideMode,
                })
              }
              className="min-w-0 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="inherit">Auto-raise inherit</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <select
              value={channel.autoRaiseTpCountMode}
              onChange={(e) =>
                updateChannel(index, {
                  autoRaiseTpCountMode: e.target.value as AutoRaiseOverrideMode,
                })
              }
              className="min-w-0 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="inherit">TP auto-raise inherit</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <select
              value={channel.tpCloseMode}
              onChange={(e) =>
                updateChannel(index, {
                  tpCloseMode: e.target.value as TpCloseModeOverride,
                })
              }
              className="min-w-0 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="inherit">TP close mode inherit</option>
              <option value="equal">Equal</option>
              <option value="halving">Halving</option>
            </select>
            <div className="min-w-0">
              <InputField
                type="number"
                value={channel.autoRaiseMinOrderMaxMarginUsdt}
                placeholder="Auto-raise cap USDT"
                onChange={(value) =>
                  updateChannel(index, { autoRaiseMinOrderMaxMarginUsdt: value })
                }
              />
            </div>
            <div className="flex min-w-0 gap-2">
              <InputField
                type="number"
                value={channel.autoRaiseTpCountMaxMarginUsdt}
                placeholder="TP auto-raise cap USDT"
                onChange={(value) =>
                  updateChannel(index, { autoRaiseTpCountMaxMarginUsdt: value })
                }
              />
              {form.channels.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      channels: prev.channels.filter((_, i) => i !== index),
                    }))
                  }
                  className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-2 rounded-lg text-sm transition border border-red-700/50"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setForm((prev) => ({
              ...prev,
              channels: [
                ...prev.channels,
                {
                  id: "",
                  name: "",
                  riskPerTradePercent: "",
                  autoRaiseMinOrderMode: "inherit",
                  autoRaiseMinOrderMaxMarginUsdt: "",
                  autoRaiseTpCountMode: "inherit",
                  autoRaiseTpCountMaxMarginUsdt: "",
                  tpCloseMode: "inherit",
                },
              ],
            }))
          }
          className="text-xs text-primary-400 hover:text-primary-300 transition flex items-center gap-1"
        >
          ➕ Add another channel
        </button>
      </div>

      <p className="text-xs text-slate-500">
        {form.sourceType === "discord"
          ? "To get channel ID: Enable Developer Mode in Discord → Right click channel → Copy Channel ID"
          : "Use @username for public channels or numeric ID for private channels"}
      </p>
    </div>
  );
}

function InputField({
  label,
  value,
  placeholder,
  onChange,
  type = "text",
  className = "",
}: {
  label?: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <label className="block text-sm text-slate-400 mb-1">{label}</label>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
      />
    </div>
  );
}
