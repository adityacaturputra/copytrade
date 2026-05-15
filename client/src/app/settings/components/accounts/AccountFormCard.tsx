import { createEmptyAccountForm, type AccountFormData } from "../../types";
import { AccountBasicInfoSection } from "./AccountBasicInfoSection";
import { DiscordSourceSection } from "./DiscordSourceSection";
import { TelegramSourceSection } from "./TelegramSourceSection";
import { ChannelsSection } from "./ChannelsSection";
import { ExchangeConfigSection } from "./ExchangeConfigSection";

export function AccountFormCard({
  showForm,
  editingId,
  form,
  setForm,
  saving,
  formError,
  setFormError,
  setShowForm,
  setEditingId,
  handleSubmit,
}: {
  showForm: boolean;
  editingId: string | null;
  form: AccountFormData;
  setForm: React.Dispatch<React.SetStateAction<AccountFormData>>;
  saving: boolean;
  formError: string | null;
  setFormError: React.Dispatch<React.SetStateAction<string | null>>;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  handleSubmit: (e: React.FormEvent) => void | Promise<void>;
}) {
  if (!showForm) return null;

  return (
    <div className="card border-primary-700/50">
      <h3 className="text-lg font-semibold mb-4">
        {editingId ? "✏️ Edit Account" : form.duplicateFromId ? "🧬 Duplicate Account" : "➕ Add New Account"}
      </h3>
      {form.duplicateFromId && !editingId && (
        <p className="text-xs text-slate-400 mb-4">
          Source token and exchange credentials will be reused from the original account unless you paste new values here.
        </p>
      )}
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        <AccountBasicInfoSection form={form} setForm={setForm} />
        <DiscordSourceSection form={form} setForm={setForm} editingId={editingId} />
        <TelegramSourceSection form={form} setForm={setForm} editingId={editingId} />
        <ChannelsSection form={form} setForm={setForm} />
        <ExchangeConfigSection form={form} setForm={setForm} editingId={editingId} />

        {formError && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300">
            ⚠️ {formError}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-medium transition"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <div className="spinner w-4 h-4 border-2" /> Saving...
              </span>
            ) : editingId ? (
              "💾 Update Account"
            ) : form.duplicateFromId ? (
              "🧬 Create Duplicate"
            ) : (
              "✅ Create Account"
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setEditingId(null);
              setForm(createEmptyAccountForm());
              setFormError(null);
            }}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
