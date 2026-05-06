import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const discordSourceMocks = vi.hoisted(() => {
  class FakeTextChannel {
    name?: string;
    messages: { fetch: ReturnType<typeof vi.fn> };

    constructor(
      messagesFetch: ReturnType<typeof vi.fn>,
      name?: string,
    ) {
      this.messages = { fetch: messagesFetch };
      this.name = name;
    }
  }

  const axiosGet = vi.fn();
  const clientBlueprints: Array<Record<string, unknown>> = [];
  const createdClients: Array<Record<string, unknown>> = [];

  class FakeClient {
    channels: { fetch: ReturnType<typeof vi.fn> };
    private ready = false;
    login: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    intents?: unknown;

    constructor(options: Record<string, unknown>) {
      const blueprint = clientBlueprints.shift() || {};
      this.intents = options.intents;
      this.ready = Boolean(blueprint.ready);
      this.channels = {
        fetch:
          (blueprint.channelsFetch as ReturnType<typeof vi.fn>) ||
          vi.fn(),
      };
      this.login =
        (blueprint.login as ReturnType<typeof vi.fn>) ||
        vi.fn().mockResolvedValue(undefined);
      this.once =
        (blueprint.once as ReturnType<typeof vi.fn>) ||
        vi.fn((event: string, callback: () => void) => {
          if (event === "ready") {
            this.ready = true;
            callback();
          }
        });
      this.destroy =
        (blueprint.destroy as ReturnType<typeof vi.fn>) ||
        vi.fn().mockResolvedValue(undefined);
      createdClients.push(this);
    }

    isReady() {
      return this.ready;
    }

    __setReady(value: boolean) {
      this.ready = value;
    }
  }

  return {
    axiosGet,
    clientBlueprints,
    createdClients,
    FakeTextChannel,
    FakeClient,
  };
});

vi.mock("axios", () => ({
  default: {
    get: discordSourceMocks.axiosGet,
    isAxiosError: (error: unknown) =>
      Boolean((error as { __axiosError?: boolean })?.__axiosError),
  },
}));

vi.mock("discord.js", () => ({
  Client: discordSourceMocks.FakeClient,
  TextChannel: discordSourceMocks.FakeTextChannel,
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
  },
}));

import {
  DiscordSourceProvider,
  checkTokenHealth,
  disconnectDiscord,
  fetchChannelNames,
  fetchMessagesFromSource,
} from "./DiscordSourceProvider";

function createRestMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "1",
    channel_id: "c1",
    content: "hello",
    timestamp: "2026-04-22T00:00:00.000Z",
    author: { username: "Trader" },
    attachments: [],
    embeds: [],
    ...overrides,
  };
}

function createBotMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "1",
    channelId: "c1",
    content: "hello",
    author: { username: "Trader" },
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    url: "https://discord.com/channels/guild/c1/1",
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

beforeEach(() => {
  discordSourceMocks.axiosGet.mockReset();
  discordSourceMocks.clientBlueprints.length = 0;
  discordSourceMocks.createdClients.length = 0;
  DiscordSourceProvider._botClients.clear();
});

