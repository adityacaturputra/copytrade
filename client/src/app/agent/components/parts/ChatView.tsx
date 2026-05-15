"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApprovalCard } from "../ApprovalCard";
import { StepCard } from "../StepCard";
import type { AgentRole, ChatMessage } from "../../types";

export function AgentChatArea(props: {
  messages: ChatMessage[];
  loading: boolean;
  expandedSteps: Set<string>;
  toggleSteps: (id: string) => void;
  handleApproval: (msgId: string, approved: boolean) => Promise<void>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  role: AgentRole;
}) {
  const { messages, loading, expandedSteps, toggleSteps, handleApproval, messagesEndRef } = props;
  return (
    <div className="flex-1 overflow-y-auto p-4 scrollbar-hide">
      <div className="mx-auto max-w-4xl space-y-6">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${message.role === "user" ? "order-2" : "order-1"}`}>
              {message.role === "assistant" && message.steps.length > 0 ? (
                <div className="mb-2">
                  {expandedSteps.has(message.id) ? (
                    <div className="mb-2 space-y-2">
                      {message.steps.map((step, index) => <StepCard key={`${message.id}-${index}`} step={step} />)}
                    </div>
                  ) : null}
                  <button onClick={() => toggleSteps(message.id)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors">
                    {expandedSteps.has(message.id) ? "▲" : "▼"} {message.steps.filter((step) => step.type === "tool_call").length} tool calls
                  </button>
                </div>
              ) : null}

              <div className={`mb-1 flex items-center gap-2 ${message.role === "user" ? "justify-end" : ""}`}>
                <span className="text-xs text-slate-500">{message.role === "user" ? "You" : "Agent"}</span>
                <span className="text-xs text-slate-600">{message.timestamp.toLocaleTimeString()}</span>
                {message.processId ? <span className="truncate text-xs text-slate-600">{message.processId}</span> : null}
                {message.streaming ? <span className="text-xs text-primary-400">● streaming</span> : null}
              </div>

              <div className={`rounded-2xl px-4 py-3 ${message.role === "user" ? "rounded-br-md bg-primary-600 text-white" : "rounded-bl-md border border-slate-700 bg-slate-800 text-slate-200"}`}>
                {message.role === "assistant" ? (
                  message.content ? (
                    <div className="agent-markdown text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 py-1">
                      <div className="flex items-center gap-3 text-sm text-slate-400"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75"></span><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary-500"></span></span><span className="animate-pulse">Thinking & processing...</span></div>
                      <div className="space-y-2"><div className="h-3 w-3/4 animate-pulse rounded-md bg-slate-700"></div><div className="h-3 w-full animate-pulse rounded-md bg-slate-700"></div><div className="h-3 w-5/6 animate-pulse rounded-md bg-slate-700"></div></div>
                    </div>
                  )
                ) : <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>}
              </div>

              {message.approval ? (
                <div className="mt-2">
                  <ApprovalCard approval={message.approval} disabled={loading} onApprove={() => { void handleApproval(message.id, true); }} onReject={() => { void handleApproval(message.id, false); }} />
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
