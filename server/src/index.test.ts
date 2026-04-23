import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

beforeEach(() => {
  vi.resetModules();
});

test("server index creates and exports the app instance", async () => {
  const app = { name: "app" };
  const createApp = vi.fn(() => app);
  const startServer = vi.fn();

  vi.doMock("./app", () => ({
    createApp,
    startServer,
  }));

  const mod = await import("./index");

  assert.strictEqual(mod.default, app);
  assert.strictEqual(mod.bootServer(), app);
  assert.equal(createApp.mock.calls.length, 1);
  assert.equal(startServer.mock.calls.length, 0);

  mod.bootServer({ main: {} } as NodeRequire, {} as NodeModule);
  assert.equal(startServer.mock.calls.length, 0);

  const currentModule = {} as NodeModule;
  mod.bootServer({ main: currentModule } as NodeRequire, currentModule);
  assert.equal(startServer.mock.calls.length, 1);
  assert.deepEqual(startServer.mock.calls[0], [app]);
});