test("DiscordSourceProvider fetches user-token messages with pagination, enrichment, sorting, and stop conditions", async () => {
  const provider = new DiscordSourceProvider();
  const channelTwoFirstPage = vi.fn().mockReturnValue(true);

  discordSourceMocks.axiosGet.mockImplementation(async (url: string) => {
    if (url.includes("channels/c1/messages?limit=2&before=2")) {
      return {
        data: [
          createRestMessage({
            id: "1",
            content: "older known",
          }),
        ],
      };
    }

    if (url.includes("channels/c1/messages?limit=2")) {
      return {
        data: [
          createRestMessage({
            id: "3",
            content: "> quoted\nentry signal",
            attachments: [
              { url: "https://img/1.png", content_type: "image/png" },
            ],
            embeds: [{ thumbnail: { url: "https://img/thumb.png" } }],
          }),
          createRestMessage({
            id: "2",
            content: "second message",
          }),
        ],
      };
    }

    if (url.includes("channels/c2/messages?limit=2&before=9")) {
      return { data: [] };
    }

    if (
      url.includes("channels/c2/messages?limit=2") &&
      channelTwoFirstPage()
    ) {
      return {
        data: [
          createRestMessage({
            id: "9",
            channel_id: "c2",
            content: "channel two",
            author: { username: "Other" },
          }),
        ],
      };
    }

    return {
      data: [],
    };
  });

  const messages = await provider.fetchMessages(
    {
      _id: "src-1",
      name: "Discord Alpha",
      type: "discord",
      method: "user",
      token: "user-token",
      channelIds: ["c1", "c2"],
    } as never,
    2,
    undefined,
    new Set(["1"]),
  );

  assert.deepEqual(
    messages.map((message) => ({
      id: message.messageId,
      channel: message.channelId,
      author: message.author,
      content: message.content,
      original: message.originalContent,
      sourceId: message.sourceId,
      sourceName: message.sourceName,
      imageUrls: message.imageUrls,
    })),
    [
      {
        id: "9",
        channel: "c2",
        author: "Other",
        content: "channel two",
        original: undefined,
        sourceId: "src-1",
        sourceName: "Discord Alpha",
        imageUrls: [],
      },
      {
        id: "3",
        channel: "c1",
        author: "Trader",
        content: "entry signal",
        original: "> quoted\nentry signal",
        sourceId: "src-1",
        sourceName: "Discord Alpha",
        imageUrls: ["https://img/1.png", "https://img/thumb.png"],
      },
      {
        id: "2",
        channel: "c1",
        author: "Trader",
        content: "second message",
        original: undefined,
        sourceId: "src-1",
        sourceName: "Discord Alpha",
        imageUrls: [],
      },
    ],
  );
});

test("DiscordSourceProvider fetches bot messages after login and stops at the time cutoff", async () => {
  const provider = new DiscordSourceProvider();
  const messagesFetch = vi.fn().mockResolvedValue(
    new Map([
      [
        "10",
        createBotMessage({
          id: "10",
          content: "recent signal",
          createdAt: new Date(),
        }),
      ],
      [
        "09",
        createBotMessage({
          id: "09",
          content: "too old",
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        }),
      ],
    ]),
  );
  const login = vi.fn().mockResolvedValue(undefined);
  const once = vi.fn((event: string, callback: () => void) => {
    if (event === "ready") callback();
  });

  discordSourceMocks.clientBlueprints.push({
    ready: false,
    login,
    once,
    channelsFetch: vi
      .fn()
      .mockResolvedValue(new discordSourceMocks.FakeTextChannel(messagesFetch)),
  });

  const messages = await provider.fetchMessages(
    {
      _id: "src-2",
      name: "Discord Bot",
      type: "discord",
      method: "bot",
      token: "bot-token",
      channelIds: ["bot-channel"],
    } as never,
    10,
    1,
  );

  assert.equal(login.mock.calls.length, 1);
  assert.equal(messagesFetch.mock.calls.length, 1);
  assert.deepEqual(messages.map((message) => message.messageId), ["10"]);
});

test("DiscordSourceProvider fetchMessageContext sorts ascending and enriches messages", async () => {
  const provider = new DiscordSourceProvider();

  discordSourceMocks.axiosGet.mockResolvedValueOnce({
    data: [
      createRestMessage({
        id: "2",
        timestamp: "2026-04-22T00:02:00.000Z",
      }),
      createRestMessage({
        id: "1",
        timestamp: "2026-04-22T00:01:00.000Z",
      }),
    ],
  });

  const context = await provider.fetchMessageContext(
    {
      _id: "src-3",
      name: "Discord Context",
      type: "discord",
      method: "user",
      token: "user-token",
      channelIds: ["c1"],
    } as never,
    "c1",
    "1",
    2,
  );

  assert.deepEqual(context.map((message) => message.messageId), ["1", "2"]);
  assert.equal(context[0]?.sourceId, "src-3");
  assert.equal(context[0]?.sourceName, "Discord Context");
});

