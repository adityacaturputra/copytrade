import { connectDB, SignalConfig as SignalConfigModel } from "./database";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignalConfigType {
  fetchLimit: number; // how many messages to fetch per channel (default 10)
  timeWindowHours: number; // only process messages within this window (default 24)
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SIGNAL_CONFIG: SignalConfigType = {
  fetchLimit: 10,
  timeWindowHours: 24,
};

// ─── DB Helpers ───────────────────────────────────────────────────────────────

export async function getSignalConfig(): Promise<SignalConfigType> {
  try {
    await connectDB();
    const settings = await SignalConfigModel.findOne()
      .sort({ updatedAt: -1 })
      .lean();
    if (settings) {
      return {
        fetchLimit: settings.fetchLimit,
        timeWindowHours: settings.timeWindowHours,
      };
    }
  } catch (err) {
    console.warn(
      "Failed to fetch signal config from DB, using defaults:",
      err instanceof Error ? err.message : String(err),
    );
  }
  return DEFAULT_SIGNAL_CONFIG;
}

export async function setSignalConfig(
  config: Partial<SignalConfigType>,
): Promise<SignalConfigType> {
  await connectDB();
  const update: Record<string, unknown> = {};
  if (config.fetchLimit !== undefined) {
    update.fetchLimit = config.fetchLimit;
  }
  if (config.timeWindowHours !== undefined) {
    update.timeWindowHours = config.timeWindowHours;
  }
  const doc = await SignalConfigModel.findOneAndUpdate({}, update, {
    upsert: true,
    new: true,
  }).lean();
  return {
    fetchLimit: doc.fetchLimit,
    timeWindowHours: doc.timeWindowHours,
  };
}
