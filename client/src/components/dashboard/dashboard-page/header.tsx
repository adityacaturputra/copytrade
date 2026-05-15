"use client";

export function DashboardHeader(props: {
  loading: boolean;
  cronMenuRef: React.RefObject<HTMLDivElement | null>;
  showCronMenu: boolean;
  setShowCronMenu: (value: boolean) => void;
  tradingMode: string;
  toggleMode: () => void;
  switchingMode: boolean;
  triggeringCron: string | null;
  triggerCron: (type: "signal-check" | "position-monitor" | "tp-sl-monitor" | "orphan-cleanup") => Promise<void>;
  fetchData: () => Promise<void>;
  isUnlocked: boolean;
  isVerifying: boolean;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  menuPassword: string;
  setMenuPassword: (value: string) => void;
  authError: string | null;
}) {
  const {
    loading,
    cronMenuRef,
    showCronMenu,
    setShowCronMenu,
    tradingMode,
    toggleMode,
    switchingMode,
    triggeringCron,
    triggerCron,
    fetchData,
    isUnlocked,
    isVerifying,
    unlock,
    lock,
    menuPassword,
    setMenuPassword,
    authError,
  } = props;

  return (
    <header className="border-b border-slate-700 bg-dark-100 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="text-xl sm:text-2xl">📈</div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                CopyTrade
                {loading ? <div className="spinner w-4 h-4 border-2" /> : null}
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-400 hidden sm:block">
                AI-Powered Discord Signal Copier
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <a
              href="/agent"
              className="bg-purple-700 hover:bg-purple-600 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm transition flex items-center gap-1"
            >
              🤖 <span className="hidden sm:inline">Agent</span>
            </a>

            <div className="relative" ref={cronMenuRef}>
              <button
                onClick={() => setShowCronMenu(!showCronMenu)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                  showCronMenu
                    ? "bg-slate-700 text-white border border-slate-600"
                    : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
                title="Menu"
              >
                ⋯
              </button>

              {showCronMenu ? (
                <div className="absolute right-0 mt-1 w-64 rounded-xl border border-slate-700 bg-slate-900 shadow-xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700/50">
                    <span className="text-xs text-slate-300">
                      {tradingMode === "auto" ? "🤖 Auto Mode" : "👆 Manual Mode"}
                    </span>
                    <button
                      onClick={toggleMode}
                      disabled={switchingMode}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        tradingMode === "auto" ? "bg-green-600" : "bg-slate-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          tradingMode === "auto" ? "translate-x-4" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {[
                    ["signal-check", "🔍", "Check Signals"],
                    ["position-monitor", "📊", "Position Monitor"],
                    ["tp-sl-monitor", "🎯", "TP/SL Monitor"],
                    ["orphan-cleanup", "🧹", "Orphan Cleanup"],
                  ].map(([type, icon, label]) => (
                    <button
                      key={type}
                      onClick={() => {
                        void triggerCron(type as "signal-check" | "position-monitor" | "tp-sl-monitor" | "orphan-cleanup");
                        setShowCronMenu(false);
                      }}
                      disabled={triggeringCron === type}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2 text-sm border-t border-slate-700/30"
                    >
                      {triggeringCron === type ? <div className="spinner w-3.5 h-3.5 border-2" /> : <span>{icon}</span>}
                      <span className="text-white text-xs">{label}</span>
                    </button>
                  ))}

                  <div className="border-t border-slate-700/50 flex">
                    <a
                      href="/settings"
                      className="flex-1 text-center px-3 py-2.5 hover:bg-slate-800 transition text-xs text-slate-300"
                    >
                      ⚙️ Settings
                    </a>
                    <button
                      onClick={() => {
                        void fetchData();
                        setShowCronMenu(false);
                      }}
                      className="flex-1 text-center px-3 py-2.5 hover:bg-slate-800 transition text-xs text-slate-300 border-l border-slate-700/30"
                    >
                      🔄 Refresh
                    </button>
                  </div>

                  <div className="border-t border-slate-700/50 px-3 py-2.5">
                    {isUnlocked ? (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-emerald-400">🔓 Actions unlocked</span>
                        <button
                          onClick={() => {
                            lock();
                            setShowCronMenu(false);
                          }}
                          className="text-xs text-slate-400 hover:text-white transition px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                        >
                          Lock
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            value={menuPassword}
                            onChange={(event) => setMenuPassword(event.target.value)}
                            onKeyDown={async (event) => {
                              if (event.key !== "Enter") return;
                              const ok = await unlock(menuPassword);
                              if (ok) {
                                setMenuPassword("");
                                setShowCronMenu(false);
                              }
                            }}
                            placeholder="🔒 Action password"
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-primary-500"
                            autoFocus
                          />
                          <button
                            onClick={async () => {
                              const ok = await unlock(menuPassword);
                              if (ok) {
                                setMenuPassword("");
                                setShowCronMenu(false);
                              }
                            }}
                            disabled={isVerifying || !menuPassword}
                            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {isVerifying ? "..." : "Go"}
                          </button>
                        </div>
                        {authError ? <p className="text-xs text-red-400">{authError}</p> : null}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
