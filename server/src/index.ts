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

// Load environment variables
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

const app: Express = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const RAW_CRON_SECRET = process.env.CRON_SECRET;
const CRON_SECRET = RAW_CRON_SECRET?.trim() || "";
const CRON_AUTH_ENABLED = CRON_SECRET.length > 0;

// ─── Middleware ───────────────────────────────────────────────────────────────

// Security headers
app.use(helmet());

// CORS - allow requests from the frontend
app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Parse JSON bodies
app.use(express.json());

// Request logging with status code and duration
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

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "copytrade-backend",
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// Mount cron routes at /api/cron
app.use("/api/cron", cronRoutes);
app.use("/api/agent", agentRoutes);

// ─── Error Handling ───────────────────────────────────────────────────────────

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: "Not found",
    path: req.path,
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[Error]", err.stack);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  if (RAW_CRON_SECRET && RAW_CRON_SECRET !== CRON_SECRET) {
    console.warn(
      "[Config] CRON_SECRET contains leading/trailing spaces. It has been trimmed for comparison.",
    );
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║           CopyTrade Backend Server                         ║
╠════════════════════════════════════════════════════════════╣
║  Port:        ${PORT.toString().padEnd(45)}║
║  Frontend:    ${FRONTEND_URL.padEnd(45)}║
║  Environment: ${(process.env.NODE_ENV || "development").padEnd(45)}║
║  Cron Auth:   ${(CRON_AUTH_ENABLED ? "enabled" : "disabled (CRON_SECRET not set)").padEnd(45)}║
╚════════════════════════════════════════════════════════════╝
  `);
});

export default app;
