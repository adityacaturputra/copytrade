"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ==================== Types ====================

interface AgentStep {
  type: "thinking" | "tool_call" | "tool_result" | "response";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  duration?: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[];
  timestamp: Date;
  streaming?: boolean; // still receiving tokens
}

// ==================== Component ====================

const AGENT_API_URL = `${(
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"
).replace(/\/+$/, "")}/api/agent`;

export default function AgentChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      steps: [],
      timestamp: new Date(),
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch(AGENT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });

      if (!res.ok) {
        const errData = await res.json();
        setError(errData.error || `HTTP ${res.status}`);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        return;
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response stream");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        let currentEvent = "";
        let currentData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6);
          } else if (line === "" && currentEvent && currentData) {
            // Empty line = end of event
            try {
              const parsed = JSON.parse(currentData);

              if (currentEvent === "step") {
                const step = parsed as AgentStep;
                // Tool call or result — add to steps
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, steps: [...(m.steps || []), step] }
                      : m,
                  ),
                );
              } else if (currentEvent === "token") {
                // Word-by-word streaming — append each token
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + (parsed.token || "") }
                      : m,
                  ),
                );
              } else if (currentEvent === "done") {
                // Finalize — use the full response from done event
                // to ensure completeness (in case any tokens were missed)
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: parsed.response || m.content,
                          streaming: false,
                        }
                      : m,
                  ),
                );
                // Auto-expand steps
                setExpandedSteps((prev) => {
                  const next = new Set(prev);
                  next.add(assistantId);
                  return next;
                });
              } else if (currentEvent === "error") {
                setError(parsed.error || "Unknown error");
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: `❌ ${parsed.error}`,
                          streaming: false,
                        }
                      : m,
                  ),
                );
              }
            } catch {
              // Ignore parse errors
            }

            currentEvent = "";
            currentData = "";
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const quickPrompts = [
    "📊 What's my account balance?",
    "📈 Show my open positions",
    "📝 Check pending drafts",
    "🔍 What's the BTC price?",
    "⚙️ What are my current settings?",
    "📊 Show recent activity logs",
  ];

  // Get current streaming assistant message
  const streamingMsg = messages.find((m) => m.streaming);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-slate-700 bg-dark-100 shrink-0">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <a
              href="/"
              className="text-slate-400 hover:text-white transition text-sm shrink-0"
            >
              ← <span className="hidden sm:inline">Dashboard</span>
            </a>
            <div className="w-px h-5 sm:h-6 bg-slate-700" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl sm:text-2xl shrink-0">🤖</span>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-white truncate">
                  AI Trading Agent
                </h1>
                <p className="text-[10px] sm:text-xs text-slate-400 truncate">
                  Real-time streaming • Agentic AI
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-xs text-slate-400 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg transition"
              >
                🗑️ Clear
              </button>
            )}
            {loading && (
              <span className="badge badge-success text-xs animate-pulse">
                ● Live
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          {/* Welcome */}
          {messages.length === 0 && !loading && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🤖</div>
              <h2 className="text-2xl font-bold text-white mb-2">
                AI Trading Agent
              </h2>
              <p className="text-slate-400 mb-8 max-w-md mx-auto">
                Real-time streaming responses. I can check your portfolio, view
                positions, manage drafts, place orders, and more.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl mx-auto">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setInput(prompt.slice(2).trim());
                      inputRef.current?.focus();
                    }}
                    className="text-left bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded-lg p-3 transition"
                  >
                    <span className="text-sm text-slate-300">{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] ${msg.role === "user" ? "order-2" : "order-1"}`}
              >
                {/* Role label */}
                <div
                  className={`flex items-center gap-2 mb-1 ${msg.role === "user" ? "justify-end" : ""}`}
                >
                  <span className="text-xs text-slate-500">
                    {msg.role === "user" ? "👤 You" : "🤖 Agent"}
                  </span>
                  <span className="text-xs text-slate-600">
                    {msg.timestamp.toLocaleTimeString()}
                  </span>
                  {msg.streaming && (
                    <span className="text-xs text-primary-400 animate-pulse">
                      ● streaming
                    </span>
                  )}
                </div>

                {/* Message bubble */}
                <div
                  className={`rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-primary-600 text-white rounded-br-md"
                      : "bg-slate-800 border border-slate-700 text-slate-200 rounded-bl-md"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="agent-markdown text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                      {msg.streaming && (
                        <span className="inline-block w-1.5 h-4 bg-primary-400 animate-pulse ml-0.5 align-text-bottom" />
                      )}
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {msg.content}
                    </div>
                  )}
                </div>

                {/* Agent steps — show in real-time */}
                {msg.role === "assistant" &&
                  msg.steps &&
                  msg.steps.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => toggleSteps(msg.id)}
                        className="text-xs text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
                      >
                        {expandedSteps.has(msg.id) ? "▼" : "▶"}{" "}
                        {msg.steps.filter((s) => s.type === "tool_call").length}{" "}
                        tool calls •{" "}
                        {
                          msg.steps.filter((s) => s.type === "tool_result")
                            .length
                        }{" "}
                        results
                      </button>
                      {expandedSteps.has(msg.id) && (
                        <div className="mt-2 space-y-2">
                          {msg.steps
                            .filter(
                              (s) =>
                                s.type === "tool_call" ||
                                s.type === "tool_result",
                            )
                            .map((step, idx) => (
                              <StepCard key={idx} step={step} />
                            ))}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </div>
          ))}

          {/* Loading indicator — only show when no streaming message yet */}
          {loading &&
            (!streamingMsg ||
              (!streamingMsg.content &&
                (!streamingMsg.steps || streamingMsg.steps.length === 0))) && (
              <div className="flex justify-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-slate-500">🤖 Agent</span>
                    <span className="text-xs text-slate-600">
                      connecting...
                    </span>
                  </div>
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <div
                          className="w-2 h-2 bg-primary-400 rounded-full animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <div
                          className="w-2 h-2 bg-primary-400 rounded-full animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <div
                          className="w-2 h-2 bg-primary-400 rounded-full animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </div>
                      <span className="text-sm text-slate-400">
                        Thinking & connecting...
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* Error */}
          {error && (
            <div className="flex justify-center">
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-300 max-w-md">
                ❌ {error}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-slate-700 bg-dark-100 shrink-0">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your trading account, positions, or manage trades..."
                rows={1}
                className="w-full bg-slate-800 border border-slate-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 resize-none outline-none transition"
                style={{ maxHeight: "120px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height =
                    Math.min(target.scrollHeight, 120) + "px";
                }}
                disabled={loading}
              />
            </div>
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-3 rounded-xl text-sm transition flex items-center gap-2 shrink-0"
            >
              {loading ? <div className="spinner w-4 h-4 border-2" /> : "Send"}
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-2 text-center">
            Real-time streaming • The agent has access to your exchange account,
            positions, drafts, and settings.
          </p>
        </div>
      </div>
    </div>
  );
}

// ==================== Sub-Components ====================

function StepCard({ step }: { step: AgentStep }) {
  if (step.type === "tool_call") {
    return (
      <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs">🔧</span>
          <span className="text-xs font-mono text-primary-400">
            {step.toolName}
          </span>
          {step.toolArgs && (
            <span className="text-xs text-slate-500 truncate">
              {Object.entries(step.toolArgs)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(", ")}
            </span>
          )}
          {step.duration && (
            <span className="text-xs text-slate-600 ml-auto">
              {step.duration}ms
            </span>
          )}
        </div>
      </div>
    );
  }

  if (step.type === "tool_result") {
    const isError = step.content.includes('"error"');
    return (
      <div
        className={`rounded-lg p-2.5 text-xs font-mono ${
          isError
            ? "bg-red-900/20 border border-red-700/30 text-red-300"
            : "bg-green-900/10 border border-green-700/20 text-slate-400"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span>{isError ? "❌" : "✅"}</span>
          <span className="text-slate-500">{step.toolName} result</span>
          {step.duration && (
            <span className="text-slate-600 ml-auto">{step.duration}ms</span>
          )}
        </div>
        <pre className="whitespace-pre-wrap break-all max-h-32 overflow-y-auto text-xs">
          {formatToolResult(step.content)}
        </pre>
      </div>
    );
  }

  return null;
}

function formatToolResult(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}
