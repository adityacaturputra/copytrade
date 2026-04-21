import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const providerMocks = vi.hoisted(() => {
  class FakeDiscordSourceProvider {
    readonly kind = "discord";
  }

  class FakeTelegramSourceProvider {
    readonly kind = "telegram";
  }

  return {
    FakeDiscordSourceProvider,
    FakeTelegramSourceProvider,
  };
});

vi.mock("./DiscordSourceProvider", () => ({
  DiscordSourceProvider: providerMocks.FakeDiscordSourceProvider,
}));
vi.mock("./TelegramSourceProvider", () => ({
  TelegramSourceProvider: providerMocks.FakeTelegramSourceProvider,
}));

import { SourceFactory } from "./SourceFactory";

beforeEach(() => {
  SourceFactory.reset();
  vi.restoreAllMocks();
});

test("SourceFactory returns cached provider singletons", () => {
  const discordA = SourceFactory.getProvider("discord") as { kind: string };
  const discordB = SourceFactory.getDiscordProvider() as { kind: string };
  const telegramA = SourceFactory.getProvider("telegram") as { kind: string };
  const telegramB = SourceFactory.getTelegramProvider() as { kind: string };

  assert.equal(discordA.kind, "discord");
  assert.equal(telegramA.kind, "telegram");
  assert.strictEqual(discordA, discordB);
  assert.strictEqual(telegramA, telegramB);
});

test("SourceFactory resolves config type, warns on unknown types, and reset clears cache", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const fromConfig = SourceFactory.getProviderForConfig({
    type: "telegram",
  } as never) as { kind: string };
  const fallback = SourceFactory.getProvider("unknown" as never) as {
    kind: string;
  };
  const oldDiscord = SourceFactory.getDiscordProvider();

  SourceFactory.reset();
  const newDiscord = SourceFactory.getDiscordProvider();

  assert.equal(fromConfig.kind, "telegram");
  assert.equal(fallback.kind, "discord");
  assert.equal(warnSpy.mock.calls.length, 1);
  assert.notStrictEqual(oldDiscord, newDiscord);
});
