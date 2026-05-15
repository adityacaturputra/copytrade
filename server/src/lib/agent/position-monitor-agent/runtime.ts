import OpenAI from "openai";
import {
  AgentTurn,
  type IPosition,
} from "@copytrade/shared/lib/database/index";
import { logProcessStep } from "@copytrade/shared/lib/process/log";
import { ensurePersistedProcessId } from "@copytrade/shared/lib/process/id";
import { agentTools, toolImplementations } from "../tools";
import { getAgentToolPolicy } from "../policies";
import {
  buildPositionMonitorSystemPrompt,
  buildPositionMonitorUserPrompt,
  extractImageUrlsFromToolResult,
  getErrorMessage,
} from "./helpers";
import { createPositionMonitorChatCompletion } from "./provider";

const MAX_AGENT_ITERATIONS = 10;
const VISION_CAPABLE_PROVIDERS = new Set([
  "openai",
  "kimi",
  "codex",
  "patungin",
  "konektika",
  "glm",
]);

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type InternalToolTrace = {
  toolName: string;
  toolArgs: Record<string, unknown>;
  mode: "read" | "mutating";
  status: "executed" | "failed" | "invalid_args" | "unknown_tool" | "denied";
  result?: string;
  error?: string;
};

export type InternalAgentResult = {
  response: string;
  toolTraces: InternalToolTrace[];
  iterations: number;
  provider: string;
  model: string;
};

function parseToolArgs(input: string): Record<string, unknown> {
  if (!input || input.trim().length === 0) return {};
  const parsed = JSON.parse(input);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

async function runInternalPositionAgent(input: {
  systemPrompt: string;
  userPrompt: string;
  visionImagesEnabled?: boolean;
}): Promise<InternalAgentResult> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: input.systemPrompt },
    { role: "user", content: input.userPrompt },
  ];
  const toolTraces: InternalToolTrace[] = [];
  let finalResponse = "";
  let usedProvider = "";
  let usedModel = "";

  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    const { completion, provider, model } =
      await createPositionMonitorChatCompletion(messages);
    usedProvider = provider;
    usedModel = model;

    const assistantMessage = completion.choices[0]?.message;
    if (!assistantMessage) throw new Error("No assistant message returned by the model.");

    messages.push({
      role: "assistant",
      content: assistantMessage.content || "",
      tool_calls: assistantMessage.tool_calls,
    } as OpenAI.ChatCompletionAssistantMessageParam);

    const toolCalls = (assistantMessage.tool_calls || [])
      .filter((toolCall) => toolCall.type === "function")
      .map((toolCall): PendingToolCall => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      }));

    if (toolCalls.length === 0) {
      finalResponse =
        typeof assistantMessage.content === "string"
          ? assistantMessage.content
          : finalResponse;
      return {
        response: finalResponse,
        toolTraces,
        iterations: iteration + 1,
        provider: usedProvider,
        model: usedModel,
      };
    }

    for (const toolCall of toolCalls) {
      const policy = getAgentToolPolicy(toolCall.name);
      let toolArgs: Record<string, unknown> = {};

      try {
        toolArgs = parseToolArgs(toolCall.arguments);
      } catch (error) {
        const errorResult = JSON.stringify({
          error: `Invalid tool arguments for ${toolCall.name}: ${getErrorMessage(error)}`,
        });
        toolTraces.push({ toolName: toolCall.name, toolArgs: {}, mode: policy?.mode || "read", status: "invalid_args", error: errorResult });
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: errorResult });
        continue;
      }

      if (!policy) {
        const errorResult = JSON.stringify({ error: `No policy configured for tool ${toolCall.name}` });
        toolTraces.push({ toolName: toolCall.name, toolArgs, mode: "read", status: "denied", error: errorResult });
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: errorResult });
        continue;
      }

      const executor = toolImplementations[toolCall.name];
      if (!executor) {
        const errorResult = JSON.stringify({ error: `Unknown tool ${toolCall.name}` });
        toolTraces.push({ toolName: toolCall.name, toolArgs, mode: policy.mode, status: "unknown_tool", error: errorResult });
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: errorResult });
        continue;
      }

      try {
        const result = await executor(toolArgs);
        toolTraces.push({ toolName: toolCall.name, toolArgs, mode: policy.mode, status: "executed", result });
        console.log(`[PositionMonitor]   🔧 ${policy.mode === "mutating" ? "✏️" : "👁️"} ${toolCall.name}(${JSON.stringify(toolArgs).slice(0, 120)}) → ${policy.mode} OK`);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });

        const imageUrls = extractImageUrlsFromToolResult(toolCall.name, result);
        if (imageUrls.length > 0 && input.visionImagesEnabled && VISION_CAPABLE_PROVIDERS.has(usedProvider)) {
          console.log(`[PositionMonitor]   🖼️ Injecting ${imageUrls.length} image(s) from Discord for vision analysis`);
          messages.push({
            role: "user",
            content: [
              {
                type: "text",
                text: "[System] Here are the chart images from the Discord signal thread for your visual analysis. Use them to assess the trade setup quality and current market context:",
              },
              ...imageUrls.map(
                (url): OpenAI.ChatCompletionContentPartImage => ({
                  type: "image_url",
                  image_url: { url, detail: "low" },
                }),
              ),
            ],
          });
        }
      } catch (error) {
        const errorResult = JSON.stringify({ error: getErrorMessage(error) });
        toolTraces.push({ toolName: toolCall.name, toolArgs, mode: policy.mode, status: "failed", error: errorResult });
        console.log(`[PositionMonitor]   ❌ ${toolCall.name}(${JSON.stringify(toolArgs).slice(0, 120)}) → ${getErrorMessage(error)}`);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: errorResult });
      }
    }
  }

  return {
    response:
      finalResponse ||
      '{"status":"max_iterations","decisionSummary":"Reached maximum monitoring reasoning steps","actionsTaken":[],"followUp":["Review the position manually if repeated loops occur."]}',
    toolTraces,
    iterations: MAX_AGENT_ITERATIONS,
    provider: usedProvider,
    model: usedModel,
  };
}

