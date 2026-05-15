import type { AccountFormData } from "../../types";

export function TelegramSourceSection({
  form,
  setForm,
  editingId,
}: {
  form: AccountFormData;
  setForm: React.Dispatch<React.SetStateAction<AccountFormData>>;
  editingId: string | null;
}) {
  if (form.sourceType !== "telegram") return null;

  return (
    <div className="space-y-4 border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-slate-300">✈️ Telegram Configuration</h4>
      <div>
        <label className="block text-sm text-slate-400 mb-1">
          {editingId ? "Bot Token (leave empty to keep)" : "Bot Token *"}
        </label>
        <input
          type="password"
          value={form.botToken}
          onChange={(e) => setForm((prev) => ({ ...prev, botToken: e.target.value }))}
          placeholder={editingId ? "Leave empty to keep current token" : "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
        />
        <p className="text-xs text-slate-500 mt-1">Get this from @BotFather on Telegram</p>
      </div>
    </div>
  );
}