test("DiscordSourceProvider fetches bot message context and getChannelNames/checkHealth delegate correctly", async () => {
  const provider = new DiscordSourceProvider();
  const login = vi.fn().mockResolvedValue(undefined);
  const once = vi.fn((event: string, callback: () => void) => {
    if (event === "ready") callback();
  });
  const messagesFetch = vi.fn().mockResolvedValue(
    new Map([
      [
        "2",
        createBotMessage({
          id: "2",
          content: "newer",
          createdAt: new Date("2026-04-22T00:02:00.000Z"),
          attachments: new Map([
            [
              "1",
              { url: "https://img/bot.jpg", contentType: "image/jpeg" },
            ],
          ]),
        }),
      ],
      [
        "1",
        createBotMessage({
          id: "1",
          content: "> quote\nolder",
          createdAt: new Date("2026-04-22T00:01:00.000Z"),
          embeds: [{ image: { url: "https://img/embed.png" } }],
        }),
      ],
    ]),
  );
  const channelsFetch = vi
    .fn()
    .mockResolvedValue(new discordSourceMocks.FakeTextChannel(messagesFetch, "alpha"));

  discordSourceMocks.clientBlueprints.push({
    ready: false,
    login,
    once,
    channelsFetch,
  });

  discordSourceMocks.axiosGet
    .mockResolvedValueOnce({
      headers: { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1) },
    })
    .mockResolvedValueOnce({
      data: { name: "user-room" },
    });

  const context = await provider.fetchMessageContext(
    {
      _id: "src-bot",
      name: "Discord Bot",
      type: "discord",
      method: "bot",
      token: "bot-token",
      channelIds: ["bot-room"],
    } as never,
    "bot-room",
    "2",
    5,
  );

  const health = await provider.checkHealth({
    type: "discord",
    method: "user",
    token: "user-token",
  } as never);
  const names = await provider.getChannelNames(
    ["user-room"],
    {
      type: "discord",
      method: "user",
      token: "user-token",
      channelIds: ["user-room"],
    } as never,
  );

  assert.equal(login.mock.calls.length, 1);
  assert.deepEqual(messagesFetch.mock.calls[0]?.[0], {
    limit: 5,
    around: "2",
  });
  assert.deepEqual(context.map((message) => message.messageId), ["1", "2"]);
  assert.deepEqual(context[0]?.imageUrls, ["https://img/embed.png"]);
  assert.equal(context[0]?.originalContent, "> quote\nolder");
  assert.deepEqual(context[1]?.imageUrls, ["https://img/bot.jpg"]);
  assert.equal(health.valid, true);
  assert.equal(names.get("user-room"), "user-room");
});

test("checkTokenHealth handles healthy, unauthorized, and rate-limited responses", async () => {
  discordSourceMocks.axiosGet
    .mockResolvedValueOnce({
      headers: {
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
      },
    })
    .mockRejectedValueOnce({
      __axiosError: true,
      response: {
        status: 401,
        data: { message: "unauthorized" },
      },
      message: "401",
    })
    .mockRejectedValueOnce({
      __axiosError: true,
      response: {
        status: 429,
        data: { message: "rate limited" },
      },
      message: "429",
    });

  const healthy = await checkTokenHealth("bot", "token");
  const unauthorized = await checkTokenHealth("user", "token");
  const rateLimited = await checkTokenHealth("user", "token");

  assert.equal(healthy.valid, true);
  assert.equal(typeof healthy.expiresIn, "number");
  assert.deepEqual(unauthorized, {
    valid: false,
    error: "Token is invalid or expired (401 Unauthorized)",
    needsRefresh: true,
  });
  assert.deepEqual(rateLimited, {
    valid: true,
    error: "Rate limited (429) - token is valid but throttled",
    needsRefresh: false,
    expiresIn: 0,
  });
});

test("checkTokenHealth handles forbidden, generic HTTP, and non-axios failures", async () => {
  discordSourceMocks.axiosGet
    .mockRejectedValueOnce({
      __axiosError: true,
      response: {
        status: 403,
        data: { message: "forbidden" },
      },
      message: "403",
    })
    .mockRejectedValueOnce({
      __axiosError: true,
      response: {
        status: 500,
        data: { message: "boom" },
      },
      message: "500",
    })
    .mockRejectedValueOnce(new Error("network down"));

  assert.deepEqual(await checkTokenHealth("bot", "token"), {
    valid: false,
    error: "Token lacks required permissions (403 Forbidden)",
    needsRefresh: false,
  });
  assert.deepEqual(await checkTokenHealth("user", "token"), {
    valid: false,
    error: "HTTP 500: boom",
    needsRefresh: false,
  });
  assert.deepEqual(await checkTokenHealth("user", "token"), {
    valid: false,
    error: "network down",
    needsRefresh: false,
  });
});