export async function runPositionAgentForDoc(
  position: IPosition,
  visionImagesEnabled: boolean,
) {
  const processId = await ensurePersistedProcessId(position, "posagent");
  const userPrompt = buildPositionMonitorUserPrompt(position, processId);

  console.log(
    `[PositionMonitor] 🤖 Running agent for ${position.symbol} ${position.side} (entry=${position.entryPrice}, qty=${position.quantity}, SL=${position.stopLossPrice || "none"}, accountId=${position.accountId || "none"})`,
  );

  await logProcessStep({
    accountId: position.accountId,
    processId,
    type: "monitor",
    action: "position_monitor_agent_started",
    symbol: position.symbol,
    details: {
      positionId: String(position._id),
      currentTime: new Date().toISOString(),
      accountId: position.accountId || null,
    },
    result: "processing",
  });

  const agentResult = await runInternalPositionAgent({
    systemPrompt: buildPositionMonitorSystemPrompt(),
    userPrompt,
    visionImagesEnabled,
  });

  try {
    await AgentTurn.create({
      sessionId: "position-monitor-session",
      processId,
      role: "admin",
      provider: agentResult.provider,
      status: "completed",
      userMessage: userPrompt,
      assistantResponse: agentResult.response,
      history: [],
      messages: [],
      pendingToolCalls: [],
      toolTraces: agentResult.toolTraces,
      startedAt: new Date(),
      completedAt: new Date(),
    });
  } catch {}

  await logProcessStep({
    accountId: position.accountId,
    processId,
    type: "monitor",
    action: "position_monitor_agent_completed",
    symbol: position.symbol,
    details: {
      response: agentResult.response,
      toolTraces: agentResult.toolTraces,
      iterations: agentResult.iterations,
      provider: agentResult.provider,
      model: agentResult.model,
    },
    result: "success",
  });

  return agentResult;
}
