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

import { createApp, loadServerEnvironment, startServer } from "./app";

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.PORT;
  delete process.env.FRONTEND_URL;
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
  assert.equal(warnSpy.mock.calls.length, 1);
  assert.equal(logSpy.mock.calls.length, 1);
  assert.ok(server);
});
