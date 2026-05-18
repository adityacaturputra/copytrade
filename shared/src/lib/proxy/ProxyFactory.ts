/**
 * Proxy Factory
 *
 * Manages proxy providers and persists config to DB.
 * Usage: ProxyFactory.getProvider() → IProxyProvider
 */

import { connectDB } from "../database";
import {
  ProxyAgentLike,
  ProxyConfig,
  ProxyProviderType,
  ProxyInfoResult,
} from "./types";
import {
  WebshareProvider,
  configureWebshareApiKeyPool,
} from "./webshare/index";
import { CustomProvider, CustomProxySettings } from "./custom/index";

// ─── DB Schema (inline, follows project pattern) ───────────────────────────

import mongoose, { Schema, Document, models, Model } from "mongoose";

export interface IProxySettings extends Document {
  enabled: boolean;
  provider: ProxyProviderType;
  customHost: string;
  customPort: number;
  customUsername: string;
  customPassword: string;
  webshareApiKeys: string[];
  webshareActiveKeyIndex: number;
  webshareAllowedCountryCodes: string[];
  updatedAt: Date;
}

interface IProxyIpSnapshot extends Document {
  provider: ProxyProviderType;
  previousIps: string[];
  currentIps: string[];
  payload?: Record<string, unknown>;
  updatedAt: Date;
}

