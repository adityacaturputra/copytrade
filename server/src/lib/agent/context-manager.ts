import OpenAI from "openai";
import { getAIProviderConfig, normalizeAIProvider } from "@copytrade/shared/lib/ai/core/provider-registry";

// ─── Types ─────────────────────────────────────────────────────────────────────

type AgentChatMessage = OpenAI.ChatCompletionMessageParam;

type ConversationHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

// ─── Per-Provider Context Limits ───────────────────────────────────────────────

export interface ContextLimits {
  /** Hard cap for total context tokens sent to the model */
  maxContextTokens: number;
  /** When estimated tokens exceed this, trigger summarization */
  compactionThreshold: number;
  /** Max tokens allowed per individual tool result */
  maxToolResultTokens: number;
  /** Token budget allocated for conversation history */
  historyBudgetTokens: number;
  /** Max tokens the model is allowed to output */
  maxOutputTokens: number;
}

const PROVIDER_CONTEXT_LIMITS: Record<string, ContextLimits> = {
  glm: {
    maxContextTokens: 40_000,
    compactionThreshold: 32_000,
    maxToolResultTokens: 2_000,
    historyBudgetTokens: 6_000,
    maxOutputTokens: 2_048,
  },
  kimi: {
    maxContextTokens: 60_000,
    compactionThreshold: 48_000,
    maxToolResultTokens: 3_000,
    historyBudgetTokens: 8_000,
    maxOutputTokens: 2_048,
  },
  openai: {
    maxContextTokens: 50_000,
    compactionThreshold: 40_000,
    maxToolResultTokens: 2_500,
    historyBudgetTokens: 8_000,
    maxOutputTokens: 2_048,
  },
  codex: {
    maxContextTokens: 80_000,
    compactionThreshold: 64_000,
    maxToolResultTokens: 4_000,
    historyBudgetTokens: 12_000,
    maxOutputTokens: 2_048,
  },
  patungin: {
    maxContextTokens: 80_000,
    compactionThreshold: 64_000,
    maxToolResultTokens: 4_000,
    historyBudgetTokens: 12_000,
    maxOutputTokens: 2_048,
  },
};

const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxContextTokens: 30_000,
  compactionThreshold: 24_000,
  maxToolResultTokens: 1_500,
  historyBudgetTokens: 4_000,
  maxOutputTokens: 2_048,
};

/**
 * Get context limits for a given provider name.
 */
export function getContextLimits(provider: string): ContextLimits {
  const key = provider.toLowerCase().trim();
  return PROVIDER_CONTEXT_LIMITS[key] || DEFAULT_CONTEXT_LIMITS;
}

// ─── Token Estimation ──────────────────────────────────────────────────────────

/**
 * Heuristic token estimate: ~1 token per 3.5 characters.
 * Not exact, but fast and sufficient for budget decisions.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * Estimate total tokens for an array of chat messages.
 * Accounts for role overhead (~4 tokens per message).
 */
export function estimateMessagesTokens(messages: AgentChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    // ~4 tokens overhead per message (role, separators)
    total += 4;

    if (typeof message.content === "string") {
      total += estimateTokens(message.content);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if ("text" in part && typeof part.text === "string") {
          total += estimateTokens(part.text);
        }
      }
    }

    // Tool call messages have function name + arguments
    const msg = message as unknown as Record<string, unknown>;
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        const fn = tc.function as Record<string, unknown> | undefined;
        if (fn) {
          total += estimateTokens(String(fn.name || ""));
          total += estimateTokens(String(fn.arguments || ""));
        }
      }
    }
  }
  return total;
}

// ─── Tool Output Pruning ───────────────────────────────────────────────────────

/**
 * Truncate a tool result string if it exceeds the given token budget.
 * Appends a `[TRUNCATED]` marker so the model knows data was cut.
 */
export function pruneToolResult(result: string, maxTokens: number): string {
  const currentTokens = estimateTokens(result);
  if (currentTokens <= maxTokens) {
    return result;
  }

  // Convert token budget to approximate character limit
  const charLimit = Math.floor(maxTokens * 3.5);
  const truncated = result.slice(0, charLimit);

  return `${truncated}\n\n...[TRUNCATED — original ~${currentTokens} tokens, showing first ~${maxTokens} tokens]`;
}

// ─── History Trimming ──────────────────────────────────────────────────────────

/**
 * Take conversation history messages from the end (most recent first)
 * until the token budget is exhausted.
 * This replaces the old hard `slice(-20)` approach.
 */
export function trimHistoryToTokenBudget(
  history: ConversationHistoryMessage[],
  budgetTokens: number,
): ConversationHistoryMessage[] {
  if (!history || history.length === 0) return [];

  const result: ConversationHistoryMessage[] = [];
  let usedTokens = 0;

  // Walk from the end (most recent) backwards
  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(history[i].content) + 4;
    if (usedTokens + msgTokens > budgetTokens) break;
    usedTokens += msgTokens;
    result.unshift(history[i]);
  }

  return result;
}

// ─── Compaction Check ──────────────────────────────────────────────────────────

/**
 * Check if the current messages array has exceeded the compaction threshold.
 */
