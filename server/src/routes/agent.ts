import { Router, Request, Response, type Router as ExpressRouter } from "express";
import { runAgentLoopStreaming } from "../lib/agent/loop";

const router: ExpressRouter = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { message, history = [], provider } = req.body ?? {};

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const aiProvider =
      typeof provider === "string" && provider.trim().length > 0
        ? provider
        : process.env.AI_PROVIDER || "glm";

    console.log(
      `[Agent] 🤖 Processing: "${message.slice(0, 80)}..." (provider: ${aiProvider})`,
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let fullResponse = "";
    let stepCount = 0;
    let toolCallCount = 0;
    let clientClosed = false;

    req.on("close", () => {
      clientClosed = true;
    });

    const sendEvent = (event: string, data: unknown) => {
      if (clientClosed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const step of runAgentLoopStreaming(message, history, aiProvider)) {
        if (clientClosed) break;

        stepCount++;
        if (step.type === "tool_call") {
          toolCallCount++;
        }

        if (step.type === "response") {
          fullResponse = step.content;
          const words = step.content.split(/(\s+)/);
          for (const word of words) {
            sendEvent("token", { token: word });
          }
        } else {
          sendEvent("step", step);
        }
      }

      if (!clientClosed) {
        sendEvent("done", {
          response: fullResponse,
          steps: stepCount,
          toolCalls: toolCallCount,
        });

        console.log(
          `[Agent] ✅ Completed in ${stepCount} steps (${toolCallCount} tool calls)`,
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Agent] ❌ Stream error:", errorMsg);
      sendEvent("error", { error: errorMsg });
    } finally {
      if (!clientClosed) {
        res.end();
      }
    }
  } catch (err) {
    console.error("[Agent] ❌ Error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
