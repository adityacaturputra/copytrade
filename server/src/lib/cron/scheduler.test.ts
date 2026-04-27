import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import * as sharedCronSettings from "@copytrade/shared/lib/cron-settings";
import type { CronJobConfig } from "@copytrade/shared/lib/cron-settings";
import {
  createAppCronScheduler,
  startAppCronScheduler,
  shouldRunCronJob,
  stopAppCronScheduler,
} from "./scheduler";

function buildJob(overrides: Partial<CronJobConfig> = {}): CronJobConfig {
  return {
    id: "",
    type: "signal-check",
    enabled: true,
    title: "Signal",
    url: "/api/cron/signal-check",
    schedule: {
      minutes: 5,
      hours: [],
      mdays: [],
      months: [],
      wdays: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-27T03:10:00.000Z"));
});

afterEach(() => {
  stopAppCronScheduler();
  vi.useRealTimers();
});

test("shouldRunCronJob honors interval and optional date filters", () => {
  const parts = {
    year: 2026,
    month: 4,
    day: 27,
    hour: 10,
    minute: 15,
    weekday: 1,
  };

  assert.equal(shouldRunCronJob(buildJob(), parts), true);
  assert.equal(shouldRunCronJob(buildJob({ enabled: false }), parts), false);
  assert.equal(
    shouldRunCronJob(
      buildJob({
        schedule: {
          minutes: 5,
          hours: [],
          mdays: [26],
          months: [],
          wdays: [],
        },
      }),
      parts,
    ),
    false,
  );
  assert.equal(
    shouldRunCronJob(
      buildJob({
        schedule: {
          minutes: 5,
          hours: [],
          mdays: [],
          months: [3],
          wdays: [],
        },
      }),
      parts,
    ),
    false,
  );
  assert.equal(
    shouldRunCronJob(
      buildJob({
        schedule: {
          minutes: 5,
          hours: [],
          mdays: [],
          months: [],
          wdays: [0],
        },
      }),
      parts,
    ),
    false,
  );
  assert.equal(
    shouldRunCronJob(
      buildJob({
        schedule: undefined as unknown as CronJobConfig["schedule"],
      }),
      parts,
    ),
    false,
  );
  assert.equal(
    shouldRunCronJob(
      buildJob({
        schedule: {
          minutes: 7,
          hours: [],
          mdays: [],
          months: [],
          wdays: [],
        },
      }),
      parts,
    ),
    false,
  );
  assert.equal(
    shouldRunCronJob(
      buildJob({
        schedule: {
          minutes: 5,
          hours: [9],
          mdays: [],
          months: [],
          wdays: [],
        },
      }),
      parts,
    ),
    false,
  );
});

test("app cron scheduler triggers enabled jobs only once per matching minute", async () => {
  const fetchImpl = vi.fn(async (..._args: any[]) => ({
    ok: true,
    status: 200,
    text: async () => "",
  }));

  const scheduler = createAppCronScheduler({
    baseUrl: "http://127.0.0.1:3001",
    authorizationHeader: "Bearer secret",
    pollIntervalMs: 1000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getSettings: async () => ({
      provider: "app",
      baseUrl: "",
      jobs: [
        buildJob(),
        buildJob({
          type: "position-monitor",
          url: "/api/cron/position-monitor",
          schedule: {
            minutes: 30,
            hours: [],
            mdays: [],
            months: [],
            wdays: [],
          },
        }),
      ],
    }),
    timezone: "Asia/Jakarta",
    logger: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });

  await vi.runOnlyPendingTimersAsync();
  await scheduler.tick();
  await scheduler.tick();

  assert.equal(fetchImpl.mock.calls.length, 1);
  const firstCall = fetchImpl.mock.calls[0] as [string, RequestInit];
  assert.equal(firstCall[0], "http://127.0.0.1:3001/api/cron/signal-check");
  assert.deepEqual(firstCall[1], {
    method: "POST",
    headers: {
      authorization: "Bearer secret",
    },
  });
  scheduler.stop();
});

test("app cron scheduler skips when provider is not app", async () => {
  const fetchImpl = vi.fn();
  const scheduler = createAppCronScheduler({
    baseUrl: "http://127.0.0.1:3001",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getSettings: async () => ({
      provider: "cron-job.org",
      baseUrl: "https://example.com",
      jobs: [buildJob()],
    }),
    pollIntervalMs: 1000,
    logger: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });

  await scheduler.tick();

  assert.equal(fetchImpl.mock.calls.length, 0);
  scheduler.stop();
});

test("app cron scheduler handles conflicts, failures, in-flight ticks, and singleton lifecycle", async () => {
  let clearArg: unknown;
  let intervalCallback: (() => void) | undefined;
  let resolveSettings: (() => void) | undefined;
  let currentTime = new Date("2026-04-27T03:10:00.000Z");
  let mode: "custom" | "pending" | "normal" | "reject" | "cloud" = "custom";
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: async () => "busy",
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "broken",
    });
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const getSettings = vi.fn(async () => {
    if (mode === "custom") {
      return {
        provider: "app",
        baseUrl: "",
        jobs: [
          buildJob({
            type: "custom",
            url: "/api/cron/custom",
          }),
        ],
      };
    }

    if (mode === "pending") {
      return new Promise((resolve) => {
        resolveSettings = () => {
          mode = "normal";
          resolve({
            provider: "app",
            baseUrl: "",
            jobs: [buildJob()],
          });
        };
      });
    }

    if (mode === "reject") {
      throw "plain failure";
    }

    if (mode === "cloud") {
      return {
        provider: "cron-job.org",
        baseUrl: "",
        jobs: [],
      };
    }

    return {
      provider: "app",
      baseUrl: "",
      jobs: [buildJob()],
    };
  });

  const scheduler = createAppCronScheduler({
    baseUrl: "http://127.0.0.1:3001/",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getSettings,
    pollIntervalMs: 1234,
    timezone: "Asia/Jakarta",
    now: () => currentTime,
    setIntervalImpl: ((cb: () => void, _ms?: number) => {
      intervalCallback = cb;
      return "interval-id" as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearIntervalImpl: ((value: unknown) => {
      clearArg = value;
    }) as typeof clearInterval,
    logger,
  });

  await Promise.resolve();
  await scheduler.tick();
  assert.equal(fetchImpl.mock.calls.length, 0);

  mode = "pending";
  const firstTick = scheduler.tick();
  await scheduler.tick();
  assert.equal(fetchImpl.mock.calls.length, 0);
  resolveSettings?.();
  await firstTick;
  assert.equal(fetchImpl.mock.calls.length, 1);

  currentTime = new Date("2026-04-27T03:15:00.000Z");
  await scheduler.tick();
  assert.equal(fetchImpl.mock.calls.length, 2);
  assert.equal(logger.log.mock.calls.length, 1);

  await scheduler.tick();
  assert.deepEqual(logger.error.mock.calls.at(-1), [
    "[AppCron] Scheduler tick failed:",
    "Cron trigger failed for signal-check (500): broken",
  ]);

  mode = "reject";
  intervalCallback?.();
  await Promise.resolve();
  assert.deepEqual(logger.error.mock.calls.at(-1), [
    "[AppCron] Scheduler tick failed:",
    "plain failure",
  ]);

  scheduler.stop();
  assert.equal(clearArg, "interval-id");

  stopAppCronScheduler();
  mode = "cloud";
  const first = startAppCronScheduler({
    baseUrl: "http://127.0.0.1:3001",
    fetchImpl: vi.fn() as unknown as typeof fetch,
    getSettings,
    setIntervalImpl: vi.fn(
      () => "singleton" as unknown as NodeJS.Timeout,
    ) as typeof setInterval,
    clearIntervalImpl: vi.fn() as typeof clearInterval,
    logger,
  });
  const second = startAppCronScheduler({
    baseUrl: "http://127.0.0.1:3001",
    fetchImpl: vi.fn() as unknown as typeof fetch,
    getSettings,
    setIntervalImpl: vi.fn(
      () => "other" as unknown as NodeJS.Timeout,
    ) as typeof setInterval,
    clearIntervalImpl: vi.fn() as typeof clearInterval,
    logger,
  });
  assert.equal(first, second);
  stopAppCronScheduler();
});

test("app cron scheduler can use default fetch, settings loader, and logger", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchMock);
  const settingsSpy = vi
    .spyOn(sharedCronSettings, "getCronSettings")
    .mockResolvedValue({
      provider: "app",
      baseUrl: "",
      jobs: [buildJob()],
    });
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  const scheduler = createAppCronScheduler({
    baseUrl: "http://127.0.0.1:3001",
    timezone: "Asia/Jakarta",
    now: () => new Date("2026-04-27T03:10:00.000Z"),
  });

  await Promise.resolve();
  await scheduler.tick();

  assert.equal(fetchMock.mock.calls.length >= 1, true);
  assert.equal(settingsSpy.mock.calls.length >= 1, true);

  scheduler.stop();
  settingsSpy.mockRestore();
  logSpy.mockRestore();
});

