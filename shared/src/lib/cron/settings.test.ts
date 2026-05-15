import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const cronSettingsMocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock("../database/index", () => ({
  connectDB: cronSettingsMocks.connectDB,
}));

vi.mock("mongoose", async () => {
  const actual = await vi.importActual<typeof import("mongoose")>("mongoose");
  return {
    ...actual,
    default: {
      ...actual.default,
      model: vi.fn(() => ({})),
    },
    models: {
      CronSettings: {
        findOne: cronSettingsMocks.findOne,
        findOneAndUpdate: cronSettingsMocks.findOneAndUpdate,
      },
    },
  };
});

import {
  DEFAULT_CRON_PROVIDER,
  createDefaultCronJobs,
  getCronSettings,
  normalizeCronProvider,
  normalizeCronSettings,
  setCronSettings,
} from "./settings";

beforeEach(() => {
  cronSettingsMocks.connectDB.mockReset();
  cronSettingsMocks.findOne.mockReset();
  cronSettingsMocks.findOneAndUpdate.mockReset();
});

test("normalizeCronProvider falls back to the default provider", () => {
  assert.equal(normalizeCronProvider("app"), "app");
  assert.equal(normalizeCronProvider("cron-job.org"), "cron-job.org");
  assert.equal(normalizeCronProvider("unknown"), DEFAULT_CRON_PROVIDER);
  assert.equal(normalizeCronProvider(undefined), DEFAULT_CRON_PROVIDER);
});

test("normalizeCronSettings fills defaults for provider and jobs", () => {
  const settings = normalizeCronSettings({
    provider: "app",
    jobs: [
      {
        id: "123",
        type: "signal-check",
        enabled: false,
        title: "",
        url: "",
        schedule: {
          minutes: 0,
          hours: [1],
          mdays: [],
          months: [],
          wdays: [],
        },
      },
    ],
  });

  assert.equal(settings.provider, "app");
  assert.equal(settings.baseUrl, "");
  assert.equal(settings.jobs[0]?.id, "123");
  assert.equal(settings.jobs[0]?.title, "CopyTrade - Signal Check");
  assert.equal(settings.jobs[0]?.url, "/api/cron/signal-check");
  assert.equal(settings.jobs[0]?.schedule.minutes, 5);
  assert.deepEqual(settings.jobs[0]?.schedule.hours, [1]);
});

test("normalizeCronSettings falls back for unknown jobs and clones defaults", () => {
  const settings = normalizeCronSettings({
    provider: "unknown",
    baseUrl: "  https://example.test  ",
    jobs: [
      {
        type: "custom-job",
        schedule: {
          minutes: Number.NaN,
          hours: "bad" as unknown as number[],
          mdays: undefined as unknown as number[],
          months: undefined as unknown as number[],
          wdays: undefined as unknown as number[],
        },
      },
    ],
  });

  assert.equal(settings.provider, DEFAULT_CRON_PROVIDER);
  assert.equal(settings.baseUrl, "https://example.test");
  assert.equal(settings.jobs[0]?.enabled, true);
  assert.equal(settings.jobs[0]?.title, "Cron Job");
  assert.equal(settings.jobs[0]?.url, "");
  assert.equal(settings.jobs[0]?.schedule.minutes, 5);
  assert.deepEqual(settings.jobs[0]?.schedule.hours, []);

  const defaults = createDefaultCronJobs();
  defaults[0]!.title = "changed";
  assert.notEqual(createDefaultCronJobs()[0]?.title, "changed");

  const missingType = normalizeCronSettings({
    jobs: [
      {
        enabled: undefined,
        title: "",
        url: "",
        schedule: {
          minutes: 1,
          hours: [],
          mdays: [],
          months: [],
          wdays: [],
        },
      },
    ],
  });
  assert.equal(missingType.jobs[0]?.type, "");
  assert.equal(missingType.jobs[0]?.enabled, true);
});

test("getCronSettings returns normalized defaults when the database is empty", async () => {
  cronSettingsMocks.findOne.mockReturnValue({
    sort: vi.fn(() => ({
      lean: vi.fn(async () => null),
    })),
  });

  const settings = await getCronSettings();

  assert.equal(settings.provider, DEFAULT_CRON_PROVIDER);
  assert.deepEqual(settings.jobs, createDefaultCronJobs());
});

test("getCronSettings warns and returns defaults when database access fails", async () => {
  cronSettingsMocks.findOne.mockImplementation(() => {
    throw new Error("db down");
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const settings = await getCronSettings();

  assert.equal(settings.provider, DEFAULT_CRON_PROVIDER);
  assert.deepEqual(settings.jobs, createDefaultCronJobs());
  assert.equal(warnSpy.mock.calls.length, 1);
  warnSpy.mockRestore();
});

test("getCronSettings string errors also fall back to defaults", async () => {
  cronSettingsMocks.findOne.mockImplementation(() => {
    throw "db string";
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const settings = await getCronSettings();

  assert.equal(settings.provider, DEFAULT_CRON_PROVIDER);
  assert.equal(settings.jobs.length, 3);
  assert.deepEqual(warnSpy.mock.calls[0], [
    "Failed to fetch cron settings from DB:",
    "db string",
  ]);
  warnSpy.mockRestore();
});

test("setCronSettings persists normalized settings", async () => {
  cronSettingsMocks.findOneAndUpdate.mockReturnValue({
    lean: vi.fn(async () => ({
      provider: "app",
      baseUrl: " https://example.com ",
      jobs: [
        {
          id: "",
          type: "signal-check",
          enabled: true,
          title: "Signal",
          url: "/api/cron/signal-check",
          schedule: {
            minutes: 10,
            hours: [],
            mdays: [],
            months: [],
            wdays: [],
          },
        },
      ],
    })),
  });

  const settings = await setCronSettings({
    provider: "app",
    baseUrl: " https://example.com ",
    jobs: [
      {
        id: "",
        type: "signal-check",
        enabled: true,
        title: "Signal",
        url: "/api/cron/signal-check",
        schedule: {
          minutes: 10,
          hours: [],
          mdays: [],
          months: [],
          wdays: [],
        },
      },
    ],
  });

  assert.deepEqual(cronSettingsMocks.findOneAndUpdate.mock.calls[0]?.[1], {
    $set: {
      provider: "app",
      baseUrl: "https://example.com",
      jobs: [
        {
          id: "",
          type: "signal-check",
          enabled: true,
          title: "Signal",
          url: "/api/cron/signal-check",
          schedule: {
            minutes: 10,
            hours: [],
            mdays: [],
            months: [],
            wdays: [],
          },
        },
      ],
    },
  });
  assert.equal(settings.provider, "app");
  assert.equal(settings.baseUrl, "https://example.com");
});
