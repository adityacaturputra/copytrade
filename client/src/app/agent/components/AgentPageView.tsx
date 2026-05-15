"use client";

import Link from "next/link";
import { useAgentPage } from "./use-agent-page";
import { AgentChatArea } from "./parts/ChatView";
import { AgentHistoryDetail, AgentHistoryList } from "./parts/HistoryView";

export function AgentPageView() {
  const {
    messages,
    input,
    setInput,
    loading,
    error,
    expandedSteps,
    toggleSteps,
    role,
    authLoading,
    currentView,
    setCurrentView,
    historyList,
    historyLoading,
    historyDetail,
    messagesEndRef,
    inputRef,
    sendMessage,
    handleApproval,
    handleKeyDown,
    clearChat,
    loadHistory,
    loadHistoryDetail,
  } = useAgentPage();

  const onApprovalDecision = async (messageId: string, approved: boolean) => {
    const message = messages.find((item) => item.id === messageId);
    if (!message?.approval) return;
    await handleApproval(messageId, message.approval, approved ? "approve" : "reject");
  };

  const quickPrompts = [
    "What's my account balance?",
    "Show my open positions",
    "Check pending drafts",
    "What's the BTC price?",
    "What are my current settings?",
    "Show recent activity logs",
  ];

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-dark-100 text-slate-400">Authenticating agent…</div>;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-dark-100 font-sans text-slate-200 antialiased">
      <header className="border-b border-slate-800 bg-dark-100/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Agent Console</h1>
            <p className="text-xs text-slate-400">Interactive ops assistant for CopyTrade</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentView("chat")} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Chat</button>
            <button onClick={() => void loadHistory()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">History</button>
            <Link href="/" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">Dashboard</Link>
          </div>
        </div>
      </header>

      {error ? <div className="border-b border-rose-900/40 bg-rose-950/20 px-4 py-2 text-sm text-rose-300">⚠️ {error}</div> : null}

      {currentView === "chat" ? (
        <>
          <AgentChatArea
            messages={messages}
            loading={loading}
            expandedSteps={expandedSteps}
            toggleSteps={toggleSteps}
            handleApproval={onApprovalDecision}
            messagesEndRef={messagesEndRef}
            role={role || "viewer"}
          />
          <div className="border-t border-slate-800 bg-dark-100/80 p-4 backdrop-blur-md">
            <div className="mx-auto max-w-4xl space-y-4">
              {messages.length === 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-3 py-2 text-left text-xs text-slate-400 transition hover:bg-slate-700/50 hover:text-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="relative flex items-end gap-2 rounded-2xl border border-slate-700 bg-slate-900/50 p-2 shadow-inner focus-within:border-primary-500/50 transition-all">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask the agent anything..."
                  className="flex-1 max-h-32 min-h-[44px] resize-none border-none bg-transparent p-3 text-sm text-white placeholder-slate-500 focus:ring-0"
                  rows={1}
                />
                <div className="flex gap-1.5 pb-1 pr-1">
                  <button onClick={clearChat} className="rounded-xl p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition" title="Clear chat">🗑️</button>
                  <button onClick={() => void loadHistory()} className="rounded-xl p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition" title="View history">🕒</button>
                  <button onClick={() => void sendMessage()} disabled={loading || !input.trim()} className="rounded-xl bg-primary-600 p-2 text-white shadow-lg shadow-primary-900/20 transition hover:bg-primary-500 disabled:opacity-50 disabled:grayscale">{loading ? "…" : "🚀"}</button>
                </div>
              </div>
              <p className="text-center text-[10px] text-slate-600">Mutating tools require approval and are enforced server-side.</p>
            </div>
          </div>
        </>
      ) : currentView === "history_list" ? (
        <div className="flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-4xl"><h2 className="mb-6 text-xl font-bold text-white">Agent Run History</h2><AgentHistoryList historyLoading={historyLoading} historyList={historyList} loadHistoryDetail={loadHistoryDetail} /></div></div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4"><AgentHistoryDetail historyDetail={historyDetail} historyLoading={historyLoading} onBack={() => setCurrentView("history_list")} /></div>
      )}
    </div>
  );
}
