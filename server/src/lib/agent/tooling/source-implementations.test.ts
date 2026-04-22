import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { SourceType } from "@copytrade/shared/lib/enums";

const sourceMocks = vi.hoisted(() => ({
  buildSourceSummary: vi.fn(),
  getBackendBaseUrl: vi.fn(),
  getAccountIdFromArgs: vi.fn(),
  getSourceContextForAccount: vi.fn(),
  loadSourceAccounts: vi.fn(),
  normalizePositiveNumber: vi.fn(),
  normalizeSourceType: vi.fn(),
  serializeSourceMessages: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("./shared", () => ({
  buildSourceSummary: sourceMocks.buildSourceSummary,
  getBackendBaseUrl: sourceMocks.getBackendBaseUrl,
  getAccountIdFromArgs: sourceMocks.getAccountIdFromArgs,
  getSourceContextForAccount: sourceMocks.getSourceContextForAccount,
  loadSourceAccounts: sourceMocks.loadSourceAccounts,
  normalizePositiveNumber: sourceMocks.normalizePositiveNumber,
  normalizeSourceType: sourceMocks.normalizeSourceType,
  serializeSourceMessages: sourceMocks.serializeSourceMessages,
}));

import { sourceToolImplementations } from "./source-implementations";

beforeEach(() => {
  delete process.env.CRON_SECRET;

  sourceMocks.buildSourceSummary.mockReset();
  sourceMocks.getBackendBaseUrl.mockReset();
  sourceMocks.getAccountIdFromArgs.mockReset();
  sourceMocks.getSourceContextForAccount.mockReset();
  sourceMocks.loadSourceAccounts.mockReset();
  sourceMocks.normalizePositiveNumber.mockReset();
  sourceMocks.normalizeSourceType.mockReset();
  sourceMocks.serializeSourceMessages.mockReset();
  sourceMocks.fetchMock.mockReset();

  sourceMocks.getBackendBaseUrl.mockReturnValue("http://backend.test");
  sourceMocks.getAccountIdFromArgs.mockImplementation((args) => args.accountId);
  sourceMocks.normalizeSourceType.mockImplementation((value) =>
    typeof value === "string" ? value : null,
  );
  sourceMocks.normalizePositiveNumber.mockImplementation(
    (value, fallback, max) => {
      if (typeof value !== "number" || value <= 0) return fallback;
      return typeof max === "number" ? Math.min(value, max) : value;
    },
  );
  sourceMocks.buildSourceSummary.mockImplementation((account) => ({
    accountId: account._id,
    name: account.name,
  }));
  sourceMocks.serializeSourceMessages.mockImplementation((messages) =>
    messages.map((message: { messageId: string }) => ({ messageId: message.messageId })),
  );

  vi.stubGlobal("fetch", sourceMocks.fetchMock);
});

test("source implementations list sources, handle empty health checks, and fetch source messages", async () => {
  const account = { _id: "acc-1", name: "Discord main" };
  const provider = {
    checkHealth: vi.fn().mockResolvedValue({ ok: true }),
    fetchMessages: vi.fn().mockResolvedValue([{ messageId: "msg-1" }]),
  };

  sourceMocks.loadSourceAccounts
    .mockResolvedValueOnce([account])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([account]);
  sourceMocks.getSourceContextForAccount.mockReturnValue({
    accountId: "acc-1",
    accountName: "Discord main",
    sourceType: "discord",
    config: { _id: "acc-1" },
    provider,
  });

  const sources = JSON.parse(
    await sourceToolImplementations.get_signal_sources({}),
  );
  const emptyHealth = JSON.parse(
    await sourceToolImplementations.check_source_health({ accountId: "missing" }),
  );
  const fetched = JSON.parse(
    await sourceToolImplementations.fetch_source_messages({
      fetchLimit: 99,
      timeWindowHours: 2,
    }),
  );

  assert.deepEqual(sources, [{ accountId: "acc-1", name: "Discord main" }]);
  assert.equal(emptyHealth.success, false);
  assert.match(emptyHealth.error, /Source account not found: missing/);
  assert.equal(fetched.success, true);
  assert.equal(fetched.fetchLimit, 50);
  assert.equal(fetched.timeWindowHours, 2);
  assert.deepEqual(fetched.results, [
    {
      accountId: "acc-1",
      name: "Discord main",
      sourceType: "discord",
      fetched: 1,
      messages: [{ messageId: "msg-1" }],
    },
  ]);
});

test("source implementations handle source health, fetch failures, backend trigger, and telegram wrappers", async () => {
  const discordAccount = { _id: "acc-1", name: "Discord main" };
  const telegramAccount = { _id: "acc-2", name: "Telegram main" };
  const healthyProvider = {
    checkHealth: vi.fn().mockResolvedValue({ ok: true }),
    fetchMessages: vi.fn().mockRejectedValue(new Error("provider offline")),
  };
  const telegramProvider = {
    checkHealth: vi.fn().mockResolvedValue({ ok: true }),
    fetchMessages: vi.fn(),
  };

  sourceMocks.loadSourceAccounts
    .mockResolvedValueOnce([discordAccount])
    .mockResolvedValueOnce([discordAccount])
    .mockResolvedValueOnce([discordAccount])
    .mockResolvedValueOnce([telegramAccount])
    .mockResolvedValueOnce([telegramAccount]);
  sourceMocks.getSourceContextForAccount
    .mockReturnValueOnce({
      accountId: "acc-1",
      accountName: "Discord main",
      sourceType: "discord",
      config: { _id: "acc-1" },
      provider: healthyProvider,
    })
    .mockReturnValueOnce({
      accountId: "acc-1",
      accountName: "Discord main",
      sourceType: "discord",
      config: { _id: "acc-1" },
      provider: healthyProvider,
    })
    .mockReturnValueOnce({
      accountId: "acc-2",
      accountName: "Telegram main",
      sourceType: "telegram",
      config: { _id: "acc-2" },
      provider: telegramProvider,
    });
  sourceMocks.fetchMock.mockResolvedValue({
    json: async () => ({ success: true }),
  });
  process.env.CRON_SECRET = " secret ";

  const health = JSON.parse(
    await sourceToolImplementations.check_source_health({}),
  );
  const fetched = JSON.parse(
    await sourceToolImplementations.fetch_source_messages({}),
  );
  const discordOnly = JSON.parse(
    await sourceToolImplementations.get_discord_sources({}),
  );
  const trigger = JSON.parse(await sourceToolImplementations.check_signal_now({}));
  const telegramOnly = JSON.parse(
    await sourceToolImplementations.get_telegram_sources({}),
  );
  const telegramHealth = JSON.parse(
    await sourceToolImplementations.check_telegram_source_health({}),
  );

  assert.equal(health.checked, 1);
  assert.deepEqual(health.results[0].health, { ok: true });
  assert.equal(fetched.results[0].fetched, 0);
  assert.equal(fetched.results[0].error, "provider offline");
  assert.deepEqual(discordOnly, [{ accountId: "acc-1", name: "Discord main" }]);
  assert.deepEqual(trigger, { success: true });
  assert.deepEqual(sourceMocks.fetchMock.mock.calls[0], [
    "http://backend.test/api/cron/signal-check",
    {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
      },
    },
  ]);
  assert.deepEqual(telegramOnly, [{ accountId: "acc-2", name: "Telegram main" }]);
  assert.equal(telegramHealth.results[0].sourceType, "telegram");
  assert.equal(sourceMocks.loadSourceAccounts.mock.calls[3][0].sourceType, SourceType.TELEGRAM);
  assert.equal(sourceMocks.loadSourceAccounts.mock.calls[4][0].sourceType, SourceType.TELEGRAM);
});