export function shouldCompact(
  messages: AgentChatMessage[],
  provider: string,
): boolean {
  const limits = getContextLimits(provider);
  const currentTokens = estimateMessagesTokens(messages);
  return currentTokens > limits.compactionThreshold;
}

// ─── Auto-Compact via LLM Summarization ────────────────────────────────────────

const SUMMARIZATION_PROMPT = `You are a context compaction assistant. Summarize the following agent conversation into a compact, information-dense paragraph.

PRESERVE:
- Key decisions made and their reasoning
- Important tool results that affect future actions (e.g. position states, account balances, order IDs)
- The user's original intent and any pending actions
- Any errors or warnings that are still relevant

DISCARD:
- Verbose tool output data that has already been acted upon
- Repeated information
- Intermediate reasoning steps
- Raw JSON that has been summarized

Output ONLY the summary paragraph, nothing else.`;

/** Minimum number of recent messages to keep verbatim (not summarized). */
const MIN_RECENT_MESSAGES = 4;

/**
 * Compact the messages array by summarizing older messages via the same LLM
 * provider. Keeps the system prompt and the most recent messages intact.
 *
 * Flow:
 * 1. Split into [systemPrompt, ...older, ...recent]
 * 2. Summarize `older` via LLM call
 * 3. Return [systemPrompt, summaryMessage, ...recent]
 */
export async function compactMessages(
  messages: AgentChatMessage[],
  provider: string,
  signal?: AbortSignal,
): Promise<AgentChatMessage[]> {
  if (messages.length <= MIN_RECENT_MESSAGES + 1) {
    // Not enough messages to compact
    return messages;
  }

  const systemPrompt = messages[0]; // Always the system prompt
  const rest = messages.slice(1);

  // Keep the last MIN_RECENT_MESSAGES verbatim
  const recentMessages = rest.slice(-MIN_RECENT_MESSAGES);
  const olderMessages = rest.slice(0, -MIN_RECENT_MESSAGES);

  if (olderMessages.length === 0) {
    return messages;
  }

  // Build a text representation of older messages for the summarizer
  const olderText = olderMessages
    .map((msg) => {
      const role = (msg as unknown as Record<string, unknown>).role || "unknown";
      let content = "";

      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((part) => ("text" in part ? part.text : "[non-text]"))
          .join("\n");
      }

      // For tool results, include tool_call_id context
      const toolCallId = (msg as unknown as Record<string, unknown>).tool_call_id;
      if (toolCallId) {
        return `[tool_result for ${toolCallId}]: ${content}`;
      }

      // For assistant messages with tool_calls
      const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
        | Array<Record<string, unknown>>
        | undefined;
      if (toolCalls && toolCalls.length > 0) {
        const callSummaries = toolCalls.map((tc) => {
          const fn = tc.function as Record<string, unknown>;
          return `${fn?.name || "unknown"}(${String(fn?.arguments || "{}").slice(0, 200)})`;
        });
        return `[${role}]: ${content}\n  Tool calls: ${callSummaries.join(", ")}`;
      }

      return `[${role}]: ${content}`;
    })
    .join("\n\n");

  // Truncate the older text itself if it's absurdly long
  const maxSummarizerInput = 8000; // ~28k chars
  const truncatedOlderText =
    olderText.length > maxSummarizerInput * 3.5
      ? olderText.slice(0, Math.floor(maxSummarizerInput * 3.5)) +
        "\n...[OLDER CONTEXT TRUNCATED FOR SUMMARIZATION]"
      : olderText;

  try {
    const summary = await callSummarizer(
      truncatedOlderText,
      provider,
      signal,
    );

    const summaryMessage: AgentChatMessage = {
      role: "user",
      content: `[CONTEXT SUMMARY — earlier conversation was compacted to save context space]\n\n${summary}\n\n[END OF CONTEXT SUMMARY — conversation continues below]`,
    };

    return [systemPrompt, summaryMessage, ...recentMessages];
  } catch (error) {
    // If summarization fails, fall back to simple truncation:
    // keep system prompt + recent messages only
    console.warn(
      "Context compaction summarization failed, falling back to truncation:",
      error instanceof Error ? error.message : String(error),
    );
    return [systemPrompt, ...recentMessages];
  }
}

// ─── Internal: Call LLM for Summarization ──────────────────────────────────────

async function callSummarizer(
  conversationText: string,
  provider: string,
  signal?: AbortSignal,
): Promise<string> {
  const config = resolveProviderForSummarizer(provider);

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    ...(config.headers && Object.keys(config.headers).length > 0
      ? { defaultHeaders: config.headers }
      : {}),
  });

  const response = await client.chat.completions.create(
    {
      model: config.model,
      messages: [
        { role: "system", content: SUMMARIZATION_PROMPT },
        { role: "user", content: conversationText },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    },
    { signal },
  );

  return (
    response.choices[0]?.message?.content?.trim() ||
    "No summary could be generated."
  );
}

function resolveProviderForSummarizer(provider: string): {
  apiKey: string;
  baseURL: string;
  model: string;
  headers?: Record<string, string>;
} {
  const config = getAIProviderConfig(normalizeAIProvider(provider));
  return {
    apiKey: config.getApiKeys()[0] || "",
    baseURL: config.getBaseURL() || "",
    model: config.getModel(),
    headers: config.getHeaders?.(),
  };
}
