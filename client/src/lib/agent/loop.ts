/**
 * Agentic Loop — the core "agentic" AI loop.
 *
 * Flow:
 *   1. User sends a message
 *   2. AI receives message + system prompt + tools
 *   3. AI decides: call a tool OR respond directly
 *   4. If tool call → execute tool → add result to context → loop back to step 2
 *   5. If direct response → return to user
 *
 * This is the "ReAct" pattern (Reasoning + Acting) that enables
 * the AI to autonomously gather data, make decisions, and take actions.
 */

import OpenAI from "openai";
import { agentTools, toolImplementations } from "./tools";
import { getCodexPatunginConfig } from "@copytrade/shared/lib/ai/CodexPatunginConfig";

const MAX_ITERATIONS = 12; // Safety limit to prevent infinite loops

const SYSTEM_PROMPT = `You are an intelligent trading assistant for a crypto copy-trading system. You have access to tools that let you:

📊 **Account & Market**: Check balances, get prices, view positions, get kline/candlestick data
📈 **Trading**: Place orders (market/limit), close positions, set leverage, set TP/SL
🔧 **Order Management**: Get/cancel open orders, get/cancel algo orders (TP/SL), modify TP/SL, view order history
📝 **Drafts**: Review, accept, or reject pending signal drafts
💬 **Discord**: Check Discord sources, trigger manual signal checks
🗄️ **Database**: View logs, signal history, position history
⚙️ **Settings**: Get/set trading mode, risk settings, calculate risk

**CRITICAL — Exact Enum Values for Tool Parameters:**
- Order side: MUST be exactly "BUY" or "SELL" (NOT "LONG" or "SHORT"). "BUY" opens long / closes short. "SELL" opens short / closes long.
- Order type: MUST be exactly "MARKET" or "LIMIT"
- Trading mode: MUST be exactly "auto" or "manual"
- When closing a position: use the OPPOSITE side (SELL for LONG positions, BUY for SHORT positions)

**Guidelines:**
- Always gather context FIRST before making trading decisions (check positions, account balance, current price)
- Be helpful and explain what you're doing step by step
- When showing data, format it in a human-readable way (tables, summaries)
- For risky operations (placing orders, closing positions), confirm with the user what you're about to do
- Use multiple tools in sequence when needed — that's what makes you "agentic"!
- If a tool returns an error, explain it clearly and suggest next steps
- Always show prices with appropriate decimal places (round to 2 decimals, e.g., 62333.34 not 62333.333333)
- For positions, highlight PnL with + or - prefix and color context
- When calculating or suggesting SL/TP prices, ALWAYS round to 2 decimal places (e.g., use 62333.34 not 62333.333333333336)

**Modifying TP/SL:** To change take-profit or stop-loss for a position:
  1. Call get_exchange_positions to get the current position (side, quantity)
  2. Call get_algo_orders to see existing TP/SL orders
  3. Call modify_take_profit or modify_stop_loss with the new price (this auto-cancels old orders)

**Managing Open Orders:** To cancel or check pending orders:
  1. Call get_open_orders to see all unfilled orders
  2. Call cancel_order to cancel a specific order, or cancel_all_orders to cancel everything

**Example flows:**
- "What's my portfolio?" → get_account_info → get_open_positions → get_algo_orders → summarize
- "Check BTC price and my BTC position" → get_ticker_price → get_exchange_positions → analyze
- "Move my BTC stop loss to 62000" → get_exchange_positions → modify_stop_loss → confirm
- "Update BTC take profit to 72000" → get_exchange_positions → modify_take_profit → confirm
- "Show my open orders" → get_open_orders → format as table
- "Cancel all pending orders" → cancel_all_orders → confirm
- "Show my trade history" → get_order_history → summarize
- "Get BTC 4h chart data" → get_klines(BTC-USDT-SWAP, 4h) → analyze trends
- "Accept all pending drafts" → get_pending_drafts → accept_draft (for each) → confirm
- "Close all positions and switch to manual mode" → close_all_positions → set_trading_mode → confirm
- "Calculate risk for LONG BTC at 65000 with SL at 62000" → calculate_risk_preview → explain

The current exchange is determined by the EXCHANGE_PROVIDER env variable. Symbols must be in exchange format (e.g., BTC-USDT-SWAP for OKX, BTCUSDT for MEXC).`;

export interface AgentMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

export interface AgentStep {
  type: "thinking" | "tool_call" | "tool_result" | "response";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  duration?: number;
}

/**
 * Run the agentic loop.
 *
 * Returns an async generator that yields each step (tool calls, results, thinking)
 * so the UI can show real-time progress.
 */
