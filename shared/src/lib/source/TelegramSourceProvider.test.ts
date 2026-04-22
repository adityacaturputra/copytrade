import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { SourceType } from "../enums";
import { TelegramSourceProvider } from "./TelegramSourceProvider";

test("TelegramSourceProvider exposes metadata and returns empty fetch results", async () => {
  const provider = new TelegramSourceProvider();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const messages = await provider.fetchMessages({
    _id: "src-1",
    name: "Telegram Alpha",
    type: "telegram",
    channelIds: ["100"],
    token: "token",
  } as never);

  assert.equal(provider.name, "Telegram");
  assert.equal(provider.type, SourceType.TELEGRAM);
  assert.deepEqual(messages, []);
  assert.equal(warn.mock.calls.length, 1);

  warn.mockRestore();
});

test("TelegramSourceProvider checkHealth reports missing tokens and unimplemented state", async () => {
  const provider = new TelegramSourceProvider();

  const missingToken = await provider.checkHealth({
    _id: "src-1",
    name: "Telegram Alpha",
    type: "telegram",
    channelIds: ["100"],
    token: "",
  } as never);
  const configured = await provider.checkHealth({
    _id: "src-1",
    name: "Telegram Alpha",
    type: "telegram",
    channelIds: ["100"],
    token: "token",
  } as never);

  assert.deepEqual(missingToken, {
    valid: false,
    error: "Telegram token is not configured",
    needsRefresh: false,
  });
  assert.deepEqual(configured, {
    valid: false,
    error: "Telegram provider is not yet implemented",
    needsRefresh: false,
  });
});

test("TelegramSourceProvider getChannelNames mirrors the configured ids", async () => {
  const provider = new TelegramSourceProvider();

  const channelNames = await provider.getChannelNames(
    ["100", "200"],
    {
      _id: "src-1",
      name: "Telegram Alpha",
      type: "telegram",
      channelIds: ["100", "200"],
      token: "token",
    } as never,
  );

  assert.deepEqual(Array.from(channelNames.entries()), [
    ["100", "100"],
    ["200", "200"],
  ]);
});
