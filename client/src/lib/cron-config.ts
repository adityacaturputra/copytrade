import {
  CRON_PROVIDER_OPTIONS,
  DEFAULT_CRON_JOBS,
  KNOWN_CRON_JOB_TYPES,
  getCronSettings,
  setCronSettings,
  type CronJobConfig,
  type CronSettingsType,
} from "@copytrade/shared/lib/cron-settings";

export {
  CRON_PROVIDER_OPTIONS,
  DEFAULT_CRON_JOBS,
  getCronSettings,
  setCronSettings,
};

// ─── Recommended schedule labels ──────────────────────────────────────────────

export const RECOMMENDED_SCHEDULES: Record<
  string,
  { label: string; description: string }
> = {
  "signal-check": {
    label: "Every 5 minutes",
    description:
      "Check Discord for new signals frequently. Recommended: 5 min.",
  },
  "position-monitor": {
    label: "Every 30 minutes",
    description: "Monitor open positions for changes. Recommended: 30 min.",
  },
  "tp-sl-monitor": {
    label: "Every 5 minutes",
    description: "Place TP/SL for filled limit orders. Recommended: 5 min.",
  },
};

// ─── cron-job.org API ────────────────────────────────────────────────────────

const CRON_API_BASE = "https://api.cron-job.org";

