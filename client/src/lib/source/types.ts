/**
 * Source Provider Types & Interfaces
 *
 * Factory pattern for message source providers — easy to add new sources
 * (Discord, Telegram, WhatsApp, etc.)
 *
 * Follows the same pattern as:
 *   - src/lib/proxy/types.ts (IProxyProvider)
 *   - src/lib/exchange/types.ts (ExchangeClient)
 *   - src/lib/ai/types.ts (AISignalAnalyzer)
 */

import { SourceType } from "../enums";

// ==================== Base Source Message ====================

/**
 * A normalized message from any source (Discord, Telegram, etc.).
 * Each source provider is responsible for converting its native message
 * format into this common interface.
 */
export interface BaseSourceMessage {
  /** Unique message ID from the source platform */
  messageId: string;
  /** Channel/group/chat ID from the source platform */
  channelId: string;
  /** Display name of the message author */
  author: string;
  /** Processed text content (e.g., quotes stripped) */
  content: string;
  /** Original raw content before any processing */
  originalContent?: string;
  /** When the message was sent on the source platform */
  timestamp: Date;
  /** URL to view the message on the source platform */
  messageUrl: string;
  /** Attached image URLs (charts, screenshots, etc.) */
  imageUrls: string[];
  /** Whether this message is a reply to another message */
  isReply?: boolean;
  /** DB ID of the source configuration */
  sourceId?: string;
  /** Display name of the source configuration */
  sourceName?: string;
}

// ==================== Base Source Config ====================

/**
 * Base configuration for a message source.
 * Each provider extends this with provider-specific fields.
 */
export interface BaseSourceConfig {
  /** DB document ID */
  _id: string;
  /** Human-readable name for this source */
  name: string;
  /** Which source type (discord, telegram, etc.) */
  type: SourceType;
  /** Channel/group/chat IDs to monitor */
  channelIds: string[];
}

// ==================== Health Check ====================

/**
 * Health check result for a source provider's credentials.
 */
export interface SourceHealthStatus {
  valid: boolean;
  error?: string;
  expiresIn?: number; // ms until expiry
  needsRefresh: boolean;
}

// ==================== Source Provider Interface ====================

/**
 * Interface that all source providers must implement.
 *
 * Similar to IProxyProvider and ExchangeClient — provides a unified
 * API for fetching messages regardless of the source platform.
 */
export interface ISourceProvider {
  /** Provider name for display */
  readonly name: string;

  /** Source type identifier */
  readonly type: SourceType;

  /**
   * Fetch messages from this source with pagination.
   *
   * @param config - Source configuration (credentials, channels, etc.)
   * @param fetchLimit - Page size per API call
   * @param timeWindowHours - Only fetch messages within this many hours
   * @param processedMessageIds - Set of already-processed message IDs (stop condition)
   * @returns Messages sorted DESCENDING (newest first)
   */
  fetchMessages(
    config: BaseSourceConfig,
    fetchLimit?: number,
    timeWindowHours?: number,
    processedMessageIds?: Set<string>,
  ): Promise<BaseSourceMessage[]>;

  /**
   * Check the health/validity of the source's credentials.
   *
   * @param config - Source configuration with credentials
   * @returns Health status
   */
  checkHealth(config: BaseSourceConfig): Promise<SourceHealthStatus>;

  /**
   * Resolve channel/group IDs to human-readable names.
   *
   * @param channelIds - IDs to resolve
   * @param config - Source configuration with credentials
   * @returns Map of channelId → displayName
   */
  getChannelNames(
    channelIds: string[],
    config: BaseSourceConfig,
  ): Promise<Map<string, string>>;
}
