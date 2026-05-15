"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HistoryItem } from "../../types";

export function AgentHistoryList(props: {
  historyLoading: boolean;
  historyList: HistoryItem[];
  loadHistoryDetail: (item: HistoryItem) => Promise<void>;
}) {
  const { historyLoading, historyList, loadHistoryDetail } = props;
  if (historyLoading) return <div className="text-slate-400">Loading history...</div>;
  if (historyList.length === 0) return <div className="text-slate-400">No history found.</div>;
  return (
    <div className="space-y-3">
      {historyList.map((item) => (
        <div key={item.id} onClick={() => void loadHistoryDetail(item)} className="cursor-pointer rounded-xl border border-slate-700 bg-slate-800 p-4 transition hover:bg-slate-700/80">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${item.sessionId === "position-monitor-session" ? "bg-purple-900/40 border border-purple-700/50 text-purple-300" : "bg-blue-900/40 border border-blue-700/50 text-blue-300"}`}>
                {item.sessionId === "position-monitor-session" ? "🤖 Position Monitor" : "👤 User Chat"}
              </span>
              <span className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</span>
            </div>
            <span className="text-xs text-slate-500">{item.toolCount} tool calls</span>
          </div>
          <p className="text-sm text-slate-300 line-clamp-2">{item.sessionId === "position-monitor-session" ? item.assistantResponse || "No response" : item.userMessage}</p>
        </div>
      ))}
    </div>
  );
}

export function AgentHistoryDetail(props: {
  historyDetail: any;
  historyLoading: boolean;
  onBack: () => void;
}) {
  const { historyDetail, historyLoading, onBack } = props;
  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"><span>←</span> Back to History</button>
      {historyLoading ? <div className="text-slate-400">Loading details...</div> : historyDetail ? (
        <div className="space-y-6">
          <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary-600 px-4 py-3 text-sm text-white whitespace-pre-wrap leading-relaxed">{historyDetail.userMessage}</div></div>
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-slate-700 bg-slate-800 px-4 py-3 text-slate-200">
              <div className="agent-markdown text-sm leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]}>{historyDetail.assistantResponse || "No response"}</ReactMarkdown></div>
              {historyDetail.toolTraces && historyDetail.toolTraces.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-slate-500 mb-2">Tool Calls:</p>
                  {historyDetail.toolTraces.map((trace: any, i: number) => (
                    <div key={i} className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-2.5">
                      <div className="flex items-center gap-2 mb-2"><span className="text-xs font-mono text-primary-400">{trace.toolName}</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${trace.status === "executed" ? "bg-emerald-900/30 text-emerald-400" : "bg-amber-900/30 text-amber-400"}`}>{trace.status}</span></div>
                      <div className="text-xs text-slate-400 max-h-32 overflow-y-auto font-mono whitespace-pre-wrap">{JSON.stringify(trace.toolArgs, null, 2)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
