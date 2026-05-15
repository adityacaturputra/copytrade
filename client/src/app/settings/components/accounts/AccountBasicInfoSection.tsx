import type { AccountFormData } from "../../types";

export function AccountBasicInfoSection({
  form,
  setForm,
}: {
  form: AccountFormData;
  setForm: React.Dispatch<React.SetStateAction<AccountFormData>>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm text-slate-400 mb-1">Account Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g., VIP Signals Group"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-sm text-slate-400 mb-1">Source Type *</label>
        <select
          value={form.sourceType}
          onChange={(e) => setForm((prev) => ({ ...prev, sourceType: e.target.value }))}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
        >
          <option value="discord">🤖 Discord</option>
          <option value="telegram">✈️ Telegram</option>
        </select>
      </div>
    </div>
  );
}
