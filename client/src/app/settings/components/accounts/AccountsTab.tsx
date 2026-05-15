import { createEmptyAccountForm, type AccountData, type AccountFormData, type HealthStatus } from "../../types";
import { AccountFormCard } from "./AccountFormCard";
import { AccountCardsSection } from "./AccountCardsSection";

export function AccountsTab({
  accounts,
  checkingHealth,
  checkHealth,
  setEditingId,
  setForm,
  setShowForm,
  setFormError,
  showForm,
  editingId,
  form,
  saving,
  formError,
  error,
  healthResults,
  deleting,
  openAccountMenuId,
  closeAccountActionsMenu,
  toggleAccountActionsMenu,
  handleToggleActive,
  handleToggleChannel,
  handleDuplicate,
  handleEdit,
  handleDelete,
  handleSubmit,
}: {
  accounts: AccountData[];
  checkingHealth: string | null;
  checkHealth: (id?: string) => void | Promise<void>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  setForm: React.Dispatch<React.SetStateAction<AccountFormData>>;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  setFormError: React.Dispatch<React.SetStateAction<string | null>>;
  showForm: boolean;
  editingId: string | null;
  form: AccountFormData;
  saving: boolean;
  formError: string | null;
  error: string | null;
  healthResults: Record<string, HealthStatus>;
  deleting: string | null;
  openAccountMenuId: string | null;
  closeAccountActionsMenu: () => void;
  toggleAccountActionsMenu: (id: string) => void;
  handleToggleActive: (account: AccountData, nextActive: boolean) => void | Promise<void>;
  handleToggleChannel: (account: AccountData, channelId: string) => void | Promise<void>;
  handleDuplicate: (account: AccountData) => void;
  handleEdit: (account: AccountData) => void;
  handleDelete: (id: string) => void | Promise<void>;
  handleSubmit: (e: React.FormEvent) => void | Promise<void>;
}) {
  return (
    <>
      <div className="card bg-slate-800/50 border-slate-700">
        <h2 className="text-sm font-semibold text-slate-300 mb-2">📡 Trading Accounts</h2>
        <p className="text-xs text-slate-400">
          Each account links a signal source (Discord/Telegram) with an exchange (OKX/Binance/Bybit/MEXC/MetaTrader/Paper).
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void checkHealth()}
          disabled={checkingHealth !== null}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1.5"
        >
          {checkingHealth === "all" ? <div className="spinner w-4 h-4 border-2" /> : "🩺"}
          Check Health
        </button>
        <button
          onClick={() => {
            setEditingId(null);
            setForm(createEmptyAccountForm());
            setShowForm(true);
            setFormError(null);
          }}
          className="bg-primary-600 hover:bg-primary-700 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1.5"
        >
          ➕ Add Account
        </button>
      </div>

      <AccountFormCard
        showForm={showForm}
        editingId={editingId}
        form={form}
        setForm={setForm}
        saving={saving}
        formError={formError}
        setFormError={setFormError}
        setShowForm={setShowForm}
        setEditingId={setEditingId}
        handleSubmit={handleSubmit}
      />

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
          ⚠️ {error}
        </div>
      )}

      <AccountCardsSection
        accounts={accounts}
        showForm={showForm}
        healthResults={healthResults}
        checkingHealth={checkingHealth}
        deleting={deleting}
        openAccountMenuId={openAccountMenuId}
        setEditingId={setEditingId}
        setForm={setForm}
        setShowForm={setShowForm}
        setFormError={setFormError}
        closeAccountActionsMenu={closeAccountActionsMenu}
        toggleAccountActionsMenu={toggleAccountActionsMenu}
        handleToggleActive={handleToggleActive}
        handleToggleChannel={handleToggleChannel}
        checkHealth={checkHealth}
        handleDuplicate={handleDuplicate}
        handleEdit={handleEdit}
        handleDelete={handleDelete}
      />
    </>
  );
}
