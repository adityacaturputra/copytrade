"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentStep {
  type: "thinking" | "tool_call" | "tool_result" | "response";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  duration?: number;
}

interface AgentApproval {
  sessionId: string;
  processId: string;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  role: "viewer" | "operator" | "admin";
  minimumRole: "viewer" | "operator" | "admin";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: AgentStep[];
  timestamp: Date;
  streaming?: boolean;
  approval?: AgentApproval | null;
  processId?: string | null;
}

type AgentRole = "viewer" | "operator" | "admin";

interface HistoryItem {
  id: string;
  processId: string;
  sessionId: string;
  role: string;
  status: string;
  userMessage: string;
  assistantResponse: string | null;
  createdAt: string;
  toolCount: number;
}

const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"
).replace(/\/+$/, "");
const AGENT_API_URL = `${API_BASE}/api/agent`;
const AGENT_AUTH_URL = `${API_BASE}/api/agent/auth`;
const AGENT_APPROVAL_URL = `${API_BASE}/api/agent/approval`;
const AGENT_HISTORY_URL = `${API_BASE}/api/agent/history`;
const STORAGE_PASSWORD_KEY = "agent-chat-password";
const STORAGE_SESSION_KEY = "agent-chat-session-id";

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `agentsess_${crypto.randomUUID()}`;
  }

  return `agentsess_${Date.now()}`;
}

