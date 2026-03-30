/**
 * Agent Chat API — handles agentic AI conversations.
 *
 * POST /api/agent
 *   Body: { message: string, history: Array<{role, content}>, provider?: string }
 *   Response: { response: string, steps: AgentStep[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { runAgentFull } from "@/lib/agent/loop";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history = [], provider } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    // Use the configured AI provider or default
    const aiProvider = provider || process.env.AI_PROVIDER || "openai";

    console.log(
      `[Agent] 🤖 Processing: "${message.slice(0, 80)}..." (provider: ${aiProvider})`,
    );

    const { response, steps } = await runAgentFull(
      message,
      history,
      aiProvider,
    );

    console.log(
      `[Agent] ✅ Completed in ${steps.length} steps (${steps.filter((s) => s.type === "tool_call").length} tool calls)`,
    );

    return NextResponse.json({
      success: true,
      response,
      steps,
    });
  } catch (err) {
    console.error("[Agent] ❌ Error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
