import type { CronJobFormData, SignalSettingsForm } from "./system-types";

export const DEFAULT_SIGNAL_SETTINGS: SignalSettingsForm = {
  fetchLimit: 10,
  timeWindowHours: 24,
  batchSize: 5,
  includeImageUrls: false,
  monitorVisionImages: false,
};

export const DEFAULT_CRON_JOBS: CronJobFormData[] = [
  {
    type: "signal-check",
    enabled: true,
    title: "CopyTrade — Signal Check",
    url: "/api/cron/signal-check",
    id: "",
    schedule: { minutes: 5, hours: [], mdays: [], months: [], wdays: [] },
  },
  {
    type: "position-monitor",
    enabled: true,
    title: "CopyTrade — Position Monitor",
    url: "/api/cron/position-monitor",
    id: "",
    schedule: { minutes: 30, hours: [], mdays: [], months: [], wdays: [] },
  },
  {
    type: "tp-sl-monitor",
    enabled: true,
    title: "CopyTrade — TP/SL Monitor",
    url: "/api/cron/tp-sl-monitor",
    id: "",
    schedule: { minutes: 5, hours: [], mdays: [], months: [], wdays: [] },
  },
  {
    type: "orphan-cleanup",
    enabled: true,
    title: "CopyTrade — Orphan Cleanup",
    url: "/api/cron/orphan-cleanup",
    id: "",
    schedule: { minutes: 60, hours: [], mdays: [], months: [], wdays: [] },
  },
];
