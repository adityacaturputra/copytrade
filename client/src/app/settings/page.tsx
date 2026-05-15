"use client";

import { useState } from "react";
import { UnlockModal } from "@/lib/components/UnlockModal";
import { useActionAuth } from "@/lib/action-auth-context";
import { AccountsTab } from "./components/accounts/AccountsTab";
import { SystemSettingsTab } from "./components/SystemSettingsTab";
import { useSettingsAccounts } from "./useSettingsAccounts";
import { useSettingsConfig } from "./useSettingsConfig";
import { useSettingsOperations } from "./useSettingsOperations";

export default function SettingsPage() {
  const { requestShowUnlock } = useActionAuth();
  const [activeTab, setActiveTab] = useState<"accounts" | "system">("accounts");

  const check403 = (res: Response): boolean => {
    if (res.status !== 403) return false;
    requestShowUnlock();
    return true;
  };

  const accounts = useSettingsAccounts(check403);
  const config = useSettingsConfig(check403);
  const operations = useSettingsOperations(check403);

  if (accounts.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="spinner mx-auto mb-4" />
          <p className="text-slate-400">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-700 bg-dark-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <a href="/" className="text-slate-400 hover:text-white transition text-sm shrink-0">
                ← <span className="hidden sm:inline">Dashboard</span>
              </a>
              <div className="w-px h-5 sm:h-6 bg-slate-700" />
              <h1 className="text-base sm:text-xl font-bold text-white truncate">⚙️ Settings</h1>
            </div>
            <UnlockModal />
          </div>
        </div>
      </header>

      <div className="border-b border-slate-700 bg-dark-200">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
          <nav className="flex gap-1">
            <TabButton active={activeTab === "accounts"} onClick={() => setActiveTab("accounts")}>
              📡 Accounts
            </TabButton>
            <TabButton active={activeTab === "system"} onClick={() => setActiveTab("system")}>
              🔧 System Settings
            </TabButton>
          </nav>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {activeTab === "accounts" && <AccountsTab {...accounts} />}
        {activeTab === "system" && <SystemSettingsTab {...config} {...operations} />}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode; }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
        active
          ? "border-primary-500 text-primary-400"
          : "border-transparent text-slate-400 hover:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}
