import type { AccountFormData } from "../../types";

export function DiscordSourceSection({
  form,
  setForm,
  editingId,
}: {
  form: AccountFormData;
  setForm: React.Dispatch<React.SetStateAction<AccountFormData>>;
  editingId: string | null;
}) {
  if (form.sourceType !== "discord") return null;

  return (
    <div className="space-y-4 border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-slate-300">🤖 Discord Configuration</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Method *</label>
          <select
            value={form.method}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, method: e.target.value as "bot" | "user" }))
            }
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
          >
            <option value="bot">🤖 Bot Token (requires bot in server)</option>
            <option value="user">👤 User Token (personal account)</option>
          </select>
        </div>
        <PasswordField
          label={editingId ? "New Token (leave empty to keep)" : "Token *"}
          value={form.token}
          placeholder={editingId ? "Leave empty to keep current token" : "Discord token"}
          onChange={(value) => setForm((prev) => ({ ...prev, token: value }))}
        />
        <PasswordField
          label="Refresh Token (optional)"
          value={form.refreshToken}
          placeholder="For auto-refresh when token expires"
          onChange={(value) => setForm((prev) => ({ ...prev, refreshToken: value }))}
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="autoRefresh"
            checked={form.autoRefresh}
            onChange={(e) => setForm((prev) => ({ ...prev, autoRefresh: e.target.checked }))}
            className="rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="autoRefresh" className="text-sm text-slate-400">
            Auto health check before each signal fetch
          </label>
        </div>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1">{label}</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
      />
    </div>
  );
}
