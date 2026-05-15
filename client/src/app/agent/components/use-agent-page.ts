"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredActionPassword } from "@/lib/action-auth";
import { useActionAuth } from "@/lib/action-auth-context";
import type { AgentApproval, AgentRole, AgentStep, ChatMessage, HistoryItem } from "../types";

const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001").replace(/\/+$/, "");
const AGENT_API_URL = `${API_BASE}/api/agent`;
const AGENT_AUTH_URL = `${API_BASE}/api/agent/auth`;
const AGENT_APPROVAL_URL = `${API_BASE}/api/agent/approval`;
const AGENT_HISTORY_URL = `${API_BASE}/api/agent/history`;
const STORAGE_SESSION_KEY = "agent-chat-session-id";

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `agentsess_${crypto.randomUUID()}`;
  }
  return `agentsess_${Date.now()}`;
}

export function useAgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState("");
  const [role, setRole] = useState<AgentRole | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentView, setCurrentView] = useState<"chat" | "history_list" | "history_detail">("chat");
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [historyDetail, setHistoryDetail] = useState<any>(null);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [unlockInput, setUnlockInput] = useState("");
  const actionAuth = useActionAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  const toggleSteps = (msgId: string) => setExpandedSteps((prev) => {
    const next = new Set(prev);
    if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
    return next;
  });

  const authenticate = useCallback(async (preferredSessionId?: string) => {
    const resolvedSessionId = preferredSessionId || sessionId || createSessionId();
    const actionPassword = getStoredActionPassword();
    const res = await fetch(AGENT_AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(actionPassword ? { "x-action-password": actionPassword } : {}),
      },
      body: JSON.stringify({ sessionId: resolvedSessionId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Failed to authenticate agent chat");
    sessionStorage.setItem(STORAGE_SESSION_KEY, data.sessionId);
    setSessionId(data.sessionId);
    setRole(data.role);
  }, [sessionId]);

  useEffect(() => {
    const savedSessionId = sessionStorage.getItem(STORAGE_SESSION_KEY) || createSessionId();
    authenticate(savedSessionId).catch(() => {
      sessionStorage.removeItem(STORAGE_SESSION_KEY);
      setRole(null);
      setSessionId(createSessionId());
    }).finally(() => setAuthLoading(false));
  }, [authenticate]);

    const applyStreamEventToMessage = useCallback(
    (
      messageId: string,
      event:
        | { type: "step"; data: AgentStep }
        | { type: "token"; data: { token: string } }
        | {
            type: "done";
            data: { response: string; processId?: string; status?: string };
          }
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
      const controller = new AbortController();
      streamControllerRef.current = controller;

      const actionPassword = getStoredActionPassword();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (actionPassword) {
        headers["x-action-password"] = actionPassword;
      }

      const res = await fetch(request.url, {
        method: "POST",
        headers,
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
    [readSseStream],
  );

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

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
  }, [executeAgentRequest, input, loading, messages, sessionId]);

  const handleApproval = useCallback(
    async (
      messageId: string,
      approval: AgentApproval,
      decision: "approve" | "reject",
    ) => {
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
        const message =
          error instanceof Error ? error.message : "Network error";
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
    setHistoryLoading(true);
    setCurrentView("history_list");
    setError(null);
    try {
      const res = await fetch(AGENT_HISTORY_URL, {});
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
  }, []);

  const loadHistoryDetail = useCallback(async (item: HistoryItem) => {
    setSelectedHistory(item);
    setHistoryLoading(true);
    setCurrentView("history_detail");
    setError(null);
    try {
      const res = await fetch(`${AGENT_HISTORY_URL}/${item.processId}`, {});
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
  }, []);



  return {
    messages, setMessages, input, setInput, loading, setLoading, error, setError,
    expandedSteps, setExpandedSteps, toggleSteps, sessionId, role, authLoading, setAuthLoading, currentView, setCurrentView,
    historyList, setHistoryList, historyLoading, setHistoryLoading, selectedHistory,
    setSelectedHistory, historyDetail, setHistoryDetail, showUnlockDialog,
    setShowUnlockDialog, unlockInput, setUnlockInput, actionAuth, messagesEndRef,
    inputRef, streamControllerRef, scrollToBottom, authenticate, createSessionId,
    api: { AGENT_API_URL, AGENT_APPROVAL_URL, AGENT_HISTORY_URL, STORAGE_SESSION_KEY },
    applyStreamEventToMessage, readSseStream, executeAgentRequest, sendMessage, handleApproval, stopStreaming, handleKeyDown, clearChat, loadHistory, loadHistoryDetail,
  };
}
