import { test } from "vitest";
import assert from "node:assert/strict";
import { HttpsProxyAgent } from "https-proxy-agent";
import { CustomProvider } from "./CustomProvider";

test("CustomProvider returns null when host is missing", async () => {
  const provider = new CustomProvider({
    host: "",
    port: 1080,
    username: "user",
    password: "pass",
  });

  assert.equal(await provider.getProxyUrl(), null);
  assert.equal(await provider.getProxyAgent(), null);
  assert.deepEqual(await provider.getProxyInfo(), {
    success: false,
    error:
      "Custom proxy not configured. Set host, port, username, and password.",
  });
});

test("CustomProvider builds urls, agents, info, and supports updates", async () => {
  const provider = new CustomProvider({
    host: "1.2.3.4",
    port: 8080,
    username: "user",
    password: "pass",
  });

  assert.equal(
    await provider.getProxyUrl(),
    "http://user:pass@1.2.3.4:8080",
  );
  assert.ok((await provider.getProxyAgent()) instanceof HttpsProxyAgent);
  assert.deepEqual(await provider.getProxyInfo(), {
    success: true,
    credentials: { username: "user", password: "pass" },
    proxies: [
      {
        ip: "1.2.3.4",
        port: 8080,
        username: "user",
        password: "pass",
        valid: true,
        country_code: "-",
        city_name: "Custom",
      },
    ],
    ipList: ["1.2.3.4"],
    total: 1,
    validCount: 1,
  });

  provider.updateSettings({
    host: "5.6.7.8",
    port: 9000,
    username: "next",
    password: "secret",
  });

  assert.equal(
    await provider.getProxyUrl(),
    "http://next:secret@5.6.7.8:9000",
  );
});
