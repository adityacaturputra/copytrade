import express, {
  Request,
  Response,
  NextFunction,
  type Express,
} from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import cronRoutes from "./routes/cron";
import agentRoutes from "./routes/agent";
import draftsRoutes from "./routes/drafts";
import logsRoutes from "./routes/logs";
import { startAppCronScheduler } from "./lib/cron/scheduler";

export function loadServerEnvironment(): void {
  const serverDir = path.resolve(__dirname, "..");
  const repoRootDir = path.resolve(serverDir, "..");
  const envCandidates = [
    path.join(repoRootDir, ".env"),
    path.join(serverDir, ".env"),
  ];

  for (const envFile of envCandidates) {
    if (fs.existsSync(envFile)) {
      dotenv.config({ path: envFile, override: false });
    }
  }
}

export function createApp(): Express {
  loadServerEnvironment();

  const app: Express = express();
  process.env.COPYTRADE_RUNTIME = "backend";
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  app.use(helmet());
  app.use(
    cors({
      origin: frontendUrl,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Agent-Password",
        "X-Agent-Auth",
      ],
      credentials: true,
    }),
  );
  app.use(express.json());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const hasAuth = req.headers.authorization ? "yes" : "no";
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.path} -> ${res.statusCode} (${durationMs}ms, auth:${hasAuth})`,
      );
    });
    next();
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "copytrade-backend",
    });
  });

  app.use("/api/cron", cronRoutes);
  app.use("/api/agent", agentRoutes);
  app.use("/api/drafts", draftsRoutes);
  app.use("/api/logs", logsRoutes);

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: "Not found",
      path: req.path,
    });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Error]", err.stack);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  });

  return app;
}

export function startServer(app: Express = createApp()) {
  const port = process.env.PORT || 3001;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const rawCronSecret = process.env.CRON_SECRET;
  const cronSecret = rawCronSecret?.trim() || "";
  const cronAuthEnabled = cronSecret.length > 0;

  return app.listen(port, () => {
    if (rawCronSecret && rawCronSecret !== cronSecret) {
      console.warn(
        "[Config] CRON_SECRET contains leading/trailing spaces. It has been trimmed for comparison.",
      );
    }

    startAppCronScheduler({
      baseUrl: `http://127.0.0.1:${port}`,
      authorizationHeader: cronSecret ? `Bearer ${cronSecret}` : undefined,
    });

    console.log(`
╔════════════════════════════════════════════════════════════╗
║           CopyTrade Backend Server                         ║
╠════════════════════════════════════════════════════════════╣
║  Port:        ${port.toString().padEnd(45)}║
║  Frontend:    ${frontendUrl.padEnd(45)}║
║  Environment: ${(process.env.NODE_ENV || "development").padEnd(45)}║
║  Cron Auth:   ${(cronAuthEnabled ? "enabled" : "disabled (CRON_SECRET not set)").padEnd(45)}║
╚════════════════════════════════════════════════════════════╝
  `);
  });
}