export default function AgentChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [role, setRole] = useState<AgentRole | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordInput, setPasswordInput] = useState("");
  const [currentView, setCurrentView] = useState<"chat" | "history_list" | "history_detail">("chat");
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [historyDetail, setHistoryDetail] = useState<any>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (role) {
      inputRef.current?.focus();
    }
  }, [role]);

  const toggleSteps = (msgId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  };

  const authenticate = useCallback(
    async (nextPassword: string, preferredSessionId?: string) => {
      const resolvedSessionId = preferredSessionId || createSessionId();
      const res = await fetch(AGENT_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: nextPassword,
          sessionId: resolvedSessionId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to authenticate agent chat");
      }

      sessionStorage.setItem(STORAGE_PASSWORD_KEY, nextPassword);
      sessionStorage.setItem(STORAGE_SESSION_KEY, data.sessionId);
      setPassword(nextPassword);
      setPasswordInput(nextPassword);
      setSessionId(data.sessionId);
      setRole(data.role);
    },
    [],
  );

  useEffect(() => {
    const savedPassword = sessionStorage.getItem(STORAGE_PASSWORD_KEY) || "";
    const savedSessionId =
      sessionStorage.getItem(STORAGE_SESSION_KEY) || createSessionId();

    if (!savedPassword) {
      setSessionId(savedSessionId);
      setAuthLoading(false);
      return;
    }

    authenticate(savedPassword, savedSessionId)
      .catch(() => {
        sessionStorage.removeItem(STORAGE_PASSWORD_KEY);
        sessionStorage.removeItem(STORAGE_SESSION_KEY);
        setPassword("");
        setRole(null);
        setSessionId(savedSessionId);
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, [authenticate]);

  const logout = () => {
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    sessionStorage.removeItem(STORAGE_PASSWORD_KEY);
    sessionStorage.removeItem(STORAGE_SESSION_KEY);
    setPassword("");
    setPasswordInput("");
    setRole(null);
    setMessages([]);
    setError(null);
    setLoading(false);
    setSessionId(createSessionId());
  };

  const applyStreamEventToMessage = useCallback(
    (
      messageId: string,
      event:
        | { type: "step"; data: AgentStep }
        | { type: "token"; data: { token: string } }
        | { type: "done"; data: { response: string; processId?: string; status?: string } }
        | { type: "error"; data: { error: string; processId?: string } }
        | { type: "approval_required"; data: AgentApproval },
    ) => {
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) {
            return message;
          }

          if (event.type === "step") {
            return {
              ...message,
              steps: [...message.steps, event.data],
            };
          }

          if (event.type === "token") {
            return {
              ...message,
              content: message.content + (event.data.token || ""),
            };
          }

          if (event.type === "approval_required") {
            return {
              ...message,
              approval: event.data,
              processId: event.data.processId,
              streaming: false,
              content:
                message.content ||
                `Waiting for approval to run \`${event.data.toolName}\`.`,
            };
          }

          if (event.type === "done") {
            return {
              ...message,
              content: event.data.response || message.content,
              processId: event.data.processId || message.processId || null,
              streaming: false,
            };
          }

          return {
            ...message,
            content: `❌ ${event.data.error}`,
            processId: event.data.processId || message.processId || null,
            streaming: false,
          };
        }),
      );
    },
    [],
  );

  const readSseStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      messageId: string,
    ) => {
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          const eventLine = lines.find((line) => line.startsWith("event: "));
          const dataLine = lines.find((line) => line.startsWith("data: "));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.slice("event: ".length).trim();
          const payload = JSON.parse(dataLine.slice("data: ".length));

          if (eventType === "step") {
            applyStreamEventToMessage(messageId, {
              type: "step",
              data: payload as AgentStep,
            });
          } else if (eventType === "token") {
            applyStreamEventToMessage(messageId, {
              type: "token",
              data: payload as { token: string },
            });
          } else if (eventType === "approval_required") {
            applyStreamEventToMessage(messageId, {
              type: "approval_required",
              data: payload as AgentApproval,
            });
            setExpandedSteps((prev) => {
              const next = new Set(prev);
              next.add(messageId);
              return next;
            });
          } else if (eventType === "done") {
            applyStreamEventToMessage(messageId, {
              type: "done",
              data: payload as {
                response: string;
                processId?: string;
                status?: string;
              },
            });
            setExpandedSteps((prev) => {
              const next = new Set(prev);
              next.add(messageId);
              return next;
            });
          } else if (eventType === "error") {
            applyStreamEventToMessage(messageId, {
              type: "error",
              data: payload as { error: string; processId?: string },
            });
            setError(payload.error || "Unknown agent error");
          }
        }
      }
    },
    [applyStreamEventToMessage],
  );

  const executeAgentRequest = useCallback(
    async (
      request: {
        url: string;
        body: Record<string, unknown>;
      },
      messageId: string,
    ) => {
      if (!password) {
        throw new Error("Agent password is not set");
      }

      const controller = new AbortController();
      streamControllerRef.current = controller;

      const res = await fetch(request.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-password": password,
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response stream");
      }

      await readSseStream(reader, messageId);
    },
    [password, readSseStream],
  );

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading || !role) return;

    setError(null);
    const timestamp = new Date();
    const userMessage: ChatMessage = {
      id: `user-${timestamp.getTime()}`,
      role: "user",
      content: trimmed,
      steps: [],
      timestamp,
    };
    const assistantId = `assistant-${timestamp.getTime()}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      steps: [],
      timestamp: new Date(),
      streaming: true,
      approval: null,
      processId: null,
    };

    const history = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setLoading(true);

    try {
      await executeAgentRequest(
        {
          url: AGENT_API_URL,
          body: {
            sessionId,
            message: trimmed,
            history,
          },
        },
        assistantId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      if (message.toLowerCase().includes("abort")) {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === assistantId ? { ...item, streaming: false } : item,
          ),
        );
      } else {
        setError(message);
        setMessages((prev) =>
          prev.map((item) =>
            item.id === assistantId
              ? { ...item, content: `❌ ${message}`, streaming: false }
              : item,
          ),
        );
      }
    } finally {
      streamControllerRef.current = null;
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [executeAgentRequest, input, loading, messages, role, sessionId]);

  const handleApproval = useCallback(
    async (messageId: string, approval: AgentApproval, decision: "approve" | "reject") => {
      if (loading) return;

      setError(null);
      setLoading(true);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? {
                ...message,
                approval: null,
                streaming: true,
                content:
                  message.content ||
                  `Processing ${decision} for \`${approval.toolName}\`...`,
              }
            : message,
        ),
      );

      try {
        await executeAgentRequest(
          {
            url: AGENT_APPROVAL_URL,
            body: {
              sessionId: approval.sessionId,
              processId: approval.processId,
              decision,
            },
          },
          messageId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Network error";
        if (message.toLowerCase().includes("abort")) {
          setMessages((prev) =>
            prev.map((item) =>
              item.id === messageId ? { ...item, streaming: false } : item,
            ),
          );
        } else {
          setError(message);
          setMessages((prev) =>
            prev.map((item) =>
              item.id === messageId
                ? { ...item, content: `❌ ${message}`, streaming: false }
                : item,
            ),
          );
        }
      } finally {
        streamControllerRef.current = null;
        setLoading(false);
      }
    },
    [executeAgentRequest, loading],
  );

  const stopStreaming = () => {
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    setLoading(false);
  };

  const handlePasswordSubmit = async () => {
    const trimmed = passwordInput.trim();
    if (!trimmed) return;

    setError(null);
    setAuthLoading(true);
    try {
      await authenticate(trimmed, sessionId || createSessionId());
    } catch (error) {
      setError(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const loadHistory = useCallback(async () => {
    if (!password) return;
    setHistoryLoading(true);
    setCurrentView("history_list");
    setError(null);
    try {
      const res = await fetch(AGENT_HISTORY_URL, {
        headers: { "x-agent-password": password },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load history");
      }
      setHistoryList(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setHistoryLoading(false);
    }
  }, [password]);

  const loadHistoryDetail = useCallback(async (item: HistoryItem) => {
    if (!password) return;
    setSelectedHistory(item);
    setHistoryLoading(true);
    setCurrentView("history_detail");
    setError(null);
    try {
      const res = await fetch(`${AGENT_HISTORY_URL}/${item.processId}`, {
        headers: { "x-agent-password": password },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load history detail");
      }
      setHistoryDetail(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setHistoryLoading(false);
    }
  }, [password]);

  const quickPrompts = [
    "What's my account balance?",
    "Show my open positions",
    "Check pending drafts",
    "What's the BTC price?",
    "What are my current settings?",
    "Show recent activity logs",
  ];

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-100 text-slate-300">
        Loading agent access...
      </div>
    );
  }

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6">
          <h1 className="text-xl font-bold text-white">Agent Access</h1>
          <p className="mt-2 text-sm text-slate-400">
            Enter the agent password from `.env` to unlock chat access.
          </p>
          <input
            type="password"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handlePasswordSubmit();
              }
            }}
            className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white outline-none focus:border-primary-500"
            placeholder="Agent password"
          />
          {error && (
            <p className="mt-3 rounded-lg border border-red-700/40 bg-red-900/20 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <button
            onClick={() => void handlePasswordSubmit()}
            className="mt-4 w-full rounded-xl bg-primary-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-700"
          >
            Unlock Agent
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-slate-700 bg-dark-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-white">
              AI Trading Agent
            </h1>
            <p className="text-xs text-slate-400">
              True streaming • role: {role} • session: {sessionId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {currentView === "chat" ? (
              <button
                onClick={() => void loadHistory()}
                className="rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-700/50 px-3 py-1.5 text-xs font-semibold hover:bg-indigo-600/40"
              >
                History
              </button>
            ) : (
              <button
                onClick={() => setCurrentView("chat")}
                className="rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-700/50 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-600/40"
              >
                Back to Chat
              </button>
            )}
            {loading ? (
              <button
                onClick={stopStreaming}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Stop
              </button>
            ) : null}
            {messages.length > 0 ? (
              <button
                onClick={clearChat}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
              >
                Clear
              </button>
            ) : null}
            <button
              onClick={logout}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300"
            >
              Lock
            </button>
          </div>
        </div>
      </header>

      {currentView === "chat" ? (
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
          {messages.length === 0 && !loading ? (
            <div className="py-12 text-center">
              <div className="mb-4 text-6xl">🤖</div>
              <h2 className="text-2xl font-bold text-white">Agent Chat</h2>
              <p className="mx-auto mt-2 max-w-md text-slate-400">
                Read-only or approval-gated execution depending on your role.
              </p>
              <div className="mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-3">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setInput(prompt);
                      inputRef.current?.focus();
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-800 p-3 text-left text-sm text-slate-300 transition hover:bg-slate-700"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] ${message.role === "user" ? "order-2" : "order-1"}`}
              >
                {message.role === "assistant" && message.steps.length > 0 ? (
                  <div className="mb-2">
                    {expandedSteps.has(message.id) ? (
                      <div className="mb-2 space-y-2">
                        {message.steps.map((step, index) => (
                          <StepCard key={`${message.id}-${index}`} step={step} />
                        ))}
                      </div>
                    ) : null}
                    <button
                      onClick={() => toggleSteps(message.id)}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors"
                    >
                      {expandedSteps.has(message.id) ? "▲" : "▼"}{" "}
                      {message.steps.filter((step) => step.type === "tool_call").length}{" "}
                      tool calls
                    </button>
                  </div>
                ) : null}

                <div
                  className={`mb-1 flex items-center gap-2 ${message.role === "user" ? "justify-end" : ""}`}
                >
                  <span className="text-xs text-slate-500">
                    {message.role === "user" ? "You" : "Agent"}
                  </span>
                  <span className="text-xs text-slate-600">
                    {message.timestamp.toLocaleTimeString()}
                  </span>
                  {message.processId ? (
                    <span className="truncate text-xs text-slate-600">
                      {message.processId}
                    </span>
                  ) : null}
                  {message.streaming ? (
                    <span className="text-xs text-primary-400">● streaming</span>
                  ) : null}
                </div>

                <div
                  className={`rounded-2xl px-4 py-3 ${
                    message.role === "user"
                      ? "rounded-br-md bg-primary-600 text-white"
                      : "rounded-bl-md border border-slate-700 bg-slate-800 text-slate-200"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <div className="agent-markdown text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {message.content}
                    </div>
                  )}
                </div>

                {message.approval ? (
                  <div className="mt-2">
                    <ApprovalCard
                      approval={message.approval}
                      disabled={loading}
                      onApprove={() =>
                        void handleApproval(message.id, message.approval!, "approve")
                      }
                      onReject={() =>
                        void handleApproval(message.id, message.approval!, "reject")
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {error ? (
            <div className="flex justify-center">
              <div className="max-w-md rounded-lg border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-700 bg-dark-100">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about positions, logs, drafts, or request a trade operation..."
              rows={1}
              disabled={loading}
              className="min-h-[52px] flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white outline-none focus:border-primary-500"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
              className="rounded-xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-slate-600">
            Mutating tools are enforced server-side and require approval.
          </p>
        </div>
      </div>
        </>
      ) : currentView === "history_list" ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-xl font-bold text-white mb-6">Agent Run History</h2>
            {historyLoading ? (
              <div className="text-slate-400">Loading history...</div>
            ) : historyList.length === 0 ? (
              <div className="text-slate-400">No history found.</div>
            ) : (
              <div className="space-y-3">
                {historyList.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => void loadHistoryDetail(item)}
                    className="cursor-pointer rounded-xl border border-slate-700 bg-slate-800 p-4 transition hover:bg-slate-700/80"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {item.sessionId === "position-monitor-session" ? (
                          <span className="rounded-md bg-purple-900/40 border border-purple-700/50 px-2 py-0.5 text-xs font-semibold text-purple-300">
                            🤖 Position Monitor
                          </span>
                        ) : (
                          <span className="rounded-md bg-blue-900/40 border border-blue-700/50 px-2 py-0.5 text-xs font-semibold text-blue-300">
                            👤 User Chat
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">{item.toolCount} tool calls</span>
                    </div>
                    <p className="text-sm text-slate-300 line-clamp-2">
                      {item.sessionId === "position-monitor-session"
                        ? item.assistantResponse || "No response"
                        : item.userMessage}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-4xl">
            <button
              onClick={() => setCurrentView("history_list")}
              className="mb-6 flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"
            >
              <span>←</span> Back to History
            </button>
            {historyLoading ? (
              <div className="text-slate-400">Loading details...</div>
            ) : historyDetail ? (
              <div className="space-y-6">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary-600 px-4 py-3 text-sm text-white whitespace-pre-wrap leading-relaxed">
                    {historyDetail.userMessage}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-slate-700 bg-slate-800 px-4 py-3 text-slate-200">
                    <div className="agent-markdown text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {historyDetail.assistantResponse || "No response"}
                      </ReactMarkdown>
                    </div>
                    {historyDetail.toolTraces && historyDetail.toolTraces.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-xs text-slate-500 mb-2">Tool Calls:</p>
                        {historyDetail.toolTraces.map((trace: any, i: number) => (
                          <div key={i} className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-2.5">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-mono text-primary-400">
                                {trace.toolName}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${trace.status === 'executed' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-amber-900/30 text-amber-400'}`}>
                                {trace.status}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 max-h-32 overflow-y-auto font-mono whitespace-pre-wrap">
                              {JSON.stringify(trace.toolArgs, null, 2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  disabled,
  onApprove,
  onReject,
}: {
  approval: AgentApproval;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-900/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-200">
            Approval required for `{approval.toolName}`
          </p>
          <p className="mt-1 text-xs text-amber-100/80">
            Current role: {approval.role} • minimum role: {approval.minimumRole}
          </p>
        </div>
        <span className="text-xs text-amber-100/70">{approval.processId}</span>
      </div>
      <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950/40 p-3 text-xs text-slate-300">
        {JSON.stringify(approval.toolArgs, null, 2)}
      </pre>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onApprove}
          disabled={disabled}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={disabled}
          className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function StepCard({ step }: { step: AgentStep }) {
  if (step.type === "tool_call") {
    return (
      <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-primary-400">
            {step.toolName}
          </span>
          {step.toolArgs ? (
            <span className="truncate text-xs text-slate-500">
              {Object.entries(step.toolArgs)
                .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                .join(", ")}
            </span>
          ) : null}
          {step.duration ? (
            <span className="ml-auto text-xs text-slate-600">
              {step.duration}ms
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  const isError = step.content.includes('"error"');
  return (
    <div
      className={`rounded-lg p-2.5 text-xs font-mono ${
        isError
          ? "border border-red-700/30 bg-red-900/20 text-red-300"
          : "border border-green-700/20 bg-green-900/10 text-slate-300"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span>{isError ? "❌" : "✅"}</span>
        <span className="text-slate-500">{step.toolName} result</span>
      </div>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
        {formatToolResult(step.content)}
      </pre>
    </div>
  );
}

function formatToolResult(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
