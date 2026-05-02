import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { NextRequest } from "next/server";

const routeMocks = vi.hoisted(() => ({
  getCronSettings: vi.fn(),
  setCronSettings: vi.fn(),
  syncCronJobs: vi.fn(),
  pullCronJobStatus: vi.fn(),
  pullCloudJobConfigs: vi.fn(),
  checkCronSetup: vi.fn(),
  disableManagedCloudCronJobs: vi.fn(),
}));

vi.mock("../_lib/action-auth", () => ({
  verifyActionAuth: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/cron-config", () => ({
  CRON_PROVIDER_OPTIONS: [
    { value: "cron-job.org", label: "cron-job.org", description: "cloud" },
    { value: "app", label: "This App (VPS)", description: "local" },
  ],
  DEFAULT_CRON_JOBS: [
    {
      id: "",
      type: "signal-check",
      enabled: true,
      title: "CopyTrade - Signal Check",
      url: "/api/cron/signal-check",
      schedule: { minutes: 5, hours: [], mdays: [], months: [], wdays: [] },
    },
  ],
  getCronSettings: routeMocks.getCronSettings,
  setCronSettings: routeMocks.setCronSettings,
  syncCronJobs: routeMocks.syncCronJobs,
  pullCronJobStatus: routeMocks.pullCronJobStatus,
  pullCloudJobConfigs: routeMocks.pullCloudJobConfigs,
  checkCronSetup: routeMocks.checkCronSetup,
  disableManagedCloudCronJobs: routeMocks.disableManagedCloudCronJobs,
}));

function buildJob() {
  return {
    id: "",
    type: "signal-check",
    enabled: true,
    title: "CopyTrade - Signal Check",
    url: "/api/cron/signal-check",
    schedule: { minutes: 5, hours: [], mdays: [], months: [], wdays: [] },
  };
}

function buildRequest(body: unknown, method: string = "POST") {
  return {
    json: async () => body,
    headers: new Headers(),
    method,
  } as unknown as NextRequest;
}

/** Build an empty request for PUT/DELETE calls that only need headers */
function buildEmptyRequest(method: string = "PUT") {
  return {
    json: async () => ({}),
    headers: new Headers(),
    method,
  } as unknown as NextRequest;
}

async function loadRouteModule() {
  return import("./route");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  delete process.env.CRON_SECRET;
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "cron-job.org",
    baseUrl: "https://example.com",
    jobs: [buildJob()],
  });
  routeMocks.setCronSettings.mockImplementation(async (settings) => settings);
  routeMocks.syncCronJobs.mockResolvedValue({ synced: 1, errors: [] });
  routeMocks.pullCronJobStatus.mockResolvedValue({
    jobs: [{ type: "signal-check", status: "active" }],
    errors: [],
  });
  routeMocks.pullCloudJobConfigs.mockResolvedValue({
    jobs: [buildJob()],
    baseUrl: "https://cloud.example.com",
    errors: [],
  });
  routeMocks.checkCronSetup.mockResolvedValue({
    allConfigured: true,
    missing: [],
    details: [{ type: "signal-check", configured: true, enabled: true }],
  });
  routeMocks.disableManagedCloudCronJobs.mockResolvedValue({
    disabled: 1,
    errors: [],
  });
});

test("GET returns app-provider live status from backend cron status", async () => {
  process.env.CRON_SECRET = " secret ";
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "app",
    baseUrl: "",
    jobs: [buildJob()],
  });
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    assert.equal(input, "http://localhost:3001/api/cron/status");
    assert.deepEqual(init?.headers, {
      authorization: "Bearer secret",
    });
    return {
      ok: true,
      json: async () => ({
        cronStatus: {
          "signal-check": {
            running: true,
            progress: "working",
            result: "success",
            completedAt: "2026-04-27T03:10:00.000Z",
          },
        },
      }),
    } satisfies Partial<Response>;
  });
  vi.stubGlobal("fetch", fetchMock);

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(json.success, true);
  assert.equal(json.settings.provider, "app");
  assert.equal(json.liveStatus[0].running, true);
  assert.equal(json.liveStatus[0].progress, "working");
  assert.equal(json.setupCheck.allConfigured, true);
});

test("GET app-provider respects BACKEND_URL trimming and startedAt fallback", async () => {
  vi.resetModules();
  process.env.BACKEND_URL = "http://backend.example.com///";
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "app",
    baseUrl: "",
    jobs: [buildJob()],
  });
  const fetchMock = vi.fn(async (input: string) => {
    assert.equal(input, "http://backend.example.com/api/cron/status");
    return {
      ok: true,
      json: async () => ({
        cronStatus: {
          "signal-check": {
            startedAt: "2026-04-27T03:10:00.000Z",
          },
        },
      }),
    } satisfies Partial<Response>;
  });
  vi.stubGlobal("fetch", fetchMock);

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(json.liveStatus[0].lastExecution, "2026-04-27T03:10:00.000Z");
  delete process.env.BACKEND_URL;
});

