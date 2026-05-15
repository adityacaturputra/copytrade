/**
 * Telegram Source Provider (Stub)
 *
 * Placeholder implementation for future Telegram integration.
 * Implements ISourceProvider to fit the source factory pattern.
 */

import { SourceType } from "../../enums/index";
import {
  ISourceProvider,
  BaseSourceMessage,
  BaseSourceConfig,
  SourceHealthStatus,
} from "../types";

// ==================== Telegram-Specific Types ====================

export interface TelegramSourceConfig extends BaseSourceConfig {
  type: "telegram";
  /** Telegram Bot API token or user session string */
  token: string;
  /** Optional: phone number for user account access */
  phoneNumber?: string;
  /** Optional: API ID for Telegram client */
  apiId?: string;
  /** Optional: API hash for Telegram client */
  apiHash?: string;
}

// ==================== Provider Implementation ====================

export class TelegramSourceProvider implements ISourceProvider {
  readonly name = "Telegram";
  readonly type: typeof SourceType.TELEGRAM = SourceType.TELEGRAM;

  async fetchMessages(
    _config: BaseSourceConfig,
    _fetchLimit?: number,
    _timeWindowHours?: number,
    _processedMessageIds?: Set<string>,
  ): Promise<BaseSourceMessage[]> {
    // TODO: Implement Telegram message fetching
    console.warn(
      `⚠️ Telegram source provider is not yet implemented. Source: "${_config.name}"`,
    );
    return [];
  }

  async checkHealth(_config: BaseSourceConfig): Promise<SourceHealthStatus> {
    const telegramConfig = _config as TelegramSourceConfig;

    if (!telegramConfig.token) {
      return {
        valid: false,
        error: "Telegram token is not configured",
        needsRefresh: false,
      };
    }

    return {
      valid: false,
      error: "Telegram provider is not yet implemented",
      needsRefresh: false,
    };
  }

  async getChannelNames(
    channelIds: string[],
    _config: BaseSourceConfig,
  ): Promise<Map<string, string>> {
    // TODO: Implement Telegram channel name resolution
    const nameMap = new Map<string, string>();
    for (const chId of channelIds) {
      nameMap.set(chId, chId);
    }
    return nameMap;
  }
}
