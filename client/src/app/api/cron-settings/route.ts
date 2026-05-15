import { NextRequest, NextResponse } from "next/server";
import {
  checkCronSetup,
  CRON_PROVIDER_OPTIONS,
  DEFAULT_CRON_JOBS,
  disableManagedCloudCronJobs,
  getCronSettings,
  pullCloudJobConfigs,
  pullCronJobStatus,
  setCronSettings,
  syncCronJobs,
} from "@/lib/cron-config";
import { verifyActionAuth } from "../_lib/action-auth";
import {
  createDefaultCronJobs,
  normalizeCronProvider,
  type CronJobConfig,
  type CronSettingsType,
} from "@copytrade/shared/lib/cron/settings";
import type { CronRunStatus } from "@copytrade/shared/lib/cron/status";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.BACKEND_URL || "http://localhost:3001"
).replace(/\/+$/, "");

type CronLiveStatus = {
  type: string;
  title: string;
  enabled: boolean;
  url: string;
  lastExecution?: string;
  nextExecution?: string;
  status: "active" | "missing" | "disabled";
  running?: boolean;
  result?: CronRunStatus["result"];
  progress?: string;
};

function getBackendAuthHeaders() {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const headers: Record<string, string> = {};
  if (cronSecret) {
    headers.authorization = `Bearer ${cronSecret}`;
  }
  return headers;
}

