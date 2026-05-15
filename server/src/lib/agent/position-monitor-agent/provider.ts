import OpenAI from "openai";
import { agentTools } from "../tools";
import {
  getErrorMessage,
  MONITOR_TOOL_NAMES,
  buildAgentProviderChain,
  resolveProviderConfig,
} from "./helpers";

function buildAllowedTools() {
  return agentTools.filter((tool) => {
    const toolName = tool.function?.name;
    return typeof toolName === "string" && MONITOR_TOOL_NAMES.has(toolName);
  });
}

export async function createPositionMonitorChatCompletion(
  messages: OpenAI.ChatCompletionMessageParam[],
) {
  const chain = buildAgentProviderChain();
  let lastError: Error | null = null;

  for (const currentProvider of chain) {
    const config = resolveProviderConfig(currentProvider);
    if (config.apiKeys.length === 0) continue;

    let currentKeyIndex = 0;
    while (currentKeyIndex < config.apiKeys.length) {
      const client = new OpenAI({
        apiKey: config.apiKeys[currentKeyIndex],
        baseURL: config.baseURL,
        ...(config.providerHeaders &&
        Object.keys(config.providerHeaders).length > 0
          ? { defaultHeaders: config.providerHeaders }
          : {}),
      });

      try {
        const completion = await client.chat.completions.create({
          model: config.model,
          messages,
          tools: buildAllowedTools(),
          tool_choice: "auto",
          temperature: 0.2,
          max_tokens: 1800,
        });
        return {
          completion,
          provider: config.selectedProvider,
          model: config.model,
        };
      } catch (error) {
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
            `[PositionMonitor] Provider ${currentProvider} failed (key ${currentKeyIndex + 1}/${config.apiKeys.length}): ${getErrorMessage(error).substring(0, 120)}`,
          );
          break;
        }

        currentKeyIndex += 1;
      }
    }
  }

  throw new Error(
    `All AI providers failed for position monitor agent. Last error: ${lastError?.message || "Unknown error"}`,
  );
}
