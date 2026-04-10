/**
 * Proxy Factory
 *
 * Manages proxy providers and persists config to DB.
 * Usage: ProxyFactory.getProvider() → IProxyProvider
 */

import { HttpsProxyAgent } from "https-proxy-agent";
import { connectDB } from "../database";
import { ProxyConfig, ProxyProviderType, ProxyInfoResult } from "./types";
import { WebshareProvider } from "./WebshareProvider";
import { CustomProvider, CustomProxySettings } from "./CustomProvider";

// ─── DB Schema (inline, follows project pattern) ───────────────────────────

import mongoose, { Schema, Document, models, Model } from "mongoose";

export interface IProxySettings extends Document {
  enabled: boolean;
  provider: ProxyProviderType;
  customHost: string;
  customPort: number;
  customUsername: string;
  customPassword: string;
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
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

const ProxySettings: Model<IProxySettings> =
  models.ProxySettings ||
  mongoose.model<IProxySettings>("ProxySettings", ProxySettingsSchema);

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

function getWebshareProvider(): WebshareProvider {
  if (!webshareProvider) {
    webshareProvider = new WebshareProvider();
  }
  return webshareProvider;
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
export async function getProxyAgent(): Promise<HttpsProxyAgent<string> | null> {
  const provider = await getProvider();
  if (!provider) return null;
  return provider.getProxyAgent();
}

/**
 * Get proxy info for the settings page from the current provider.
 */
export async function getProxyInfo(): Promise<ProxyInfoResult> {
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

  const info = await provider.getProxyInfo();
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
    return getWebshareProvider().getProxyInfo();
  }

  if (providerType === "custom" && customSettings) {
    return getCustomProvider(customSettings).getProxyInfo();
  }

  return { success: false, error: "Unknown provider or missing settings" };
}
