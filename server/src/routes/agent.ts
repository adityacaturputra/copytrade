import { Router, Request, Response, type Router as ExpressRouter } from "express";
import {
  authenticateAgentRequest,
  isAgentAuthConfigured,
  resolveAgentRoleFromPassword,
} from "../lib/agent/auth";
import {
  createAgentSessionId,
  ensureAgentSession,
} from "../lib/agent/logging";
import { runAgentLoopStreaming } from "../lib/agent/loop";
import { AgentTurn } from "@copytrade/shared/lib/database";

const router: ExpressRouter = Router();

function getRequestIp(req: Request): string | undefined {
  const forwardedFor = req.header("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  return req.ip || undefined;
}

function ensureAgentAuthConfigured(res: Response): boolean {
  if (isAgentAuthConfigured()) {
    return true;
  }

  res.status(503).json({
    error:
      "Agent auth is not configured. Set AGENT_VIEWER_PASSWORD, AGENT_OPERATOR_PASSWORD, and/or AGENT_ADMIN_PASSWORD in .env.",
  });
  return false;
}

function sendSseEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamAgentResponse(
  req: Request,
  res: Response,
  input: Parameters<typeof runAgentLoopStreaming>[0],
) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  sendSseEvent(res, "status", { status: "connected" });

  const controller = new AbortController();
  let clientDisconnected = false;

  req.on("aborted", () => {
    clientDisconnected = true;
    controller.abort();
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      controller.abort();
    }
  });

  let stepCount = 0;
  let toolCallCount = 0;
  let latestResponse = "";

  try {
    for await (const event of runAgentLoopStreaming({
      ...input,
      signal: controller.signal,
      userAgent: req.header("user-agent") || undefined,
      ipAddress: getRequestIp(req),
    })) {
      if (clientDisconnected) {
        break;
      }

      if (event.type === "token") {
        latestResponse += event.token;
        sendSseEvent(res, "token", { token: event.token });
        continue;
      }

      if (event.type === "step") {
        stepCount += 1;
        if (event.step.type === "tool_call") {
          toolCallCount += 1;
        }
        sendSseEvent(res, "step", event.step);
        continue;
      }

      if (event.type === "approval_required") {
        sendSseEvent(res, "approval_required", event.approval);
        sendSseEvent(res, "done", {
          response: latestResponse,
          sessionId: event.approval.sessionId,
          processId: event.approval.processId,
          status: "awaiting_approval",
          steps: stepCount,
          toolCalls: toolCallCount,
        });
        return;
      }

      if (event.type === "done") {
        latestResponse = event.response;
        sendSseEvent(res, "done", event);
        return;
      }

      if (event.type === "error") {
        sendSseEvent(res, "error", event);
        return;
      }
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

router.post("/auth", async (req: Request, res: Response) => {
  if (!ensureAgentAuthConfigured(res)) {
    return;
  }

  const password =
    typeof req.body?.password === "string" ? req.body.password : undefined;
  const role = resolveAgentRoleFromPassword(password);
  if (!role) {
    res.status(401).json({ error: "Invalid agent password" });
    return;
  }

  const requestedSessionId =
    typeof req.body?.sessionId === "string" && req.body.sessionId.trim().length > 0
      ? req.body.sessionId.trim()
      : createAgentSessionId();

  await ensureAgentSession({
    sessionId: requestedSessionId,
    role,
    userAgent: req.header("user-agent") || undefined,
    ipAddress: getRequestIp(req),
  });

  res.json({
    success: true,
    role,
    sessionId: requestedSessionId,
  });
});

router.post("/", async (req: Request, res: Response) => {
  if (!ensureAgentAuthConfigured(res)) {
    return;
  }

  const auth = authenticateAgentRequest(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized agent request" });
    return;
  }

  const { message, history = [], provider, sessionId } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  await streamAgentResponse(req, res, {
    sessionId,
    role: auth.role,
    provider: typeof provider === "string" ? provider : undefined,
    history: Array.isArray(history) ? history : [],
    userMessage: message,
  });
});

router.post("/approval", async (req: Request, res: Response) => {
  if (!ensureAgentAuthConfigured(res)) {
    return;
  }

  const auth = authenticateAgentRequest(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized agent request" });
    return;
  }

  const { sessionId, processId, decision } = req.body ?? {};
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  if (!processId || typeof processId !== "string") {
    res.status(400).json({ error: "processId is required" });
    return;
  }

  if (decision !== "approve" && decision !== "reject") {
    res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    return;
  }

  await streamAgentResponse(req, res, {
    sessionId,
    role: auth.role,
    processId,
    decision,
  });
});

router.get("/history", async (req: Request, res: Response) => {
  if (!ensureAgentAuthConfigured(res)) {
    return;
  }

  const auth = authenticateAgentRequest(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized agent request" });
    return;
  }

  try {
    const turns = await AgentTurn.find()
      .select({
        _id: 1,
        processId: 1,
        sessionId: 1,
        role: 1,
        status: 1,
        userMessage: 1,
        assistantResponse: 1,
        createdAt: 1,
        "toolTraces.toolName": 1,
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();

    res.json({
      success: true,
      data: turns.map((turn) => ({
        id: turn._id,
        processId: turn.processId,
        sessionId: turn.sessionId,
        role: turn.role,
        status: turn.status,
        userMessage: turn.userMessage,
        assistantResponse: turn.assistantResponse,
        createdAt: turn.createdAt,
        toolCount: turn.toolTraces ? turn.toolTraces.length : 0,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch agent history" });
  }
});

router.get("/history/:processId", async (req: Request, res: Response) => {
  if (!ensureAgentAuthConfigured(res)) {
    return;
  }

  const auth = authenticateAgentRequest(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized agent request" });
    return;
  }

  try {
    const turn = await AgentTurn.findOne({ processId: req.params.processId }).lean().exec();
    if (!turn) {
      res.status(404).json({ error: "History not found" });
      return;
    }

    res.json({ success: true, data: turn });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch agent history detail" });
  }
});

export default router;