export async function* runAgentLoop(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  provider?: string,
): AsyncGenerator<AgentStep> {
  const codexPatunginCfg = getCodexPatunginConfig();
  const selectedProvider = (
    provider ||
    process.env.AI_PROVIDER ||
    (codexPatunginCfg.apiKey ? "patungin" : "glm")
  )
    .toLowerCase()
    .trim();

  // Determine which OpenAI-compatible API to use
  const rawApiKey =
    selectedProvider === "kimi"
      ? process.env.ANTHROPIC_API_KEY
      : selectedProvider === "openai"
        ? process.env.OPENAI_API_KEY
        : selectedProvider === "codex" || selectedProvider === "patungin"
          ? codexPatunginCfg.apiKey
          : process.env.GLM_API_KEY;

  const baseURL =
    selectedProvider === "kimi"
      ? process.env.ANTHROPIC_BASE_URL || "https://api.kimi.com/coding/"
      : selectedProvider === "openai"
        ? process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
        : selectedProvider === "codex" || selectedProvider === "patungin"
          ? codexPatunginCfg.baseURL
          : process.env.GLM_BASE_URL || "https://api.z.ai/api/coding/paas/v4";

  const model =
    selectedProvider === "kimi"
      ? process.env.ANTHROPIC_MODEL || "kimi-latest"
      : selectedProvider === "openai"
        ? process.env.OPENAI_MODEL || "gpt-4o-mini"
        : selectedProvider === "codex" || selectedProvider === "patungin"
          ? codexPatunginCfg.model
          : process.env.GLM_MODEL || "glm-4-flash";

  if (!rawApiKey) {
    yield {
      type: "response",
      content:
        "⚠️ No API key configured for the selected AI provider. Please set up your API keys in the .env file.",
    };
    return;
  }

  // Support comma-separated API keys with rotation (same pattern as GLMAnalyzer)
  const apiKeys = rawApiKey
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (apiKeys.length === 0) {
    yield {
      type: "response",
      content: "⚠️ No valid API keys found.",
    };
    return;
  }

  // Build conversation messages
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    // Add history (last 20 messages to keep context manageable)
    ...history.slice(-20).map(
      (m): OpenAI.ChatCompletionMessageParam => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }),
    ),
    { role: "user", content: userMessage },
  ];

  // Pick a random key to distribute load
  const shuffledKeys = [...apiKeys].sort(() => Math.random() - 0.5);
  let client = new OpenAI({ apiKey: shuffledKeys[0], baseURL });
  let currentKeyIndex = 0;
  const tryNextKey = (): boolean => {
    currentKeyIndex++;
    if (currentKeyIndex < shuffledKeys.length) {
      client = new OpenAI({ apiKey: shuffledKeys[currentKeyIndex], baseURL });
      console.log(
        `[Agent] 🔄 Trying key ${shuffledKeys[currentKeyIndex].substring(0, 8)}...`,
      );
      return true;
    }
    return false;
  };

  // Agentic loop
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const startTime = Date.now();

    let response: OpenAI.ChatCompletion | null = null;
    let apiError: string | null = null;

    // Try with current key, fallback to next on auth errors
    for (let keyAttempt = 0; keyAttempt < shuffledKeys.length; keyAttempt++) {
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          tools: agentTools,
          tool_choice: "auto",
          temperature: 0.3,
          max_tokens: 2048,
        });
        apiError = null;
        break;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[Agent] ⚠️ API error with key ${shuffledKeys[currentKeyIndex].substring(0, 8)}...: ${errMsg}`,
        );

        // If auth error (401/403) or rate limit, try next key
        if (
          errMsg.includes("401") ||
          errMsg.includes("403") ||
          errMsg.includes("429") ||
          errMsg.includes("token expired") ||
          errMsg.includes("invalid") ||
          errMsg.includes("balance")
        ) {
          if (!tryNextKey()) {
            apiError = errMsg;
            break;
          }
          // Decrement i so this iteration retries with the new key
          continue;
        }

        // Non-retryable error
        apiError = errMsg;
        break;
      }
    }

    if (apiError || !response) {
      yield {
        type: "response",
        content: `❌ AI API error: ${apiError || "No response"}. All ${shuffledKeys.length} key(s) tried.`,
      };
      return;
    }

    const choice = response.choices[0];
    if (!choice?.message) {
      yield {
        type: "response",
        content: "❌ No response from AI.",
      };
      return;
    }

    const msg = choice.message;

    // If the AI wants to call tools
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Add assistant message with tool calls to conversation
      messages.push(msg);

      for (const toolCall of msg.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        // Yield the tool call step for UI
        yield {
          type: "tool_call",
          content: `Calling ${toolName}...`,
          toolName,
          toolArgs,
          duration: Date.now() - startTime,
        };

        // Execute the tool
        const executor = toolImplementations[toolName];
        if (!executor) {
          const errorResult = JSON.stringify({
            error: `Unknown tool: ${toolName}`,
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: errorResult,
          });
          yield {
            type: "tool_result",
            content: errorResult,
            toolName,
          };
          continue;
        }

        try {
          const result = await executor(toolArgs);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
          yield {
            type: "tool_result",
            content: result,
            toolName,
            duration: Date.now() - startTime,
          };
        } catch (err) {
          const errorResult = JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: errorResult,
          });
          yield {
            type: "tool_result",
            content: errorResult,
            toolName,
            duration: Date.now() - startTime,
          };
        }
      }

      // Continue the loop — AI will see tool results and decide next step
      continue;
    }

    // AI gave a direct response — we're done
    yield {
      type: "response",
      content: msg.content || "No response.",
      duration: Date.now() - startTime,
    };
    return;
  }

  // Safety: if we hit max iterations
  yield {
    type: "response",
    content:
      "⚠️ Reached maximum number of reasoning steps. Please continue the conversation for more.",
  };
}

/**
 * Streaming alias — same as runAgentLoop but with a clearer name for the SSE route.
 */
export const runAgentLoopStreaming = runAgentLoop;

/**
 * Non-streaming version: runs the loop and returns the final response
 * along with all intermediate steps.
 */
export async function runAgentFull(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  provider?: string,
): Promise<{ response: string; steps: AgentStep[] }> {
  const steps: AgentStep[] = [];
  let finalResponse = "";

  for await (const step of runAgentLoop(userMessage, history, provider)) {
    steps.push(step);
    if (step.type === "response") {
      finalResponse = step.content;
    }
  }

  return { response: finalResponse, steps };
}