async function fetchBackendCronStatus(): Promise<{
  cronStatus: Record<string, CronRunStatus>;
}> {
  const res = await fetch(`${BACKEND_URL}/api/cron/status`, {
    headers: getBackendAuthHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend cron status failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return {
    cronStatus: json.cronStatus || {},
  };
}

function buildSettingsResponse(settings: CronSettingsType) {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    jobs: settings.jobs,
  };
}

async function getAppProviderStatus(settings: CronSettingsType): Promise<{
  liveStatus: CronLiveStatus[];
  liveErrors: string[];
  setupCheck: {
    allConfigured: boolean;
    missing: string[];
    details: Array<{
      type: string;
      configured: boolean;
      enabled: boolean;
    }>;
  };
}> {
  const jobs = settings.jobs;
  const liveErrors: string[] = [];
  let backendStatus: Record<string, CronRunStatus> = {};

  try {
    const result = await fetchBackendCronStatus();
    backendStatus = result.cronStatus;
  } catch (error) {
    liveErrors.push(
      error instanceof Error
        ? error.message
        : "Backend cron status unavailable",
    );
  }

  const liveStatus = jobs.map((job) => {
    const runStatus = backendStatus[job.type];

    return {
      type: job.type,
      title: job.title,
      enabled: job.enabled,
      url: job.url,
      status: job.enabled ? "active" : "disabled",
      running: runStatus?.running ?? false,
      result: runStatus?.result ?? null,
      progress: runStatus?.progress || "",
      lastExecution:
        runStatus?.completedAt || runStatus?.startedAt || undefined,
    } satisfies CronLiveStatus;
  });

  return {
    liveStatus,
    liveErrors,
    setupCheck: {
      allConfigured: true,
      missing: [],
      details: jobs.map((job) => ({
        type: job.type,
        configured: true,
        enabled: job.enabled,
      })),
    },
  };
}

function validateJobs(jobs: unknown): jobs is CronJobConfig[] {
  return Array.isArray(jobs) && jobs.length > 0;
}

function validateJobConfig(job: CronJobConfig): string | null {
  if (!job.type || !job.title || !job.url) {
    return `Invalid job config: ${JSON.stringify(job)}`;
  }

  if (
    !job.schedule ||
    typeof job.schedule.minutes !== "number" ||
    job.schedule.minutes < 1
  ) {
    return `Job "${job.type}": schedule.minutes must be >= 1`;
  }

  return null;
}

export async function GET() {
  try {
    const settings = await getCronSettings();
    const normalizedSettings: CronSettingsType = {
      provider: normalizeCronProvider(settings.provider),
      baseUrl: settings.baseUrl,
      jobs: settings.jobs.length > 0 ? settings.jobs : createDefaultCronJobs(),
    };

    if (normalizedSettings.provider === "app") {
      const appStatus = await getAppProviderStatus(normalizedSettings);
      return NextResponse.json({
        success: true,
        settings: buildSettingsResponse(normalizedSettings),
        liveStatus: appStatus.liveStatus,
        liveErrors: appStatus.liveErrors,
        setupCheck: appStatus.setupCheck,
        backendUrl: BACKEND_URL,
        providerOptions: CRON_PROVIDER_OPTIONS,
      });
    }

    const [liveStatus, setupCheck] = await Promise.all([
      pullCronJobStatus().catch(() => ({
        jobs: [],
        errors: ["API unavailable"],
      })),
      checkCronSetup().catch(() => ({
        allConfigured: false,
        missing: ["signal-check", "position-monitor", "tp-sl-monitor"],
        details: [],
      })),
    ]);

    return NextResponse.json({
      success: true,
      settings: buildSettingsResponse(normalizedSettings),
      liveStatus: liveStatus.jobs,
      liveErrors: liveStatus.errors,
      setupCheck,
      backendUrl: BACKEND_URL,
      providerOptions: CRON_PROVIDER_OPTIONS,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const authError = verifyActionAuth(request);
  if (authError) return authError;

  try {
    const currentSettings = await getCronSettings();
    if (normalizeCronProvider(currentSettings.provider) !== "cron-job.org") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cloud sync is only available when cron provider is cron-job.org",
        },
        { status: 400 },
      );
    }

    const cloudResult = await pullCloudJobConfigs();

    if (cloudResult.errors.length > 0 && cloudResult.jobs.length === 0) {
      return NextResponse.json(
        { success: false, error: cloudResult.errors.join("; ") },
        { status: 500 },
      );
    }

    const settings: CronSettingsType = {
      provider: "cron-job.org",
      baseUrl: cloudResult.baseUrl,
      jobs:
        cloudResult.jobs.length > 0
          ? cloudResult.jobs
          : DEFAULT_CRON_JOBS.map((job) => ({ ...job, id: "" })),
    };

    await setCronSettings(settings);

    const liveStatus = await pullCronJobStatus().catch((error) => {
      console.warn("[cron-settings PUT] Failed to fetch live status:", error);
      return { jobs: [], errors: [] };
    });

    return NextResponse.json({
      success: true,
      settings: buildSettingsResponse(settings),
      liveStatus: liveStatus.jobs,
      errors: cloudResult.errors,
      pulled: cloudResult.jobs.length,
    });
  } catch (error) {
    console.error("[cron-settings PUT] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = verifyActionAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const provider = normalizeCronProvider(body.provider);

    if (!validateJobs(body.jobs)) {
      return NextResponse.json(
        { success: false, error: "At least one cron job is required" },
        { status: 400 },
      );
    }

    for (const job of body.jobs as CronJobConfig[]) {
      const validationError = validateJobConfig(job);
      if (validationError) {
        return NextResponse.json(
          { success: false, error: validationError },
          { status: 400 },
        );
      }
    }

    if (provider === "cron-job.org") {
      if (!body.baseUrl || !body.baseUrl.startsWith("http")) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Base URL is required for cron-job.org (e.g. https://your-backend.com)",
          },
          { status: 400 },
        );
      }
    }

    const settings: CronSettingsType = {
      provider,
      baseUrl:
        typeof body.baseUrl === "string"
          ? body.baseUrl.replace(/\/+$/, "")
          : "",
      jobs: body.jobs as CronJobConfig[],
    };

    await setCronSettings(settings);

    if (provider === "cron-job.org") {
      const syncResult = await syncCronJobs(settings);
      await setCronSettings(settings);

      if (syncResult.errors.length > 0 && syncResult.synced === 0) {
        return NextResponse.json({
          success: false,
          error: `Failed to sync all jobs: ${syncResult.errors.join("; ")}`,
        });
      }

      return NextResponse.json({
        success: true,
        synced: syncResult.synced,
        errors: syncResult.errors,
        settings: buildSettingsResponse(settings),
      });
    }

    const disableResult = await disableManagedCloudCronJobs().catch(
      (error) => ({
        disabled: 0,
        errors: [
          error instanceof Error ? error.message : "Unknown disable error",
        ],
      }),
    );

    return NextResponse.json({
      success: true,
      settings: buildSettingsResponse(settings),
      provider,
      disabledCloudJobs: disableResult.disabled,
      errors: disableResult.errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
