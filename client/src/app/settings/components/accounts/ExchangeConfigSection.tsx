import type { ExchangeProviderConfig } from "@copytrade/shared/lib/exchange/provider-config";
import {
  getExchangeFieldConfigs,
  getExchangeFieldLabel,
  getExchangeFieldPlaceholder,
} from "../../exchange-form";
import { EXCHANGE_PROVIDER_OPTIONS, getTradingPlatformConfig, type AccountFormData } from "../../types";

export function ExchangeConfigSection({
  form,
  setForm,
  editingId,
}: {
  form: AccountFormData;
  setForm: React.Dispatch<React.SetStateAction<AccountFormData>>;
  editingId: string | null;
}) {
  const activeExchangeConfig = getTradingPlatformConfig(form.tradingPlatform);
  const activeExchangeFieldConfigs = getExchangeFieldConfigs(form.tradingPlatform);

  return (
    <div className="space-y-4 border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-slate-300">💱 Exchange Configuration</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Exchange Platform *</label>
          <select
            value={form.tradingPlatform}
            onChange={(e) => setForm((prev) => ({ ...prev, tradingPlatform: e.target.value }))}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
          >
            {EXCHANGE_PROVIDER_OPTIONS.map((option: ExchangeProviderConfig) => (
              <option key={option.provider} value={option.provider}>
                {option.optionLabel || option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="exchangeIsDemo"
            checked={form.exchangeIsDemo}
            onChange={(e) => setForm((prev) => ({ ...prev, exchangeIsDemo: e.target.checked }))}
            className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="exchangeIsDemo" className="text-sm text-slate-400">
            Demo / Simulated Trading
          </label>
        </div>
      </div>

      {activeExchangeConfig?.authMode !== "none" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {activeExchangeFieldConfigs.map((fieldConfig) => {
            const value = form.exchangeValues[fieldConfig.field] || "";
            const className = `w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white ${
              fieldConfig.monospace ? "font-mono " : ""
            }placeholder-slate-500 focus:border-primary-500 focus:outline-none`;

            return (
              <div key={fieldConfig.field}>
                <label className="block text-sm text-slate-400 mb-1">
                  {getExchangeFieldLabel(
                    fieldConfig,
                    activeExchangeConfig?.requiredFields || [],
                    Boolean(editingId),
                  )}
                </label>
                {fieldConfig.inputType === "select" ? (
                  <select
                    value={value}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        exchangeValues: {
                          ...prev.exchangeValues,
                          [fieldConfig.field]: e.target.value,
                        },
                      }))
                    }
                    className={className}
                  >
                    {(fieldConfig.options || []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={fieldConfig.inputType}
                    value={value}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        exchangeValues: {
                          ...prev.exchangeValues,
                          [fieldConfig.field]: e.target.value,
                        },
                      }))
                    }
                    placeholder={getExchangeFieldPlaceholder(fieldConfig, Boolean(editingId))}
                    className={className}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