test("fetchChannelNames resolves user and bot channels and ignores per-channel failures", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const botChannel = { name: "bot-room" };

  discordSourceMocks.axiosGet.mockImplementation(async (url: string) => {
    if (url.endsWith("/user-ok")) {
      return { data: { name: "user-room" } };
    }
    throw new Error("missing");
  });

  discordSourceMocks.clientBlueprints.push({
    ready: true,
    channelsFetch: vi.fn(async (channelId: string) => {
      if (channelId === "bot-ok") return botChannel;
      throw new Error("missing");
    }),
  });

  const result = await fetchChannelNames(
    ["user-ok", "user-missing", "bot-ok", "bot-missing"],
    [
      {
        token: "user-token",
        method: "user",
        channelIds: ["user-ok", "user-missing"],
      },
      {
        token: "bot-token",
        method: "bot",
        channelIds: ["bot-ok", "bot-missing"],
      },
    ],
  );

  assert.deepEqual(Array.from(result.entries()), [
    ["user-ok", "user-room"],
    ["bot-ok", "bot-room"],
  ]);
  assert.equal(warn.mock.calls.length >= 1, true);
  warn.mockRestore();
});

test("fetchChannelNames short-circuits empty input and handles bot initialization failure", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const empty = await fetchChannelNames([], [
    {
      token: "token",
      method: "user",
      channelIds: ["x"],
    },
  ]);

  discordSourceMocks.clientBlueprints.push({
    ready: false,
    login: vi.fn().mockRejectedValue(new Error("login failed")),
  });

  const result = await fetchChannelNames(
    ["bot-only"],
    [
      {
        token: "bot-token",
        method: "bot",
        channelIds: ["bot-only"],
      },
      {
        token: "unused-token",
        method: "something-else",
        channelIds: ["bot-only"],
      },
    ],
  );

  assert.equal(empty.size, 0);
  assert.equal(result.size, 0);
  assert.equal(warn.mock.calls.length >= 1, true);
  warn.mockRestore();
});

test("fetchMessagesFromSource delegates to provider and bot fetch errors are surfaced", async () => {
  const providerError = new Error("bad channel");
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  discordSourceMocks.clientBlueprints.push({
    ready: true,
    channelsFetch: vi.fn().mockResolvedValue({ name: "not-text-channel" }),
  });

  await assert.rejects(
    () =>
      fetchMessagesFromSource(
        {
          _id: "src-error",
          name: "Discord Bot",
          type: "discord",
          method: "bot",
          token: "bot-token",
          channelIds: ["bad-room"],
        } as never,
        5,
      ),
    /not a text channel/,
  );

  discordSourceMocks.axiosGet.mockRejectedValueOnce(providerError);

  await assert.rejects(
    () =>
      fetchMessagesFromSource(
        {
          _id: "src-user-error",
          name: "Discord User",
          type: "discord",
          method: "user",
          token: "user-token",
          channelIds: ["bad-room"],
        } as never,
        5,
      ),
    /bad channel/,
  );

  discordSourceMocks.axiosGet.mockRejectedValueOnce({
    __axiosError: true,
    response: {
      status: 404,
      data: { message: "Unknown Channel", code: 10003 },
    },
    message: "Request failed with status code 404",
  });

  await assert.rejects(
    () =>
      fetchMessagesFromSource(
        {
          _id: "src-user-http-error",
          name: "Discord User",
          type: "discord",
          method: "user",
          token: "user-token",
          channelIds: ["missing-room"],
        } as never,
        5,
      ),
    /status=404 code=10003: Unknown Channel.*response=\{"message":"Unknown Channel","code":10003\}/,
  );

  assert.equal(errorSpy.mock.calls.length >= 2, true);
  errorSpy.mockRestore();
});

test("disconnectDiscord destroys ready clients and clears the client cache", async () => {
  const readyClient = {
    isReady: () => true,
    destroy: vi.fn().mockResolvedValue(undefined),
  } as never;
  const notReadyClient = {
    isReady: () => false,
    destroy: vi.fn().mockResolvedValue(undefined),
  } as never;

  DiscordSourceProvider._botClients.set("ready", readyClient);
  DiscordSourceProvider._botClients.set("not-ready", notReadyClient);

  await disconnectDiscord();

  assert.equal((readyClient as any).destroy.mock.calls.length, 1);
  assert.equal((notReadyClient as any).destroy.mock.calls.length, 0);
  assert.equal(DiscordSourceProvider._botClients.size, 0);
});
