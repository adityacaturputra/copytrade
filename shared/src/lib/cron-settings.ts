import mongoose, { Schema, type Document, type Model, models } from "mongoose";
import { connectDB } from "./database";

export type CronProvider = "cron-job.org" | "app";

export interface CronJobConfig {
  id: string;
  type: string;
  enabled: boolean;
  title: string;
  url: string;
  schedule: {
    minutes: number;
    hours: number[];
    mdays: number[];
    months: number[];
    wdays: number[];
  };
}

export interface CronSettingsType {
  provider: CronProvider;
  baseUrl: string;
  jobs: CronJobConfig[];
}

interface ICronSettings extends Document {
  provider: CronProvider;
  baseUrl: string;
  jobs: CronJobConfig[];
  updatedAt: Date;
}

export const DEFAULT_CRON_PROVIDER: CronProvider = "cron-job.org";

export const KNOWN_CRON_JOB_TYPES = [
  "signal-check",
  "position-monitor",
  "tp-sl-monitor",
] as const;

export type KnownCronJobType = (typeof KNOWN_CRON_JOB_TYPES)[number];

export const CRON_PROVIDER_OPTIONS: Array<{
  value: CronProvider;
  label: string;
  description: string;
}> = [
  {
    value: "cron-job.org",
    label: "cron-job.org",
    description: "Use the third-party cron-job.org scheduler.",
  },
  {
    value: "app",
    label: "This App (VPS)",
    description: "Run cron jobs from the backend process without a third party.",
  },
];

export const DEFAULT_CRON_JOBS: Omit<CronJobConfig, "id">[] = [
  {
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
  {
    type: "position-monitor",
    enabled: true,
    title: "CopyTrade - Position Monitor",
    url: "/api/cron/position-monitor",
    schedule: {
      minutes: 30,
      hours: [],
      mdays: [],
      months: [],
      wdays: [],
    },
  },
  {
    type: "tp-sl-monitor",
    enabled: true,
    title: "CopyTrade - TP/SL Monitor",
    url: "/api/cron/tp-sl-monitor",
    schedule: {
      minutes: 5,
      hours: [],
      mdays: [],
      months: [],
      wdays: [],
    },
  },
];

const CronSettingsSchema = new Schema<ICronSettings>(
  {
    provider: {
      type: String,
      enum: CRON_PROVIDER_OPTIONS.map((option) => option.value),
      default: DEFAULT_CRON_PROVIDER,
    },
    baseUrl: { type: String, default: "" },
    jobs: [
      {
        id: { type: String, default: "" },
        type: { type: String, required: true },
        enabled: { type: Boolean, default: true },
        title: { type: String, required: true },
        url: { type: String, default: "" },
        schedule: {
          minutes: { type: Number, default: 5 },
          hours: { type: [Number], default: [] },
          mdays: { type: [Number], default: [] },
          months: { type: [Number], default: [] },
          wdays: { type: [Number], default: [] },
        },
      },
    ],
  },
  { timestamps: true },
);

export const CronSettings: Model<ICronSettings> =
  models.CronSettings ||
  mongoose.model<ICronSettings>("CronSettings", CronSettingsSchema);

export function normalizeCronProvider(value: unknown): CronProvider {
  return value === "app" ? "app" : DEFAULT_CRON_PROVIDER;
}

export function createDefaultCronJobs(): CronJobConfig[] {
  return DEFAULT_CRON_JOBS.map((job) => ({ ...job, id: "" }));
}

function normalizeCronJobConfig(job: Partial<CronJobConfig> | null | undefined) {
  const fallback = DEFAULT_CRON_JOBS.find((entry) => entry.type === job?.type);

  return {
    id: typeof job?.id === "string" ? job.id : "",
    type: typeof job?.type === "string" ? job.type : "",
    enabled:
      typeof job?.enabled === "boolean"
        ? job.enabled
        : true,
    title:
      typeof job?.title === "string" && job.title.trim()
        ? job.title
        : fallback?.title || "Cron Job",
    url:
      typeof job?.url === "string" && job.url.trim()
        ? job.url
        : fallback?.url || "",
    schedule: {
      minutes:
        typeof job?.schedule?.minutes === "number" &&
        Number.isFinite(job.schedule.minutes) &&
        job.schedule.minutes > 0
          ? Math.floor(job.schedule.minutes)
          : (fallback?.schedule.minutes ?? 5),
      hours: Array.isArray(job?.schedule?.hours) ? job.schedule.hours : [],
      mdays: Array.isArray(job?.schedule?.mdays) ? job.schedule.mdays : [],
      months: Array.isArray(job?.schedule?.months) ? job.schedule.months : [],
      wdays: Array.isArray(job?.schedule?.wdays) ? job.schedule.wdays : [],
    },
  };
}

export function normalizeCronSettings(
  settings: Partial<CronSettingsType> | null | undefined,
): CronSettingsType {
  const jobs =
    Array.isArray(settings?.jobs) && settings.jobs.length > 0
      ? settings.jobs.map((job) => normalizeCronJobConfig(job))
      : createDefaultCronJobs();

  return {
    provider: normalizeCronProvider(settings?.provider),
    baseUrl:
      typeof settings?.baseUrl === "string" ? settings.baseUrl.trim() : "",
    jobs,
  };
}

export async function getCronSettings(): Promise<CronSettingsType> {
  try {
    await connectDB();
    const doc = await CronSettings.findOne().sort({ updatedAt: -1 }).lean();
    return normalizeCronSettings(doc);
  } catch (error) {
    console.warn(
      "Failed to fetch cron settings from DB:",
      error instanceof Error ? error.message : String(error),
    );
    return normalizeCronSettings(null);
  }
}

export async function setCronSettings(
  settings: Partial<CronSettingsType>,
): Promise<CronSettingsType> {
  await connectDB();
  const normalized = normalizeCronSettings(settings);
  const doc = await CronSettings.findOneAndUpdate(
    {},
    { $set: normalized },
    { upsert: true, new: true },
  ).lean();
  return normalizeCronSettings(doc);
}
