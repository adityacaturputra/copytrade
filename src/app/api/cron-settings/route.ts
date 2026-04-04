import { NextRequest, NextResponse } from "next/server";
import {
  getCronSettings,
  setCronSettings,
  syncCronJobs,
  pullCronJobStatus,
  pullCloudJobConfigs,
  checkCronSetup,
  DEFAULT_CRON_JOBS,
  CronSettingsType,
  CronJobConfig,
} from "@/lib/cron-config";

export const dynamic = "force-dynamic";

// GET /api/cron-settings — fetch cron config + live status from cron-job.org
export async function GET() {
  try {
    const [settings, liveStatus, setupCheck] = await Promise.all([
      getCronSettings(),
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

    // If no DB config yet, return defaults
    const jobs =
      settings.jobs.length > 0
        ? settings.jobs
        : DEFAULT_CRON_JOBS.map((j) => ({ ...j, id: "" }));

    return NextResponse.json({
      success: true,
      settings: {
        baseUrl: settings.baseUrl,
        jobs,
      },
      liveStatus: liveStatus.jobs,
      liveErrors: liveStatus.errors,
      setupCheck,
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

// PUT /api/cron-settings — pull current jobs from cron-job.org cloud and save to DB
export async function PUT() {
  try {
    console.log("[cron-settings PUT] Pulling cloud job configs...");
    const cloudResult = await pullCloudJobConfigs();
    console.log(
      "[cron-settings PUT] Pulled:",
      cloudResult.jobs.length,
      "jobs, errors:",
      cloudResult.errors,
    );

    if (cloudResult.errors.length > 0 && cloudResult.jobs.length === 0) {
      return NextResponse.json(
        { success: false, error: cloudResult.errors.join("; ") },
        { status: 500 },
      );
    }

    // Save pulled config to DB
    const settings: CronSettingsType = {
      baseUrl: cloudResult.baseUrl,
      jobs: cloudResult.jobs,
    };

    await setCronSettings(settings);

    // Also fetch live status
    const liveStatus = await pullCronJobStatus().catch((e) => {
      console.warn("[cron-settings PUT] Failed to fetch live status:", e);
      return { jobs: [], errors: [] };
    });

    return NextResponse.json({
      success: true,
      settings,
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

// POST /api/cron-settings — save and sync cron config to cron-job.org
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log(
      "[cron-settings POST] Received:",
      JSON.stringify(body).substring(0, 300),
    );

    if (!body.baseUrl || !body.baseUrl.startsWith("http")) {
      console.log(
        "[cron-settings POST] Missing/invalid baseUrl:",
        body.baseUrl,
      );
      return NextResponse.json(
        {
          success: false,
          error: "Base URL is required (e.g., https://your-app.vercel.app)",
        },
        { status: 400 },
      );
    }

    if (!body.jobs || !Array.isArray(body.jobs) || body.jobs.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one cron job is required" },
        { status: 400 },
      );
    }

    // Validate jobs
    for (const job of body.jobs) {
      if (!job.type || !job.title || !job.url) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid job config: ${JSON.stringify(job)}`,
          },
          { status: 400 },
        );
      }
      if (
        !job.schedule ||
        typeof job.schedule.minutes !== "number" ||
        job.schedule.minutes < 1
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `Job "${job.type}": schedule.minutes must be >= 1`,
          },
          { status: 400 },
        );
      }
    }

    const settings: CronSettingsType = {
      baseUrl: body.baseUrl.replace(/\/+$/, ""), // trim trailing slash
      jobs: body.jobs as CronJobConfig[],
    };

    // Save to DB
    await setCronSettings(settings);

    // Sync to cron-job.org
    const syncResult = await syncCronJobs(settings);

    // Save again (in case IDs were assigned during sync)
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
      settings,
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
