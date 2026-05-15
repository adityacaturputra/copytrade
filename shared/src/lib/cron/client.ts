export type CronProvider = "cron-job.org" | "app";

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
