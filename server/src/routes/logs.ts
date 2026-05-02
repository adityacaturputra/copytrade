import {
  Router,
  Request,
  Response,
  type Router as ExpressRouter,
} from "express";
import {
  cleanupTradeLogs,
  createTradeLog,
  listTradeLogs,
} from "@copytrade/shared/lib/trade-log-store";
import { requireActionAuth } from "../lib/action-auth";

const router: ExpressRouter = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit || "50"), 10)),
    );
    const hideCronNoise = String(req.query.hideCronNoise || "true") !== "false";
    const accountId =
      typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    const processId =
      typeof req.query.processId === "string" ? req.query.processId : undefined;
    const symbol =
      typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const levels =
      typeof req.query.levels === "string"
        ? req.query.levels
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined;
    const order = req.query.order === "asc" ? "asc" : "desc";

    const result = await listTradeLogs({
      page,
      limit,
      hideCronNoise,
      accountId,
      processId,
      symbol,
      levels,
      order,
    });

    res.json({
      success: true,
      data: {
        logs: result.logs,
        page: result.page,
        limit: result.limit,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!body.type || !body.action) {
      res.status(400).json({
        success: false,
        error: "type and action are required",
      });
      return;
    }

    const record = await createTradeLog({
      accountId:
        typeof body.accountId === "string"
          ? body.accountId
          : (body.accountId ?? null),
      processId:
        typeof body.processId === "string"
          ? body.processId
          : (body.processId ?? null),
      type: String(body.type),
      action: String(body.action),
      symbol:
        typeof body.symbol === "string" ? body.symbol : (body.symbol ?? null),
      details:
        typeof body.details === "string"
          ? body.details
          : (body.details ?? null),
      level: typeof body.level === "string" ? body.level : (body.level ?? null),
      result:
        typeof body.result === "string" ? body.result : (body.result ?? null),
      error: typeof body.error === "string" ? body.error : (body.error ?? null),
      createdAt:
        typeof body.createdAt === "string" || body.createdAt instanceof Date
          ? body.createdAt
          : undefined,
    });

    res.status(201).json({
      success: true,
      data: record,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.post(
  "/cleanup",
  requireActionAuth,
  async (req: Request, res: Response) => {
    try {
      const mode = req.body?.mode === "retention" ? "retention" : "noisy-json";
      const keepDays =
        typeof req.body?.keepDays === "number"
          ? req.body.keepDays
          : Number.parseInt(String(req.body?.keepDays || ""), 10);

      if (
        mode === "retention" &&
        (!Number.isFinite(keepDays) || keepDays < 1)
      ) {
        res.status(400).json({
          success: false,
          error: "keepDays must be a number greater than or equal to 1",
        });
        return;
      }

      const result = await cleanupTradeLogs({
        mode,
        keepDays: mode === "retention" ? Math.floor(keepDays) : undefined,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

export default router;
