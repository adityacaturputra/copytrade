import express from "express";
import request from "supertest";
import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import fs from "fs";

vi.mock("./routes/cron", () => {
  const router = express.Router();
  router.get("/boom", () => {
    throw new Error("boom");
  });
  return { default: router };
});
vi.mock("./routes/agent", () => ({ default: express.Router() }));
vi.mock("./routes/drafts", () => ({ default: express.Router() }));
vi.mock("./routes/logs", () => ({ default: express.Router() }));
const schedulerMocks = vi.hoisted(() => ({
  startAppCronScheduler: vi.fn(),
}));
vi.mock("./lib/cron/scheduler", () => schedulerMocks);

import { createApp, loadServerEnvironment, startServer } from "./app";

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.PORT;
  delete process.env.FRONTEND_URL;
  delete process.env.FRONTEND_ORIGINS;
  delete process.env.NODE_ENV;
  schedulerMocks.startAppCronScheduler.mockReset();
});

test("loadServerEnvironment loads each existing env candidate", () => {
  const existsSpy = vi
    .spyOn(fs, "existsSync")
    .mockImplementation((file) => String(file).endsWith(".env"));
  const dotenvSpy = vi
    .spyOn(dotenv, "config")
    .mockImplementation(() => ({ parsed: {} }));

  loadServerEnvironment();

  assert.equal(existsSpy.mock.calls.length, 2);
  assert.equal(dotenvSpy.mock.calls.length, 2);
});

test("loadServerEnvironment skips missing env files", () => {
  const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
  const dotenvSpy = vi
    .spyOn(dotenv, "config")
    .mockImplementation(() => ({ parsed: {} }));

  loadServerEnvironment();

  assert.equal(existsSpy.mock.calls.length, 2);
  assert.equal(dotenvSpy.mock.calls.length, 0);
});

test("createApp serves health checks, 404s, and the error handler", async () => {
  const app = createApp();

  const health = await request(app).get("/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");
  assert.equal(health.body.service, "copytrade-backend");

  const missing = await request(app).get("/missing");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, {
    success: false,
    error: "Not found",
    path: "/missing",
  });

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.NODE_ENV = "development";
  const boom = await request(app).get("/api/cron/boom");
  assert.equal(boom.status, 500);
  assert.equal(boom.body.success, false);
  assert.equal(boom.body.error, "Internal server error");
  assert.equal(boom.body.message, "boom");
  assert.equal(errorSpy.mock.calls.length > 0, true);

  delete process.env.NODE_ENV;
  const boomProd = await request(app).get("/api/cron/boom").set("authorization", "Bearer x");
  assert.equal(boomProd.status, 500);
  assert.equal("message" in boomProd.body, false);
});

test("createApp also works with an explicit FRONTEND_URL override", async () => {
  process.env.FRONTEND_URL = "https://frontend.example.com";
  const app = createApp();

  const health = await request(app).get("/health");

  assert.equal(health.status, 200);
  assert.equal(health.body.status, "ok");
});

test("createApp falls back when FRONTEND_URL is blank", async () => {
  process.env.FRONTEND_URL = "";
  const app = createApp();

  const health = await request(app).get("/health");

  assert.equal(health.status, 200);
});

test("createApp allows configured Vercel and localhost frontend origins", async () => {
  process.env.FRONTEND_ORIGINS =
    "https://copytrade-client-dit.vercel.app, http://localhost:3000";
  const app = createApp();

  const vercelPreflight = await request(app)
    .options("/api/agent/auth")
    .set("Origin", "https://copytrade-client-dit.vercel.app")
    .set("Access-Control-Request-Method", "POST");

  assert.equal(vercelPreflight.status, 204);
  assert.equal(
    vercelPreflight.headers["access-control-allow-origin"],
    "https://copytrade-client-dit.vercel.app",
  );

  const localhostPreflight = await request(app)
    .options("/api/agent/auth")
    .set("Origin", "http://localhost:3000")
    .set("Access-Control-Request-Method", "POST");

  assert.equal(localhostPreflight.status, 204);
  assert.equal(
    localhostPreflight.headers["access-control-allow-origin"],
    "http://localhost:3000",
  );
});

test("createApp blocks unconfigured origins", async () => {
  process.env.FRONTEND_URL = "https://frontend.example.com";
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createApp();

  const preflight = await request(app)
    .options("/api/agent/auth")
    .set("Origin", "https://evil.example.com")
    .set("Access-Control-Request-Method", "POST");

  assert.equal(preflight.status, 500);
  assert.equal(preflight.body.success, false);
  assert.equal(preflight.body.error, "Internal server error");
  assert.equal(errorSpy.mock.calls.length > 0, true);
  errorSpy.mockRestore();
});

test("startServer listens and logs trimmed cron-secret warnings", () => {
  process.env.PORT = "4321";
  process.env.FRONTEND_URL = "http://localhost:3000";
  process.env.CRON_SECRET = " secret ";

  const listenSpy = vi.fn((port: string, callback: () => void) => {
    callback();
    return { close: vi.fn() };
  });
  const app = { listen: listenSpy } as unknown as express.Express;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  const server = startServer(app);

  assert.equal(listenSpy.mock.calls[0][0], "4321");
  assert.deepEqual(schedulerMocks.startAppCronScheduler.mock.calls[0], [
    {
      baseUrl: "http://127.0.0.1:4321",
      authorizationHeader: "Bearer secret",
    },
  ]);
  assert.equal(warnSpy.mock.calls.length, 1);
  assert.equal(logSpy.mock.calls.length, 1);
  assert.ok(server);
});

test("startServer defaults port, disables cron auth banner, and omits auth header for scheduler", () => {
  const listenSpy = vi.fn((port: number, callback: () => void) => {
    callback();
    return { close: vi.fn() };
  });
  const app = { listen: listenSpy } as unknown as express.Express;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  const server = startServer(app);

  assert.equal(listenSpy.mock.calls[0][0], 3001);
  assert.deepEqual(schedulerMocks.startAppCronScheduler.mock.calls[0], [
    {
      baseUrl: "http://127.0.0.1:3001",
      authorizationHeader: undefined,
    },
  ]);
  assert.equal(warnSpy.mock.calls.length, 0);
  assert.equal(logSpy.mock.calls.length, 1);
  assert.ok(String(logSpy.mock.calls[0]?.[0]).includes("disabled (CRON_SECRET not set)"));
  assert.ok(server);
});

test("startServer banner shows multiple configured frontend origins", () => {
  process.env.FRONTEND_ORIGINS =
    "https://copytrade-client-dit.vercel.app, http://localhost:3000";

  const listenSpy = vi.fn((port: number, callback: () => void) => {
    callback();
    return { close: vi.fn() };
  });
  const app = { listen: listenSpy } as unknown as express.Express;
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  startServer(app);

  assert.equal(
    String(logSpy.mock.calls[0]?.[0]).includes(
      "https://copytrade-client-dit.vercel.app, http://localhost:3000",
    ),
    true,
  );
  logSpy.mockRestore();
});
