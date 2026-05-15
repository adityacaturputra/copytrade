import {
  KNOWN_CRON_JOB_TYPES,
  getCronSettings,
  type CronJobConfig,
  type KnownCronJobType,
} from "@copytrade/shared/lib/cron/settings";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Jakarta";

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

type SchedulerLogger = Pick<Console, "log" | "warn" | "error">;

export interface AppCronScheduler {
  stop(): void;
  tick(): Promise<void>;
}

interface CreateSchedulerOptions {
  baseUrl: string;
  authorizationHeader?: string;
  pollIntervalMs?: number;
  timezone?: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  getSettings?: typeof getCronSettings;
  logger?: SchedulerLogger;
}

let activeScheduler: AppCronScheduler | null = null;

function toZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year") || 0),
    month: Number(values.get("month") || 0),
    day: Number(values.get("day") || 0),
    hour: Number(values.get("hour") || 0),
    minute: Number(values.get("minute") || 0),
    weekday: WEEKDAY_MAP[values.get("weekday") || "Sun"] ?? 0,
  };
}

function buildMinuteKey(parts: ZonedDateParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function shouldRunCronJob(
  job: CronJobConfig,
  parts: ZonedDateParts,
): boolean {
  if (!job.enabled) return false;

  const minutes = Math.floor(job.schedule?.minutes || 0);
  if (minutes < 1 || parts.minute % minutes !== 0) return false;

  if (job.schedule.hours.length > 0 && !job.schedule.hours.includes(parts.hour)) {
    return false;
  }
  if (job.schedule.mdays.length > 0 && !job.schedule.mdays.includes(parts.day)) {
    return false;
  }
  if (
    job.schedule.months.length > 0 &&
    !job.schedule.months.includes(parts.month)
  ) {
    return false;
  }
  if (
    job.schedule.wdays.length > 0 &&
    !job.schedule.wdays.includes(parts.weekday)
  ) {
    return false;
  }

  return true;
}

async function triggerCronAction(
  baseUrl: string,
  action: KnownCronJobType,
  authorizationHeader: string | undefined,
  fetchImpl: typeof fetch,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (authorizationHeader) {
    headers.authorization = authorizationHeader;
  }

  const res = await fetchImpl(`${baseUrl}/api/cron/${action}`, {
    method: "POST",
    headers,
  });

  if (res.status === 409) {
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cron trigger failed for ${action} (${res.status}): ${text}`);
  }
}

export function createAppCronScheduler(
  options: CreateSchedulerOptions,
): AppCronScheduler {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  const setIntervalImpl = options.setIntervalImpl || setInterval;
  const clearIntervalImpl = options.clearIntervalImpl || clearInterval;
  const pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const now = options.now || (() => new Date());
  const getSettings = options.getSettings || getCronSettings;
  const logger = options.logger || console;
  const lastTriggered = new Map<string, string>();
  let tickInFlight = false;

  const tick = async () => {
    if (tickInFlight) return;
    tickInFlight = true;

    try {
      const settings = await getSettings();
      if (settings.provider !== "app") {
        return;
      }

      const parts = toZonedDateParts(now(), timezone);
      const minuteKey = buildMinuteKey(parts);

      for (const job of settings.jobs) {
        if (
          !KNOWN_CRON_JOB_TYPES.includes(job.type as KnownCronJobType) ||
          !shouldRunCronJob(job, parts)
        ) {
          continue;
        }

        if (lastTriggered.get(job.type) === minuteKey) {
          continue;
        }

        lastTriggered.set(job.type, minuteKey);
        await triggerCronAction(
          baseUrl,
          job.type as KnownCronJobType,
          options.authorizationHeader,
          fetchImpl,
        );
        logger.log(`[AppCron] Triggered ${job.type} at ${minuteKey} (${timezone})`);
      }
    } catch (error) {
      logger.error(
        "[AppCron] Scheduler tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      tickInFlight = false;
    }
  };

  const interval = setIntervalImpl(() => {
    void tick();
  }, pollIntervalMs);

  void tick();

  return {
    stop() {
      clearIntervalImpl(interval);
    },
    tick,
  };
}

export function startAppCronScheduler(options: CreateSchedulerOptions) {
  if (activeScheduler) {
    return activeScheduler;
  }

  activeScheduler = createAppCronScheduler(options);
  return activeScheduler;
}

export function stopAppCronScheduler() {
  activeScheduler?.stop();
  activeScheduler = null;
}