const ProxySettingsSchema = new Schema<IProxySettings>(
  {
    enabled: { type: Boolean, default: false },
    provider: {
      type: String,
      enum: ["webshare", "custom"],
      default: "webshare",
    },
    customHost: { type: String, default: "" },
    customPort: { type: Number, default: 1080 },
    customUsername: { type: String, default: "" },
    customPassword: { type: String, default: "" },
    webshareApiKeys: { type: [String], default: [] },
    webshareActiveKeyIndex: { type: Number, default: 0 },
    webshareAllowedCountryCodes: { type: [String], default: [] },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

const ProxySettings: Model<IProxySettings> =
  models.ProxySettings ||
  mongoose.model<IProxySettings>("ProxySettings", ProxySettingsSchema);

const ProxyIpSnapshotSchema = new Schema<IProxyIpSnapshot>(
  {
    provider: {
      type: String,
      enum: ["webshare", "custom"],
      required: true,
      unique: true,
    },
    previousIps: { type: [String], default: [] },
    currentIps: { type: [String], default: [] },
    payload: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

const ProxyIpSnapshot: Model<IProxyIpSnapshot> =
  models.ProxyIpSnapshot ||
  mongoose.model<IProxyIpSnapshot>("ProxyIpSnapshot", ProxyIpSnapshotSchema);

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: false,
  provider: "webshare",
  custom: {
    host: "",
    port: 1080,
    username: "",
    password: "",
  },
};

// ─── Singleton providers ────────────────────────────────────────────────────

let webshareProvider: WebshareProvider | null = null;
let customProvider: CustomProvider | null = null;

async function resolveWebshareApiKeyPoolState(): Promise<{
  keys: string[];
  activeIndex: number;
  allowedCountryCodes: string[];
}> {
  await connectDB();
  const doc = await ProxySettings.findOne().sort({ updatedAt: -1 }).lean();
  const keys = (doc?.webshareApiKeys || [])
    .map((k) => String(k).trim())
    .filter(Boolean);
  if (keys.length > 0) {
    return {
      keys,
      activeIndex: Number(doc?.webshareActiveKeyIndex || 0),
      allowedCountryCodes: (doc?.webshareAllowedCountryCodes || [])
        .map((code) =>
          String(code || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    };
  }

  const envKey = (process.env.WEBSHARE_API_KEY || "").trim();
  return {
    keys: envKey ? [envKey] : [],
    activeIndex: 0,
    allowedCountryCodes: (doc?.webshareAllowedCountryCodes || [])
      .map((code) =>
        String(code || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  };
}

async function persistWebshareActiveIndex(index: number): Promise<void> {
  await connectDB();
  await ProxySettings.findOneAndUpdate(
    {},
    { webshareActiveKeyIndex: Math.max(0, Number(index) || 0) },
    { upsert: true, new: true },
  );
}

function getWebshareProvider(): WebshareProvider {
  configureWebshareApiKeyPool({
    resolvePool: resolveWebshareApiKeyPoolState,
    persistActiveIndex: persistWebshareActiveIndex,
  });
  if (!webshareProvider) {
    webshareProvider = new WebshareProvider();
  }
  return webshareProvider;
}

export async function getWebshareApiKeyPoolConfig(): Promise<{
  keys: string[];
  activeIndex: number;
  allowedCountryCodes: string[];
}> {
  return resolveWebshareApiKeyPoolState();
}

export async function setWebshareApiKeyPoolConfig(payload: {
  keys?: string[];
  activeIndex?: number;
  allowedCountryCodes?: string[];
}): Promise<{
  keys: string[];
  activeIndex: number;
  allowedCountryCodes: string[];
}> {
  await connectDB();
  const keys = (payload.keys || [])
    .map((k) => String(k).trim())
    .filter(Boolean);
  const activeIndex = Math.max(0, Number(payload.activeIndex) || 0);
  const allowedCountryCodes = (payload.allowedCountryCodes || [])
    .map((code) =>
      String(code || "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  const doc = await ProxySettings.findOneAndUpdate(
    {},
    {
      ...(payload.keys ? { webshareApiKeys: keys } : {}),
      ...(payload.activeIndex !== undefined
        ? { webshareActiveKeyIndex: activeIndex }
        : {}),
      ...(payload.allowedCountryCodes
        ? { webshareAllowedCountryCodes: allowedCountryCodes }
        : {}),
    },
    { upsert: true, new: true },
  ).lean();

  getWebshareProvider().clearCache();
  return {
    keys: (doc.webshareApiKeys || [])
      .map((k) => String(k).trim())
      .filter(Boolean),
    activeIndex: Number(doc.webshareActiveKeyIndex || 0),
    allowedCountryCodes: (doc.webshareAllowedCountryCodes || [])
      .map((code) =>
        String(code || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  };
}

function getCustomProvider(settings: CustomProxySettings): CustomProvider {
  if (!customProvider) {
    customProvider = new CustomProvider(settings);
  } else {
    customProvider.updateSettings(settings);
  }
  return customProvider;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get proxy config from DB (or defaults).
 */
export async function getProxyConfig(): Promise<ProxyConfig> {
  try {
    await connectDB();
    const doc = await ProxySettings.findOne().sort({ updatedAt: -1 }).lean();
    if (doc) {
      return {
        enabled: doc.enabled,
        provider: doc.provider,
        custom: {
          host: doc.customHost,
          port: doc.customPort,
          username: doc.customUsername,
          password: doc.customPassword,
        },
      };
    }
  } catch (err) {
    console.warn(
      "[ProxyFactory] Failed to load proxy config, using defaults:",
      err instanceof Error ? err.message : String(err),
    );
  }
  return DEFAULT_PROXY_CONFIG;
}

/**
 * Save proxy config to DB.
 */
export async function setProxyConfig(
  config: Partial<ProxyConfig>,
): Promise<ProxyConfig> {
  await connectDB();
  const update: Record<string, unknown> = {};
  if (config.enabled !== undefined) update.enabled = config.enabled;
  if (config.provider !== undefined) update.provider = config.provider;
  if (config.custom?.host !== undefined) update.customHost = config.custom.host;
  if (config.custom?.port !== undefined) update.customPort = config.custom.port;
  if (config.custom?.username !== undefined)
    update.customUsername = config.custom.username;
  if (config.custom?.password !== undefined)
    update.customPassword = config.custom.password;

  const doc = await ProxySettings.findOneAndUpdate({}, update, {
    upsert: true,
    new: true,
  }).lean();

  // Clear webshare cache when switching providers
  if (config.provider) {
    getWebshareProvider().clearCache();
  }

  return {
    enabled: doc.enabled,
    provider: doc.provider,
    custom: {
      host: doc.customHost,
      port: doc.customPort,
      username: doc.customUsername,
      password: doc.customPassword,
    },
  };
}

/**
 * Get the current active proxy provider based on DB config.
 * Returns null if proxy is disabled.
 */
export async function getProvider() {
  const config = await getProxyConfig();
  if (!config.enabled) return null;

  if (config.provider === "webshare") {
    return getWebshareProvider();
  }

  if (config.provider === "custom" && config.custom) {
    return getCustomProvider(config.custom);
  }

  return null;
}

/**
 * Convenience: Get proxy agent for the active provider.
 * Returns null if proxy is disabled or no provider available.
 */
export async function getProxyAgent(
  affinityKey?: string,
): Promise<ProxyAgentLike | null> {
  const provider = await getProvider();
  if (!provider) return null;
  return provider.getProxyAgent(affinityKey);
}

export async function getCurrentProxyMeta(affinityKey?: string): Promise<{
  provider: string;
  ip?: string;
  countryCode?: string;
  city?: string;
} | null> {
  const provider = await getProvider();
  if (!provider) return null;

  if (provider instanceof WebshareProvider) {
    const meta = provider.getLastSelectedProxyMeta(affinityKey);
    return {
      provider: provider.name,
      ip: meta?.ip,
      countryCode: meta?.countryCode,
      city: meta?.city,
    };
  }

  return { provider: provider.name };
}

export async function markCurrentProxyCountryBlocked(
  affinityKey?: string,
): Promise<void> {
  const provider = await getProvider();
  if (!provider) return;
  if (!(provider instanceof WebshareProvider)) return;

  const meta = provider.getLastSelectedProxyMeta(affinityKey);
  if (!meta?.countryCode) return;
  provider.markCountryBlocked(meta.countryCode, affinityKey);
}

export async function markCurrentProxySuccessful(
  affinityKey?: string,
): Promise<void> {
  const provider = await getProvider();
  if (!provider) return;
  if (!(provider instanceof WebshareProvider)) return;
  provider.markCurrentProxySuccessful(affinityKey);
}

export async function markCurrentProxyIpBlocked(
  affinityKey?: string,
): Promise<void> {
  const provider = await getProvider();
  if (!provider) return;
  if (!(provider instanceof WebshareProvider)) return;

  const meta = provider.getLastSelectedProxyMeta(affinityKey);
  if (!meta?.ip) return;
  provider.markIpBlocked(meta.ip, affinityKey);
}

export async function rotateCurrentProxyCredentialForError(
  error: unknown,
  affinityKey?: string,
): Promise<boolean> {
  const provider = await getProvider();
  if (!provider) return false;
  if (!(provider instanceof WebshareProvider)) return false;
  return provider.tryRotateApiKeyForError(error);
}

/**
 * Get proxy info for the settings page from the current provider.
 */
const PROXY_INFO_CACHE_TTL_MS = 60 * 60 * 1000;

export async function getProxyInfo(options?: {
  forceRefresh?: boolean;
}): Promise<ProxyInfoResult> {
  const config = await getProxyConfig();

  if (!config.enabled) {
    return { success: false, error: "Proxy is disabled" };
  }

  const provider =
    config.provider === "webshare"
      ? getWebshareProvider()
      : config.custom
        ? getCustomProvider(config.custom)
        : null;

  if (!provider) {
    return { success: false, error: "No proxy provider configured" };
  }

  const forceRefresh = options?.forceRefresh === true;

  if (config.provider === "webshare" && !forceRefresh) {
    const snapshot = await ProxyIpSnapshot.findOne({ provider: "webshare" })
      .lean()
      .catch(() => null);
    const snapshotAge = snapshot?.updatedAt
      ? Date.now() - new Date(snapshot.updatedAt).getTime()
      : Number.POSITIVE_INFINITY;

    if (
      snapshot?.payload &&
      snapshotAge < PROXY_INFO_CACHE_TTL_MS
    ) {
      const payload = snapshot.payload as unknown as ProxyInfoResult;
      return {
        ...payload,
        providerName: provider.name,
        telemetry: {
          ...(payload.telemetry || {}),
          snapshotUpdatedAt: snapshot.updatedAt
            ? new Date(snapshot.updatedAt).toISOString()
            : undefined,
          cacheExpiresAt: new Date(
            new Date(snapshot.updatedAt).getTime() + PROXY_INFO_CACHE_TTL_MS,
          ).toISOString(),
          previousIps: snapshot.previousIps || [],
          currentIps: snapshot.currentIps || [],
          addedIps:
            payload.telemetry?.addedIps ||
            (snapshot.currentIps || []).filter(
              (ip) => !(snapshot.previousIps || []).includes(ip),
            ),
          removedIps:
            payload.telemetry?.removedIps ||
            (snapshot.previousIps || []).filter(
              (ip) => !(snapshot.currentIps || []).includes(ip),
            ),
        },
      };
    }
  }

  const info = await provider.getProxyInfo();

  if (config.provider === "webshare" && info.success && info.ipList) {
    const snapshot = await ProxyIpSnapshot.findOne({ provider: "webshare" })
      .lean()
      .catch(() => null);
    const previousIps = snapshot?.currentIps || [];
    const currentIps = info.ipList;
    const addedIps = currentIps.filter((ip) => !previousIps.includes(ip));
    const removedIps = previousIps.filter((ip) => !currentIps.includes(ip));

    await ProxyIpSnapshot.findOneAndUpdate(
      { provider: "webshare" },
      {
        provider: "webshare",
        previousIps,
        currentIps,
        payload: {
          ...info,
          providerName: provider.name,
        },
      },
      { upsert: true, new: true },
    ).catch(() => null);

    return {
      ...info,
      providerName: provider.name,
      telemetry: {
        snapshotUpdatedAt: snapshot?.updatedAt
          ? new Date(snapshot.updatedAt).toISOString()
          : undefined,
        cacheExpiresAt: new Date(Date.now() + PROXY_INFO_CACHE_TTL_MS).toISOString(),
        previousIps,
        currentIps,
        addedIps,
        removedIps,
      },
    };
  }

  return { ...info, providerName: provider.name };
}

/**
 * Get proxy info for a specific provider (for preview in settings).
 */
export async function getProviderProxyInfo(
  providerType: ProxyProviderType,
  customSettings?: CustomProxySettings,
): Promise<ProxyInfoResult> {
  if (providerType === "webshare") {
    return getProxyInfo({ forceRefresh: true });
  }

  if (providerType === "custom" && customSettings) {
    return getCustomProvider(customSettings).getProxyInfo();
  }

  return { success: false, error: "Unknown provider or missing settings" };
}
