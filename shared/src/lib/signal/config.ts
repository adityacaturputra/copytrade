import { connectDB, SignalConfig as SignalConfigModel } from "../database/index";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignalConfigType {
  fetchLimit: number; // how many messages to fetch per channel (default 10)
  timeWindowHours: number; // only process messages within this window (default 24)
  batchSize: number; // how many messages to send to AI per bulk request (default 5)
  includeImageUrls: boolean; // whether to include images in AI prompts (default false)
  monitorVisionImages: boolean; // inject Discord chart images into position monitor agent vision (default false)
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SIGNAL_CONFIG: SignalConfigType = {
  fetchLimit: 10,
  timeWindowHours: 24,
  batchSize: 5,
  includeImageUrls: false,
  monitorVisionImages: false,
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
        batchSize: settings.batchSize,
        includeImageUrls: settings.includeImageUrls ?? false,
        monitorVisionImages: settings.monitorVisionImages ?? false,
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
  if (config.batchSize !== undefined) {
    update.batchSize = config.batchSize;
  }
  if (config.includeImageUrls !== undefined) {
    update.includeImageUrls = config.includeImageUrls;
  }
  if (config.monitorVisionImages !== undefined) {
    update.monitorVisionImages = config.monitorVisionImages;
  }
  const doc = await SignalConfigModel.findOneAndUpdate({}, update, {
    upsert: true,
    new: true,
  }).lean();
  return {
    fetchLimit: doc.fetchLimit,
    timeWindowHours: doc.timeWindowHours,
    batchSize: doc.batchSize,
    includeImageUrls: doc.includeImageUrls ?? false,
    monitorVisionImages: doc.monitorVisionImages ?? false,
  };
}
