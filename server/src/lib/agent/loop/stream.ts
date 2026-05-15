import OpenAI from "openai";
import { agentTools } from "../tools";
import { buildAgentProviderChain, resolveProviderConfig } from "../providers";
import { getErrorMessage, isAbortError, throwIfAborted } from "./helpers";
import type { AgentChatMessage, PendingToolCall } from "../message-helpers";

export async function* streamAssistantResponse(input: {
  messages: AgentChatMessage[];
  provider?: string;
  signal?: AbortSignal;
}): AsyncGenerator<
  | { type: "token"; token: string }
  | {
      type: "complete";
      provider: string;
      model: string;
      content: string;
      toolCalls: PendingToolCall[];
    }
> {
  const chain = buildAgentProviderChain(input.provider);
  let lastError: Error | null = null;

  for (const currentProvider of chain) {
    const config = resolveProviderConfig(currentProvider);
    if (config.apiKeys.length === 0) continue;

    let currentKeyIndex = 0;

    while (currentKeyIndex < config.apiKeys.length) {
      throwIfAborted(input.signal);

      const client = new OpenAI({
        apiKey: config.apiKeys[currentKeyIndex],
        baseURL: config.baseURL,
        ...(config.providerHeaders &&
        Object.keys(config.providerHeaders).length > 0
          ? { defaultHeaders: config.providerHeaders }
          : {}),
      });

      try {
        const stream = await client.chat.completions.create(
          {
            model: config.model,
            messages: input.messages,
            tools: agentTools,
            tool_choice: "auto",
            temperature: 0.3,
            max_tokens: 2048,
            stream: true,
          },
          {
            signal: input.signal,
          },
        );

        let assistantContent = "";
        const toolCalls = new Map<number, PendingToolCall>();

        for await (const chunk of stream) {
          throwIfAborted(input.signal);

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content.length > 0) {
            assistantContent += delta.content;
            yield {
              type: "token",
              token: delta.content,
            };
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index ?? 0;
              const existing = toolCalls.get(index) || {
                id: "",
                name: "",
                arguments: "",
              };

              if (toolCallDelta.id) {
                existing.id = toolCallDelta.id;
              }

              if (toolCallDelta.function?.name) {
                existing.name += toolCallDelta.function.name;
              }

              if (toolCallDelta.function?.arguments) {
                existing.arguments += toolCallDelta.function.arguments;
              }

              toolCalls.set(index, existing);
            }
          }
        }

        yield {
          type: "complete",
          provider: config.selectedProvider,
          model: config.model,
          content: assistantContent,
          toolCalls: Array.from(toolCalls.entries())
            .sort(([left], [right]) => left - right)
            .map(([, value]) => value),
        };
        return;
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        lastError = error as Error;
        const message = getErrorMessage(error).toLowerCase();
        const retryable =
          message.includes("401") ||
          message.includes("403") ||
          message.includes("429") ||
          message.includes("token expired") ||
          message.includes("invalid") ||
          message.includes("balance") ||
          message.includes("rate limit");

        if (!retryable || currentKeyIndex === config.apiKeys.length - 1) {
          console.warn(
            `[AgentLoop] Provider ${currentProvider} failed (key ${currentKeyIndex + 1}/${config.apiKeys.length}): ${getErrorMessage(error).substring(0, 120)}`,
          );
          break;
        }

        currentKeyIndex += 1;
      }
    }
  }

  throw new Error(
    `All AI providers failed for agent loop. Last error: ${lastError?.message || "Unknown error"}`,
  );
}