test("app cron scheduler tolerates missing zoned date parts defaults", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchMock);
  const settingsSpy = vi
    .spyOn(sharedCronSettings, "getCronSettings")
    .mockResolvedValue({
      provider: "app",
      baseUrl: "",
      jobs: [buildJob()],
    });
  const realDateTimeFormat = Intl.DateTimeFormat;
  Intl.DateTimeFormat = vi.fn(
    () =>
      ({
        formatToParts: () => [{ type: "weekday", value: "??" }],
      }) as Intl.DateTimeFormat,
  ) as unknown as typeof Intl.DateTimeFormat;

  try {
    const scheduler = createAppCronScheduler({
      baseUrl: "http://127.0.0.1:3001",
      now: () => new Date("2026-04-27T03:10:00.000Z"),
    });

    await Promise.resolve();
    await scheduler.tick();

    assert.equal(fetchMock.mock.calls.length >= 1, true);
    scheduler.stop();
  } finally {
    Intl.DateTimeFormat = realDateTimeFormat;
    settingsSpy.mockRestore();
  }
});

test("app cron scheduler falls back to Sunday when weekday is missing", async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchMock);
  const settingsSpy = vi
    .spyOn(sharedCronSettings, "getCronSettings")
    .mockResolvedValue({
      provider: "app",
      baseUrl: "",
      jobs: [buildJob()],
    });
  const realDateTimeFormat = Intl.DateTimeFormat;
  Intl.DateTimeFormat = vi.fn(
    () =>
      ({
        formatToParts: () => [],
      }) as Intl.DateTimeFormat,
  ) as unknown as typeof Intl.DateTimeFormat;

  try {
    const scheduler = createAppCronScheduler({
      baseUrl: "http://127.0.0.1:3001",
      now: () => new Date("2026-04-27T03:10:00.000Z"),
    });

    await Promise.resolve();
    await scheduler.tick();

    assert.equal(fetchMock.mock.calls.length >= 1, true);
    scheduler.stop();
  } finally {
    Intl.DateTimeFormat = realDateTimeFormat;
    settingsSpy.mockRestore();
  }
});
