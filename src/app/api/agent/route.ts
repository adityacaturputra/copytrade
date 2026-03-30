/**
 * Agent Chat API — streaming SSE version.
 *
 * POST /api/agent
 *   Body: { message: string, history: Array<{role, content}>, provider?: string }
 *   Response: Server-Sent Events stream with real-time steps
 *
 * Events:
 *   event: step        → { type, content, toolName?, toolArgs?, duration? }
 *   event: token       → { token: string }  (word-by-word AI response)
 *   event: done        → { response: string }
 *   event: error       → { error: string }
 */

import { NextRequest } from "next/server";
import { runAgentLoopStreaming } from "@/lib/agent/loop";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for long agentic runs

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [], provider } = body;

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const aiProvider = provider || process.env.AI_PROVIDER || "glm";

    console.log(
      `[Agent] 🤖 Processing: "${message.slice(0, 80)}..." (provider: ${aiProvider})`,
    );

    // Create a ReadableStream that yields SSE events
    const encoder = new TextEncoder();
    let fullResponse = "";
    let stepCount = 0;
    let toolCallCount = 0;

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        };

        try {
          for await (const step of runAgentLoopStreaming(
            message,
            history,
            aiProvider,
          )) {
            stepCount++;

            if (step.type === "tool_call") {
              toolCallCount++;
            }

            if (step.type === "response") {
              // Don't send the response as a step event —
              // only stream it as tokens to avoid duplication in the UI
              fullResponse = step.content;

              // Stream the response word by word
              const words = step.content.split(/(\s+)/);
              for (const word of words) {
                sendEvent("token", { token: word });
              }
            } else {
              // Tool calls and results — send as step events
              sendEvent("step", step);
            }
          }

          sendEvent("done", {
            response: fullResponse,
            steps: stepCount,
            toolCalls: toolCallCount,
          });

          console.log(
            `[Agent] ✅ Completed in ${stepCount} steps (${toolCallCount} tool calls)`,
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          console.error("[Agent] ❌ Stream error:", errorMsg);
          sendEvent("error", { error: errorMsg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      },
    });
  } catch (err) {
    console.error("[Agent] ❌ Error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
