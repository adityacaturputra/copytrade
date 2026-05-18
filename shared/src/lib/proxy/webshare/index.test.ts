import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { HttpsProxyAgent } from "https-proxy-agent";

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env.WEBSHARE_API_KEY;
});

test("WebshareProvider fetchProxyList requires an API key", async () => {
  const { WebshareProvider } = await import("./index");
  const provider = new WebshareProvider();

  await assert.rejects(
    () => provider.fetchProxyList(),
    /WEBSHARE_API_KEY is not set/,
  );
});

test("WebshareProvider fetches and caches proxy lists", async () => {
  process.env.WEBSHARE_API_KEY = "token";
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      results: [
        {
          proxy_address: "1.1.1.1",
          port: 8080,
          username: "user",
          password: "pass",
          valid: true,
          country_code: "US",
          city_name: "NYC",
        },
      ],
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const nowSpy = vi.spyOn(Date, "now");
  nowSpy.mockReturnValue(1_000);

  const { WebshareProvider } = await import("./index");
  const provider = new WebshareProvider();

  const first = await provider.fetchProxyList();
  nowSpy.mockReturnValue(2_000);
  const second = await provider.fetchProxyList();

  assert.equal(fetchMock.mock.calls.length, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0], {
    ip: "1.1.1.1",
    port: 8080,
    username: "user",
    password: "pass",
    valid: true,
    country_code: "US",
    city_name: "NYC",
  });

  provider.clearCache();
  nowSpy.mockReturnValue(400_000);
  await provider.fetchProxyList();
  assert.equal(fetchMock.mock.calls.length, 2);
});

test("WebshareProvider handles missing keys, errors, info, and agents", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  let mod = await import("./index");
  let provider = new mod.WebshareProvider();

  assert.equal(await provider.getProxyUrl(), null);
  assert.equal(await provider.getProxyUrl(), null);
  assert.equal(warnSpy.mock.calls.length, 1);

  vi.resetModules();
  process.env.WEBSHARE_API_KEY = "token";
  const fetchMock = vi.fn(async () => ({
    ok: false,
    status: 500,
    text: async () => "server error",
  }));
  vi.stubGlobal("fetch", fetchMock);

  mod = await import("./index");
  provider = new mod.WebshareProvider();

  assert.equal(await provider.getProxyUrl(), null);
  assert.equal(await provider.getProxyUrl(), null);
  assert.equal(errorSpy.mock.calls.length, 1);
  assert.deepEqual(await provider.getProxyInfo(), {
    success: false,
    error: "Webshare API error (500): server error",
  });

  vi.resetModules();
  process.env.WEBSHARE_API_KEY = "token";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            proxy_address: "2.2.2.2",
            port: 9000,
            username: "user2",
            password: "pass2",
            valid: true,
            country_code: "SG",
            city_name: "Singapore",
          },
          {
            proxy_address: "3.3.3.3",
            port: 9100,
            username: "bad",
            password: "bad",
            valid: false,
            country_code: "ID",
            city_name: "Jakarta",
          },
        ],
      }),
    })),
  );

  mod = await import("./index");
  provider = new mod.WebshareProvider();

  assert.equal(
    await provider.getProxyUrl(),
    "http://user2:pass2@2.2.2.2:9000",
  );
  assert.ok((await provider.getProxyAgent()) instanceof HttpsProxyAgent);
  assert.deepEqual(await provider.getProxyInfo(), {
    success: true,
    credentials: { username: "user2", password: "pass2" },
    proxies: [
      {
        ip: "2.2.2.2",
        port: 9000,
        username: "user2",
        password: "pass2",
        valid: true,
        country_code: "SG",
        city_name: "Singapore",
      },
      {
        ip: "3.3.3.3",
        port: 9100,
        username: "bad",
        password: "bad",
        valid: false,
        country_code: "ID",
        city_name: "Jakarta",
      },
    ],
    ipList: ["2.2.2.2"],
    ipListsByKey: [["2.2.2.2"]],
    allIpList: ["2.2.2.2"],
    total: 2,
    validCount: 1,
    webshareApiKeys: {
      total: 1,
      activeIndex: 0,
      activeKeyMasked: "****",
    },
  });
});

test("WebshareProvider rotates API key on 402 bandwidth limits and aggregates IPs across keys", async () => {
  const persistSpy = vi.fn(async () => {});
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            proxy_address: "4.4.4.4",
            port: 8080,
            username: "user4",
            password: "pass4",
            valid: true,
            country_code: "US",
            city_name: "Buffalo",
          },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            proxy_address: "1.1.1.1",
            port: 8080,
            username: "user1",
            password: "pass1",
            valid: true,
            country_code: "SG",
            city_name: "Singapore",
          },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            proxy_address: "4.4.4.4",
            port: 8080,
            username: "user4",
            password: "pass4",
            valid: true,
            country_code: "US",
            city_name: "Buffalo",
          },
        ],
      }),
    });

  vi.stubGlobal("fetch", fetchMock);

  const mod = await import("./index");
  mod.configureWebshareApiKeyPool({
    resolvePool: () => ({
      keys: ["key-a", "key-b"],
      activeIndex: 0,
      allowedCountryCodes: [],
    }),
    persistActiveIndex: persistSpy,
  });

  const provider = new mod.WebshareProvider();
  const rotated = await provider.tryRotateApiKeyForError({
    status: 402,
    responseBody:
      "Bandwidth limit reached. Please upgrade to continue using the proxy.",
  });

  assert.equal(rotated, true);
  assert.equal(await provider.getProxyUrl(), "http://user4:pass4@4.4.4.4:8080");

  provider.clearCache();
  const info = await provider.getProxyInfo();
  assert.equal(info.success, true);
  assert.deepEqual(info.ipListsByKey, [["1.1.1.1"], ["4.4.4.4"]]);
  assert.deepEqual(info.allIpList, ["1.1.1.1", "4.4.4.4"]);
  assert.equal(persistSpy.mock.calls.length > 0, true);
});

test("WebshareProvider keeps API-key rotation available while IP cooldown is handled separately", async () => {
  const persistSpy = vi.fn(async () => {});
  const mod = await import("./index");
  mod.configureWebshareApiKeyPool({
    resolvePool: () => ({
      keys: ["key-a", "key-b"],
      activeIndex: 0,
      allowedCountryCodes: [],
    }),
    persistActiveIndex: persistSpy,
  });

  const provider = new mod.WebshareProvider();
  const firstRotate = await provider.tryRotateApiKeyForError({
    status: 402,
    responseBody:
      "Bandwidth limit reached. Please upgrade to continue using the proxy.",
  });
  const secondRotate = await provider.tryRotateApiKeyForError({
    status: 402,
    responseBody:
      "Bandwidth limit reached. Please upgrade to continue using the proxy.",
  });

  assert.equal(firstRotate, true);
  assert.equal(secondRotate, true);
});
