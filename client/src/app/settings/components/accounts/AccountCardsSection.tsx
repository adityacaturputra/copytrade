import { createEmptyAccountForm, type AccountData, type HealthStatus } from "../../types";
import { AccountCardItem } from "./AccountCardItem";

export function AccountCardsSection({
  accounts,
  showForm,
  healthResults,
  checkingHealth,
  deleting,
  openAccountMenuId,
  setEditingId,
  setForm,
  setShowForm,
  setFormError,
  closeAccountActionsMenu,
  toggleAccountActionsMenu,
  handleToggleActive,
  handleToggleChannel,
  checkHealth,
  handleDuplicate,
  handleEdit,
  handleDelete,
}: {
  accounts: AccountData[];
  showForm: boolean;
  healthResults: Record<string, HealthStatus>;
  checkingHealth: string | null;
  deleting: string | null;
  openAccountMenuId: string | null;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  setFormError: React.Dispatch<React.SetStateAction<string | null>>;
  closeAccountActionsMenu: () => void;
  toggleAccountActionsMenu: (id: string) => void;
  handleToggleActive: (account: AccountData, nextActive: boolean) => void | Promise<void>;
  handleToggleChannel: (account: AccountData, channelId: string) => void | Promise<void>;
  checkHealth: (id?: string) => void | Promise<void>;
  handleDuplicate: (account: AccountData) => void;
  handleEdit: (account: AccountData) => void;
  handleDelete: (id: string) => void | Promise<void>;
}) {
  if (accounts.length === 0 && !showForm) {
    return (
      <div className="card text-center py-8">
        <p className="text-slate-400 text-lg mb-2">No accounts yet</p>
        <p className="text-slate-500 text-sm mb-4">
          Add your first trading account to start receiving and executing signals.
        </p>
        <button
          onClick={() => {
            setEditingId(null);
            setForm(createEmptyAccountForm());
            setShowForm(true);
            setFormError(null);
          }}
          className="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg text-sm font-medium transition"
        >
          ➕ Add Account
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {accounts.map((account) => (
        <AccountCardItem
          key={account._id}
          account={account}
          health={healthResults[account._id]}
          checkingHealth={checkingHealth}
          deleting={deleting}
          openAccountMenuId={openAccountMenuId}
          closeAccountActionsMenu={closeAccountActionsMenu}
          toggleAccountActionsMenu={toggleAccountActionsMenu}
          handleToggleActive={handleToggleActive}
          handleToggleChannel={handleToggleChannel}
          checkHealth={checkHealth}
          handleDuplicate={handleDuplicate}
          handleEdit={handleEdit}
          handleDelete={handleDelete}
        />
      ))}
    </div>
  );
}
