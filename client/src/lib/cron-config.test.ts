import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

import {
  disableManagedCloudCronJobs,
  pullCloudJobConfigs,
  syncCronJobs,
} from "./cron-config";

beforeEach(() => {
  process.env.CRON_JOB_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CRON_JOB_API_KEY;
});

test("disableManagedCloudCronJobs treats empty PATCH responses as success", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        jobs: [
          {
            jobId: 101,
            url: "https://example.com/api/cron/signal-check",
          },
          {
            jobId: 202,
            url: "https://example.com/api/cron/tp-sl-monitor",
          },
        ],
      }),
    } satisfies Partial<Response>)
    .mockResolvedValue({
      ok: true,
      text: async () => "{}",
    } satisfies Partial<Response>);
  vi.stubGlobal("fetch", fetchMock);

  const result = await disableManagedCloudCronJobs();

  assert.deepEqual(result, { disabled: 2, errors: [] });
  assert.equal(fetchMock.mock.calls[1]?.[0], "https://api.cron-job.org/jobs/101");
  assert.equal(fetchMock.mock.calls[2]?.[0], "https://api.cron-job.org/jobs/202");
  assert.equal(
    fetchMock.mock.calls[1]?.[1]?.body,
    JSON.stringify({ job: { enabled: false } }),
  );
});

test("syncCronJobs creates cron-job.org payloads with expanded minute intervals", async () => {
  const settings = {
    provider: "cron-job.org" as const,
    baseUrl: "https://example.com",
    jobs: [
      {
        id: "",
        type: "signal-check",
        enabled: true,
        title: "CopyTrade - Signal Check",
        url: "/api/cron/signal-check",
        schedule: {
          minutes: 5,
          hours: [],
          mdays: [],
          months: [],
          wdays: [],
        },
      },
    ],
  };

  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ jobs: [] }),
    } satisfies Partial<Response>)
    .mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ jobId: 303 }),
    } satisfies Partial<Response>);
  vi.stubGlobal("fetch", fetchMock);

  const result = await syncCronJobs(settings);
  const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

  assert.deepEqual(result, { synced: 1, errors: [] });
  assert.equal(settings.jobs[0]?.id, "303");
  assert.deepEqual(payload.job.schedule.minutes, [
    0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
  ]);
  assert.equal(payload.job.schedule.timezone, "Asia/Jakarta");
  assert.equal(payload.job.url, "https://example.com/api/cron/signal-check");
});

test("pullCloudJobConfigs converts cron-job.org minute arrays back to UI intervals", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      jobs: [
        {
          jobId: 404,
          enabled: true,
          title: "CopyTrade - Position Monitor",
          url: "https://example.com/api/cron/position-monitor",
          schedule: {
            minutes: [0, 30],
            hours: [-1],
            mdays: [-1],
            months: [-1],
            wdays: [-1],
          },
        },
      ],
    }),
  } satisfies Partial<Response>);
  vi.stubGlobal("fetch", fetchMock);

  const result = await pullCloudJobConfigs();
  const positionMonitor = result.jobs.find((job) => job.type === "position-monitor");

  assert.equal(result.baseUrl, "https://example.com");
  assert.equal(positionMonitor?.schedule.minutes, 30);
});
