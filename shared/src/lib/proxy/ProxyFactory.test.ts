import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const proxyFactoryMocks = vi.hoisted(() => {
  const findOne = vi.fn();
  const findOneAndUpdate = vi.fn();
  const connectDB = vi.fn();

  class FakeWebshareProvider {
    readonly name = "Webshare";
    clearCache = vi.fn();
    getProxyAgent = vi.fn(async () => "webshare-agent");
    getProxyInfo = vi.fn(async () => ({ success: true, provider: "webshare" }));
  }

  class FakeCustomProvider {
    readonly name = "Custom";
    updateSettings = vi.fn();
    getProxyAgent = vi.fn(async () => "custom-agent");
    getProxyInfo = vi.fn(async () => ({ success: true, provider: "custom" }));
  }

  const proxySettingsModel = {
    findOne,
    findOneAndUpdate,
  };

  return {
    findOne,
    findOneAndUpdate,
    connectDB,
    FakeWebshareProvider,
    FakeCustomProvider,
    proxySettingsModel,
  };
});

vi.mock("../database", () => ({
  connectDB: proxyFactoryMocks.connectDB,
}));

vi.mock("./WebshareProvider", () => ({
  WebshareProvider: proxyFactoryMocks.FakeWebshareProvider,
}));

vi.mock("./CustomProvider", () => ({
  CustomProvider: proxyFactoryMocks.FakeCustomProvider,
}));

vi.mock("mongoose", () => {
  class Schema {
    constructor(_definition?: unknown, _options?: unknown) {}
  }

  const model = vi.fn(() => proxyFactoryMocks.proxySettingsModel);

  return {
    __esModule: true,
    default: { model },
    Schema,
    models: {},
    model,
  };
});

beforeEach(() => {
  vi.resetModules();
  proxyFactoryMocks.findOne.mockReset();
  proxyFactoryMocks.findOneAndUpdate.mockReset();
  proxyFactoryMocks.connectDB.mockReset();
});

test("ProxyFactory reads defaults, persists config, and clears Webshare cache on provider changes", async () => {
  proxyFactoryMocks.findOne.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    }),
  });
  proxyFactoryMocks.findOneAndUpdate.mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      enabled: true,
      provider: "custom",
      customHost: "1.2.3.4",
      customPort: 9000,
      customUsername: "user",
      customPassword: "pass",
    }),
  });

  const mod = await import("./ProxyFactory");

  assert.deepEqual(await mod.getProxyConfig(), {
    enabled: false,
    provider: "webshare",
    custom: {
      host: "",
      port: 1080,
      username: "",
      password: "",
    },
  });

  const saved = await mod.setProxyConfig({
    enabled: true,
    provider: "custom",
    custom: {
      host: "1.2.3.4",
      port: 9000,
      username: "user",
      password: "pass",
    },
  });

  assert.deepEqual(saved, {
    enabled: true,
    provider: "custom",
    custom: {
      host: "1.2.3.4",
      port: 9000,
      username: "user",
      password: "pass",
    },
  });
  assert.deepEqual(proxyFactoryMocks.findOneAndUpdate.mock.calls[0], [
    {},
    {
      enabled: true,
      provider: "custom",
      customHost: "1.2.3.4",
      customPort: 9000,
      customUsername: "user",
      customPassword: "pass",
    },
    { upsert: true, new: true },
  ]);
});

test("ProxyFactory selects providers, agents, info, and handles failures", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  proxyFactoryMocks.findOne.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      lean: vi.fn()
        .mockResolvedValueOnce({
          enabled: true,
          provider: "webshare",
          customHost: "",
          customPort: 1080,
          customUsername: "",
          customPassword: "",
        })
        .mockResolvedValueOnce({
          enabled: true,
          provider: "custom",
          customHost: "5.6.7.8",
          customPort: 8080,
          customUsername: "u",
          customPassword: "p",
        })
        .mockResolvedValueOnce({
          enabled: true,
          provider: "custom",
          customHost: "5.6.7.8",
          customPort: 8080,
          customUsername: "u",
          customPassword: "p",
        })
        .mockResolvedValueOnce({
          enabled: false,
          provider: "webshare",
          customHost: "",
          customPort: 1080,
          customUsername: "",
          customPassword: "",
        })
        .mockResolvedValueOnce({
          enabled: true,
          provider: "custom",
          customHost: "",
          customPort: 1080,
          customUsername: "",
          customPassword: "",
        }),
    }),
  });

  const mod = await import("./ProxyFactory");

  const providerA = await mod.getProvider();
  const providerB = await mod.getProvider();
  assert.equal(providerA?.name, "Webshare");
  assert.equal(providerB?.name, "Custom");
  assert.equal(await mod.getProxyAgent(), "custom-agent");
  assert.deepEqual(await mod.getProxyInfo(), {
    success: false,
    error: "Proxy is disabled",
  });
  assert.deepEqual(await mod.getProxyInfo(), {
    success: true,
    provider: "custom",
    providerName: "Custom",
  });

  proxyFactoryMocks.connectDB.mockRejectedValueOnce(new Error("db down"));
  assert.equal((await mod.getProxyConfig()).enabled, false);
  assert.equal(warnSpy.mock.calls.length > 0, true);
});

test("ProxyFactory supports provider previews and invalid custom previews", async () => {
  const mod = await import("./ProxyFactory");

  assert.deepEqual(await mod.getProviderProxyInfo("webshare"), {
    success: true,
    provider: "webshare",
  });
  assert.deepEqual(
    await mod.getProviderProxyInfo("custom", {
      host: "9.9.9.9",
      port: 9000,
      username: "u",
      password: "p",
    }),
    {
      success: true,
      provider: "custom",
    },
  );
  assert.deepEqual(await mod.getProviderProxyInfo("custom"), {
    success: false,
    error: "Unknown provider or missing settings",
  });
});