test("GET returns app-provider status even when backend status fetch fails", async () => {
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "app",
    baseUrl: "",
    jobs: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    })),
  );

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(json.success, true);
  assert.equal(json.liveErrors.length, 1);
  assert.equal(json.settings.jobs.length, 3);
});

test("GET app-provider handles non-Error backend failures and disabled jobs", async () => {
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "app",
    baseUrl: "",
    jobs: [{ ...buildJob(), enabled: false }],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw "backend-string";
    }),
  );

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(json.success, true);
  assert.deepEqual(json.liveErrors, ["Backend cron status unavailable"]);
  assert.equal(json.liveStatus[0].status, "disabled");
  assert.equal(json.liveStatus[0].lastExecution, undefined);
});

test("GET app-provider handles missing backend cronStatus payloads", async () => {
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "app",
    baseUrl: "",
    jobs: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })),
  );

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(json.success, true);
  assert.equal(json.liveStatus.length, 3);
  assert.equal(json.liveStatus[0].running, false);
});

test("GET app-provider falls back to the default backend URL and default jobs", async () => {
  vi.resetModules();
  process.env.BACKEND_URL = "";
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "app",
    baseUrl: "",
    jobs: [],
  });
  const fetchMock = vi.fn(async (input: string) => {
    assert.equal(input, "http://localhost:3001/api/cron/status");
    return {
      ok: true,
      json: async () => ({}),
    } satisfies Partial<Response>;
  });
  vi.stubGlobal("fetch", fetchMock);

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(json.settings.jobs.length, 3);
  assert.equal(json.liveStatus.length, 3);
  delete process.env.BACKEND_URL;
});

test("GET returns cloud-provider fallbacks when remote checks fail", async () => {
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "cron-job.org",
    baseUrl: "",
    jobs: [],
  });
  routeMocks.pullCronJobStatus.mockRejectedValue(new Error("offline"));
  routeMocks.checkCronSetup.mockRejectedValue(new Error("missing"));

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(json.success, true);
  assert.equal(json.liveErrors[0], "API unavailable");
  assert.equal(json.setupCheck.allConfigured, false);
  assert.equal(json.settings.jobs.length, 3);
});

test("GET returns 500 when loading settings throws", async () => {
  routeMocks.getCronSettings.mockRejectedValue(new Error("boom"));

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(response.status, 500);
  assert.equal(json.success, false);
  assert.equal(json.error, "boom");
});

test("GET returns unknown error text for non-Error failures", async () => {
  routeMocks.getCronSettings.mockRejectedValue("boom-string");

  const { GET } = await loadRouteModule();
  const response = await GET();
  const json = await response.json();

  assert.equal(response.status, 500);
  assert.equal(json.error, "Unknown error");
});

test("PUT rejects cloud sync when provider is not cron-job.org", async () => {
  routeMocks.getCronSettings.mockResolvedValue({
    provider: "app",
    baseUrl: "",
    jobs: [buildJob()],
  });

  const { PUT } = await loadRouteModule();
  const response = await PUT(buildEmptyRequest());
  const json = await response.json();

  assert.equal(response.status, 400);
  assert.equal(json.success, false);
});

test("PUT saves pulled cloud settings and tolerates live-status fetch failures", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  routeMocks.pullCloudJobConfigs.mockResolvedValue({
    jobs: [],
    baseUrl: "https://cloud.example.com",
    errors: [],
  });
  routeMocks.pullCronJobStatus.mockRejectedValue(new Error("status down"));

  const { PUT } = await loadRouteModule();
  const response = await PUT(buildEmptyRequest());
  const json = await response.json();

  assert.equal(json.success, true);
  assert.equal(json.settings.provider, "cron-job.org");
  assert.equal(json.settings.jobs.length, 1);
  assert.equal(routeMocks.setCronSettings.mock.calls.length, 1);
  assert.equal(warnSpy.mock.calls.length, 1);
  warnSpy.mockRestore();
});

test("PUT preserves pulled cloud jobs when the provider returns them", async () => {
  routeMocks.pullCloudJobConfigs.mockResolvedValue({
    jobs: [{ ...buildJob(), id: "cloud-1" }],
    baseUrl: "https://cloud.example.com",
    errors: [],
  });

  const { PUT } = await loadRouteModule();
  const response = await PUT(buildEmptyRequest());
  const json = await response.json();

  assert.equal(json.success, true);
  assert.equal(json.settings.jobs[0].id, "cloud-1");
});

test("PUT returns error when cloud pull reports only failures", async () => {
  routeMocks.pullCloudJobConfigs.mockResolvedValue({
    jobs: [],
    baseUrl: "",
    errors: ["cloud down"],
  });

  const { PUT } = await loadRouteModule();
  const response = await PUT(buildEmptyRequest());
  const json = await response.json();

  assert.equal(response.status, 500);
  assert.equal(json.error, "cloud down");
});