function getAuthHeaders() {
  const apiKey = process.env.CRON_JOB_API_KEY;
  if (!apiKey) throw new Error("CRON_JOB_API_KEY not set in environment");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

interface CronJobOrgResponse {
  ok: boolean;
  error?: string;
  job?: any;
  jobs?: any[];
}

async function listJobs(): Promise<any[]> {
  const headers = getAuthHeaders();
  console.log("[listJobs] Fetching from:", `${CRON_API_BASE}/jobs`);
  console.log(
    "[listJobs] Auth header:",
    headers.Authorization?.substring(0, 20) + "...",
  );

  const res = await fetch(`${CRON_API_BASE}/jobs`, {
    headers,
  });

  console.log("[listJobs] Response status:", res.status, res.statusText);

  // Handle HTTP errors (429 rate limit, 5xx, etc.)
  if (!res.ok) {
    if (res.status === 429) {
      console.warn(
        "[listJobs] Rate limited by cron-job.org (429). Returning empty result.",
      );
      return [];
    }
    const rawText = await res.text();
    console.error(
      "[listJobs] HTTP error:",
      res.status,
      rawText.substring(0, 500),
    );
    throw new Error(`HTTP ${res.status} from cron-job.org`);
  }

  const json = await res.json();

  // cron-job.org returns jobs as array or nested object
  let jobs = json.jobs || [];
  if (!Array.isArray(jobs) && jobs?.jobs) jobs = jobs.jobs;
  if (!Array.isArray(jobs)) {
    console.warn(
      "[listJobs] Unexpected jobs format:",
      typeof jobs,
      JSON.stringify(jobs)?.substring(0, 200),
    );
    return [];
  }

  console.log("[listJobs] Found", jobs.length, "jobs");
  return jobs;
}

async function createJob(payload: any): Promise<any> {
  const res = await fetch(`${CRON_API_BASE}/jobs`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const json: CronJobOrgResponse = await res.json();
  if (!json.ok) throw new Error(json.error || "Failed to create job");
  return json.job;
}

async function updateJob(jobId: number, payload: any): Promise<any> {
  const res = await fetch(`${CRON_API_BASE}/jobs/${jobId}`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  const json: CronJobOrgResponse = await res.json();
  if (!json.ok) throw new Error(json.error || "Failed to update job");
  return json.job;
}

async function deleteJob(jobId: number): Promise<void> {
  const res = await fetch(`${CRON_API_BASE}/jobs/${jobId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete job: ${text}`);
  }
}

function buildExistingCloudJobPayload(cloudJob: any, enabled: boolean) {
  const rawSchedule = cloudJob?.schedule || {};

  return {
    job: {
      enabled,
      title: cloudJob?.title || "CopyTrade Cron Job",
      url: cloudJob?.url || "",
      requestMethod:
        typeof cloudJob?.requestMethod === "number" ? cloudJob.requestMethod : 0,
      schedule: {
        minutes: Array.isArray(rawSchedule.minutes)
          ? rawSchedule.minutes
          : [-1],
        hours: Array.isArray(rawSchedule.hours) ? rawSchedule.hours : [-1],
        mdays: Array.isArray(rawSchedule.mdays) ? rawSchedule.mdays : [-1],
        months: Array.isArray(rawSchedule.months) ? rawSchedule.months : [-1],
        wdays: Array.isArray(rawSchedule.wdays) ? rawSchedule.wdays : [-1],
      },
      extendedData:
        typeof cloudJob?.extendedData === "boolean"
          ? cloudJob.extendedData
          : true,
      overlap:
        typeof cloudJob?.overlap === "boolean" ? cloudJob.overlap : false,
      timezone:
        typeof cloudJob?.timezone === "string" && cloudJob.timezone
          ? cloudJob.timezone
          : "Asia/Jakarta",
    },
  };
}

// Build the cron-job.org job payload from our config
function buildJobPayload(config: CronJobConfig): any {
  return {
    job: {
      enabled: config.enabled,
      title: config.title,
      url: config.url,
      requestMethod: 0, // 0 = GET
      schedule: {
        // cron-job.org uses special values: -1 means "every"
        minutes: [config.schedule.minutes], // specific minute interval
        hours: config.schedule.hours.length > 0 ? config.schedule.hours : [-1],
        mdays: config.schedule.mdays.length > 0 ? config.schedule.mdays : [-1],
        months:
          config.schedule.months.length > 0 ? config.schedule.months : [-1],
        wdays: config.schedule.wdays.length > 0 ? config.schedule.wdays : [-1],
      },
      extendedData: true,
      // Run even if previous is still running
      overlap: false,
      // Timezone
      timezone: "Asia/Jakarta",
    },
  };
}

// ─── Sync: push local config to cron-job.org ────────────────────────────────

export async function syncCronJobs(settings: CronSettingsType): Promise<{
  synced: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let synced = 0;

  // Get existing jobs from cron-job.org
  let existingJobs: any[] = [];
  try {
    existingJobs = await listJobs();
  } catch (err) {
    errors.push(
      `Failed to list cron-job.org jobs: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { synced, errors };
  }

  for (const config of settings.jobs) {
    try {
      const fullUrl = `${settings.baseUrl}${config.url}`;
      const payload = buildJobPayload({ ...config, url: fullUrl });

      if (config.id) {
        // Update existing job
        const jobId = parseInt(config.id);
        try {
          await updateJob(jobId, payload);
          synced++;
        } catch (err) {
          // If update fails, try creating a new one
          errors.push(
            `Update ${config.type}: ${err instanceof Error ? err.message : String(err)}. Attempting to recreate...`,
          );
          const newJob = await createJob(payload);
          config.id = String(newJob?.jobId || newJob?.id || "");
          synced++;
        }
      } else {
        // Create new job
        const newJob = await createJob(payload);
        config.id = String(newJob?.jobId || newJob?.id || "");
        synced++;
      }
    } catch (err) {
      errors.push(
        `Create ${config.type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { synced, errors };
}

export async function disableManagedCloudCronJobs(): Promise<{
  disabled: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let disabled = 0;

  let existingJobs: any[] = [];
  try {
    existingJobs = await listJobs();
  } catch (error) {
    errors.push(
      `Failed to list cron-job.org jobs: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { disabled, errors };
  }

  for (const type of KNOWN_CRON_JOB_TYPES) {
    const cloudJob = existingJobs.find((job) => {
      const url = typeof job?.url === "string" ? job.url : "";
      return url.includes(`/api/cron/${type}`);
    });

    if (!cloudJob) continue;

    try {
      const jobId = Number(cloudJob.jobId || cloudJob.id);
      if (!Number.isFinite(jobId)) {
        throw new Error(`Invalid job ID for ${type}`);
      }
      await updateJob(jobId, buildExistingCloudJobPayload(cloudJob, false));
      disabled++;
    } catch (error) {
      errors.push(
        `Disable ${type}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { disabled, errors };
}

// ─── Pull: fetch current jobs from cron-job.org ─────────────────────────────

export async function pullCronJobStatus(): Promise<{
  jobs: Array<{
    type: string;
    title: string;
    enabled: boolean;
    url: string;
    lastExecution?: string;
    nextExecution?: string;
    status: "active" | "missing";
  }>;
  errors: string[];
}> {
  const errors: string[] = [];
  const jobs: Array<{
    type: string;
    title: string;
    enabled: boolean;
    url: string;
    lastExecution?: string;
    nextExecution?: string;
    status: "active" | "missing";
  }> = [];

  let existingJobs: any[] = [];
  try {
    existingJobs = await listJobs();
  } catch (err) {
    errors.push(
      `Failed to list jobs: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { jobs, errors };
  }

  // Check each expected cron type
  for (const type of KNOWN_CRON_JOB_TYPES) {
    const match = existingJobs.find((j: any) => {
      const url = j.url || "";
      return url.includes(`/api/cron/${type}`);
    });

    if (match) {
      jobs.push({
        type,
        title: match.title || type,
        enabled: match.enabled || false,
        url: match.url || "",
        lastExecution: match.lastExecution || undefined,
        nextExecution: match.nextExecution || undefined,
        status: "active",
      });
    } else {
      jobs.push({
        type,
        title: DEFAULT_CRON_JOBS.find((d) => d.type === type)?.title || type,
        enabled: false,
        url: "",
        status: "missing",
      });
    }
  }

  return { jobs, errors };
}

// ─── Pull full job configs from cron-job.org cloud ──────────────────────────

export async function pullCloudJobConfigs(): Promise<{
  jobs: CronJobConfig[];
  baseUrl: string;
  errors: string[];
}> {
  const errors: string[] = [];
  const jobs: CronJobConfig[] = [];

  let existingJobs: any[] = [];
  try {
    existingJobs = await listJobs();
  } catch (err) {
    errors.push(
      `Failed to list jobs: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { jobs, baseUrl: "", errors };
  }

  // Get baseUrl from cloud job URLs (source of truth)
  let baseUrl = "";
  for (const cloudJob of existingJobs) {
    const fullUrl: string = cloudJob.url || "";
    const urlMatch = fullUrl.match(/^(https?:\/\/[^\/]+)/);
    if (urlMatch) {
      baseUrl = urlMatch[1];
      console.log(
        "[pullCloudJobConfigs] Extracted baseUrl from cloud:",
        baseUrl,
      );
      break;
    }
  }

  // Fallback to DB baseUrl if cloud has no jobs
  if (!baseUrl) {
    const settings = await getCronSettings();
    baseUrl = settings.baseUrl;
  }

  // Also check all known types — create entries even for missing jobs
  for (const type of KNOWN_CRON_JOB_TYPES) {
    const match = existingJobs.find((j: any) => {
      const url = j.url || "";
      return url.includes(`/api/cron/${type}`);
    });

    if (match) {
      try {
        // Parse schedule back from cron-job.org format
        const rawSchedule = match.schedule || {};
        const minutesArr = rawSchedule.minutes || [-1];
        const minutesVal = Array.isArray(minutesArr)
          ? minutesArr[0]
          : minutesArr;

        // Extract relative URL from full URL
        const fullUrl: string = match.url || "";
        const relUrl =
          baseUrl && fullUrl.startsWith(baseUrl)
            ? fullUrl.slice(baseUrl.length)
            : fullUrl.includes("/api/cron/")
              ? fullUrl.replace(/^https?:\/\/[^/]+/, "")
              : `/api/cron/${type}`;

        jobs.push({
          id: String(match.jobId || match.id || ""),
          type,
          enabled: match.enabled ?? true,
          title:
            match.title ||
            DEFAULT_CRON_JOBS.find((d) => d.type === type)?.title ||
            type,
          url: relUrl,
          schedule: {
            minutes: minutesVal === -1 ? 1 : minutesVal,
            hours:
              Array.isArray(rawSchedule.hours) && rawSchedule.hours[0] !== -1
                ? rawSchedule.hours
                : [],
            mdays:
              Array.isArray(rawSchedule.mdays) && rawSchedule.mdays[0] !== -1
                ? rawSchedule.mdays
                : [],
            months:
              Array.isArray(rawSchedule.months) && rawSchedule.months[0] !== -1
                ? rawSchedule.months
                : [],
            wdays:
              Array.isArray(rawSchedule.wdays) && rawSchedule.wdays[0] !== -1
                ? rawSchedule.wdays
                : [],
          },
        });
      } catch (err) {
        console.error(`[pullCloudJobConfigs] Error parsing ${type}:`, err);
        errors.push(
          `Parse ${type}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Fallback to default
        const def = DEFAULT_CRON_JOBS.find((d) => d.type === type);
        if (def) jobs.push({ ...def, id: "" });
      }
    } else {
      // Missing on cloud — use default template
      const def = DEFAULT_CRON_JOBS.find((d) => d.type === type);
      if (def) {
        jobs.push({ ...def, id: "" });
      }
    }
  }

  // Also include any extra cloud jobs not in known types (for visibility)
  for (const cloudJob of existingJobs) {
    const url: string = cloudJob.url || "";
    const isKnown = KNOWN_CRON_JOB_TYPES.some((t) =>
      url.includes(`/api/cron/${t}`),
    );
    if (!isKnown) {
      const rawSchedule = cloudJob.schedule || {};
      const minutesArr = rawSchedule.minutes || [-1];
      const minutesVal = Array.isArray(minutesArr) ? minutesArr[0] : minutesArr;

      jobs.push({
        id: String(cloudJob.jobId || cloudJob.id || ""),
        type: `custom-${cloudJob.jobId || "unknown"}`,
        enabled: cloudJob.enabled ?? true,
        title: cloudJob.title || "Unknown Cloud Job",
        url,
        schedule: {
          minutes: minutesVal === -1 ? 1 : minutesVal,
          hours:
            Array.isArray(rawSchedule.hours) && rawSchedule.hours[0] !== -1
              ? rawSchedule.hours
              : [],
          mdays:
            Array.isArray(rawSchedule.mdays) && rawSchedule.mdays[0] !== -1
              ? rawSchedule.mdays
              : [],
          months:
            Array.isArray(rawSchedule.months) && rawSchedule.months[0] !== -1
              ? rawSchedule.months
              : [],
          wdays:
            Array.isArray(rawSchedule.wdays) && rawSchedule.wdays[0] !== -1
              ? rawSchedule.wdays
              : [],
        },
      });
    }
  }

  return { jobs, baseUrl, errors };
}

// ─── Check if cron jobs are properly configured ─────────────────────────────

export async function checkCronSetup(): Promise<{
  allConfigured: boolean;
  missing: string[];
  details: Array<{
    type: string;
    configured: boolean;
    enabled: boolean;
  }>;
}> {
  const result = await pullCronJobStatus();
  const details = result.jobs.map((j) => ({
    type: j.type,
    configured: j.status === "active",
    enabled: j.enabled,
  }));

  const missing = details.filter((d) => !d.configured).map((d) => d.type);

  return {
    allConfigured: missing.length === 0,
    missing,
    details,
  };
}
