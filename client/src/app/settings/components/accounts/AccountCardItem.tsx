import { DEFAULT_ACCOUNT_EXCHANGE_PROVIDER } from "@copytrade/shared/lib/exchange/provider-config";
import type { AccountData, HealthStatus } from "../../types";

export function AccountCardItem({
  account,
  health,
  checkingHealth,
  deleting,
  openAccountMenuId,
  closeAccountActionsMenu,
  toggleAccountActionsMenu,
  handleToggleActive,
  handleToggleChannel,
  checkHealth,
  handleDuplicate,
  handleEdit,
  handleDelete,
}: {
  account: AccountData;
  health?: HealthStatus;
  checkingHealth: string | null;
  deleting: string | null;
  openAccountMenuId: string | null;
  closeAccountActionsMenu: () => void;
  toggleAccountActionsMenu: (id: string) => void;
  handleToggleActive: (account: AccountData, nextActive: boolean) => void | Promise<void>;
  handleToggleChannel: (account: AccountData, channelId: string) => void | Promise<void>;
  checkHealth: (id?: string) => void | Promise<void>;
  handleDuplicate: (account: AccountData) => void;
  handleEdit: (account: AccountData) => void;
  handleDelete: (id: string) => void | Promise<void>;
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h3 className="text-lg font-semibold text-white truncate">{account.name}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
              {account.sourceType === "telegram" ? "✈️ Telegram" : "🤖 Discord"}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
              💱 {account.tradingPlatform?.toUpperCase() || DEFAULT_ACCOUNT_EXCHANGE_PROVIDER.toUpperCase()}
            </span>
            {Boolean(account.exchangeData?.simulated) && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-700/50 text-amber-300">DEMO</span>
            )}
            <button
              onClick={() => void handleToggleActive(account, !account.isActive)}
              className={`text-xs px-2 py-0.5 rounded-full cursor-pointer transition ${
                account.isActive ? "bg-emerald-700/50 text-emerald-300" : "bg-red-700/50 text-red-300"
              }`}
            >
              {account.isActive ? "● ACTIVE" : "○ DISABLED"}
            </button>
          </div>

          {health && (
            <div className={`text-xs mb-2 ${health.valid ? "text-emerald-400" : "text-red-400"}`}>
              {health.valid ? "✅ Token valid" : `❌ ${health.error || "Invalid token"}`}
              {health.needsRefresh && " ⚠️ Needs refresh"}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {account.riskOverrides?.riskPerTradePercent ? (
              <span className="text-xs px-2 py-1 rounded border border-cyan-700/40 bg-cyan-900/20 text-cyan-300">
                Account RPT: {account.riskOverrides.riskPerTradePercent}%
              </span>
            ) : null}
            {account.riskOverrides?.autoRaiseMinOrderEnabled !== undefined ? (
              <span className="text-xs px-2 py-1 rounded border border-amber-700/40 bg-amber-900/20 text-amber-300">
                Account Min Auto-Raise: {account.riskOverrides.autoRaiseMinOrderEnabled ? `ON${account.riskOverrides.autoRaiseMinOrderMaxMarginUsdt !== undefined ? ` ≤ $${account.riskOverrides.autoRaiseMinOrderMaxMarginUsdt}` : ""}` : "OFF"}
              </span>
            ) : null}
            {account.riskOverrides?.autoRaiseTpCountEnabled !== undefined ? (
              <span className="text-xs px-2 py-1 rounded border border-cyan-700/40 bg-cyan-900/20 text-cyan-300">
                Account TP Auto-Raise: {account.riskOverrides.autoRaiseTpCountEnabled ? `ON${account.riskOverrides.autoRaiseTpCountMaxMarginUsdt !== undefined ? ` ≤ $${account.riskOverrides.autoRaiseTpCountMaxMarginUsdt}` : ""}` : "OFF"}
              </span>
            ) : null}
            {(account.channelIds || []).map((channelId) => {
              const isDisabled = (account.disabledChannelIds || []).includes(channelId);
              const name = account.channelNames?.[channelId] || channelId;
              const overrides = account.channelConfigs?.[channelId]?.riskOverrides;
              return (
                <button
                  key={channelId}
                  onClick={() => void handleToggleChannel(account, channelId)}
                  className={`text-xs px-2 py-1 rounded transition border ${
                    isDisabled
                      ? "bg-red-900/30 border-red-700/50 text-red-400 line-through"
                      : "bg-slate-700/50 border-slate-600/50 text-slate-300 hover:bg-slate-600/50"
                  }`}
                  title={isDisabled ? `Click to enable ${channelId}` : `Click to disable ${channelId}`}
                >
                  {name}
                  {overrides?.riskPerTradePercent ? ` • ${overrides.riskPerTradePercent}%` : ""}
                  {overrides?.autoRaiseMinOrderEnabled !== undefined
                    ? overrides.autoRaiseMinOrderEnabled
                      ? ` • min≤$${overrides.autoRaiseMinOrderMaxMarginUsdt ?? "?"}`
                      : " • min off"
                    : ""}
                  {overrides?.autoRaiseTpCountEnabled !== undefined
                    ? overrides.autoRaiseTpCountEnabled
                      ? ` • tp≤$${overrides.autoRaiseTpCountMaxMarginUsdt ?? "?"}`
                      : " • tp off"
                    : ""}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
            {account.lastFetchedAt && <span>Last fetch: {new Date(account.lastFetchedAt).toLocaleString()}</span>}
            {account.lastError && <span className="text-red-400">Error: {account.lastError}</span>}
          </div>
        </div>

        <div className="relative shrink-0" data-account-actions-menu>
          <button
            type="button"
            onClick={() => toggleAccountActionsMenu(account._id)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition hover:border-slate-600 hover:bg-slate-700 hover:text-white"
            title="Account actions"
            aria-haspopup="menu"
            aria-expanded={openAccountMenuId === account._id}
          >
            ⋯
          </button>
          {openAccountMenuId === account._id && (
            <div className="absolute right-0 top-11 z-20 min-w-44 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur">
              <MenuButton
                onClick={() => {
                  closeAccountActionsMenu();
                  void checkHealth(account._id);
                }}
                disabled={checkingHealth !== null}
                icon={checkingHealth === account._id ? <div className="spinner h-4 w-4 border-2" /> : <span>🩺</span>}
                label="Check Health"
              />
              <MenuButton
                onClick={() => {
                  closeAccountActionsMenu();
                  handleDuplicate(account);
                }}
                icon={<span>🧬</span>}
                label="Duplicate"
              />
              <MenuButton
                onClick={() => {
                  closeAccountActionsMenu();
                  handleEdit(account);
                }}
                icon={<span>✏️</span>}
                label="Edit"
              />
              <MenuButton
                onClick={() => {
                  closeAccountActionsMenu();
                  void handleDelete(account._id);
                }}
                disabled={deleting === account._id}
                danger
                icon={deleting === account._id ? <div className="spinner h-4 w-4 border-2" /> : <span>🗑️</span>}
                label="Delete"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuButton({ onClick, icon, label, disabled = false, danger = false }: { onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean; danger?: boolean; }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${danger ? "text-red-300 hover:bg-red-950/40" : "text-slate-200 hover:bg-slate-800"}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