test("PUT returns 500 when pull throws unexpectedly", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  routeMocks.pullCloudJobConfigs.mockRejectedValue(new Error("explode"));

  const { PUT } = await loadRouteModule();
  const response = await PUT(buildEmptyRequest());
  const json = await response.json();

  assert.equal(response.status, 500);
  assert.equal(json.error, "explode");
  assert.equal(errorSpy.mock.calls.length, 1);
  errorSpy.mockRestore();
});

test("PUT returns unknown error text for non-Error failures", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  routeMocks.pullCloudJobConfigs.mockRejectedValue("explode-string");

  const { PUT } = await loadRouteModule();
  const response = await PUT(buildEmptyRequest());
  const json = await response.json();

  assert.equal(response.status, 500);
  assert.equal(json.error, "Unknown error");
  assert.equal(errorSpy.mock.calls.length, 1);
  errorSpy.mockRestore();
});

test("POST validates required jobs and job schedules", async () => {
  const { POST } = await loadRouteModule();

  const noJobs = await POST(buildRequest({ provider: "app", jobs: [] }));
  assert.equal(noJobs.status, 400);
  assert.equal(
    (await noJobs.json()).error,
    "At least one cron job is required",
  );

  const invalidJob = await POST(
    buildRequest({
      provider: "app",
      jobs: [
        {
          ...buildJob(),
          title: "",
          schedule: { ...buildJob().schedule, minutes: 0 },
        },
      ],
    }),
  );
  assert.equal(invalidJob.status, 400);
  assert.ok((await invalidJob.json()).error.includes("Invalid job config"));

  const invalidSchedule = await POST(
    buildRequest({
      provider: "app",
      jobs: [
        { ...buildJob(), schedule: { ...buildJob().schedule, minutes: 0 } },
      ],
    }),
  );
  assert.equal(invalidSchedule.status, 400);
  assert.ok((await invalidSchedule.json()).error.includes("schedule.minutes"));
});

test("POST requires a base URL for cron-job.org provider", async () => {
  const { POST } = await loadRouteModule();
  const response = await POST(
    buildRequest({
      provider: "cron-job.org",
      baseUrl: "",
      jobs: [buildJob()],
    }),
  );
  const json = await response.json();

  assert.equal(response.status, 400);
  assert.ok(json.error.includes("Base URL is required"));
});

test("POST returns failure when cron-job.org sync fails for all jobs", async () => {
  routeMocks.syncCronJobs.mockResolvedValue({
    synced: 0,
    errors: ["sync broke"],
  });

  const { POST } = await loadRouteModule();
  const response = await POST(
    buildRequest({
      provider: "cron-job.org",
      baseUrl: "https://app.example.com/",
      jobs: [buildJob()],
    }),
  );
  const json = await response.json();

  assert.equal(json.success, false);
  assert.ok(json.error.includes("sync broke"));
  assert.equal(routeMocks.setCronSettings.mock.calls.length, 2);
});

test("POST succeeds for cron-job.org and app providers", async () => {
  const { POST } = await loadRouteModule();

  const cloudResponse = await POST(
    buildRequest({
      provider: "cron-job.org",
      baseUrl: "https://app.example.com/",
      jobs: [buildJob()],
    }),
  );
  const cloudJson = await cloudResponse.json();
  assert.equal(cloudJson.success, true);
  assert.equal(cloudJson.synced, 1);

  routeMocks.disableManagedCloudCronJobs.mockRejectedValue(
    new Error("disable failed"),
  );
  const appResponse = await POST(
    buildRequest({
      provider: "app",
      jobs: [buildJob()],
    }),
  );
  const appJson = await appResponse.json();
  assert.equal(appJson.success, true);
  assert.equal(appJson.provider, "app");
  assert.equal(appJson.disabledCloudJobs, 0);
  assert.deepEqual(appJson.errors, ["disable failed"]);

  routeMocks.disableManagedCloudCronJobs.mockRejectedValue("disable-string");
  const appResponseUnknown = await POST(
    buildRequest({
      provider: "app",
      jobs: [buildJob()],
    }),
  );
  const appUnknownJson = await appResponseUnknown.json();
  assert.deepEqual(appUnknownJson.errors, ["Unknown disable error"]);
});

test("POST returns 500 when request parsing fails", async () => {
  const { POST } = await loadRouteModule();
  const response = await POST({
    json: async () => {
      throw new Error("bad body");
    },
  } as unknown as NextRequest);
  const json = await response.json();

  assert.equal(response.status, 500);
  assert.equal(json.error, "bad body");
});

test("POST returns unknown error text for non-Error failures", async () => {
  const { POST } = await loadRouteModule();
  const response = await POST({
    json: async () => {
      throw "bad-string";
    },
  } as unknown as NextRequest);
  const json = await response.json();

  assert.equal(response.status, 500);
  assert.equal(json.error, "Unknown error");
});
