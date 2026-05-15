/**
 * Source Factory
 *
 * Manages source providers and creates them based on source type.
 * Follows the same pattern as:
 *   - src/lib/proxy/ProxyFactory.ts
 *   - src/lib/exchange/ExchangeFactory.ts
 *   - src/lib/ai/AIFactory.ts
 *
 * Usage:
 *   const provider = SourceFactory.getProvider("discord");
 *   const messages = await provider.fetchMessages(config);
 *
 * To add a new source:
 *   1. Create src/lib/source/<Name>SourceProvider.ts implementing ISourceProvider
 *   2. Add the source type to SourceType in enums.ts
 *   3. Add a case in createProvider()
 */

import { SourceType } from "../enums";
import { ISourceProvider, BaseSourceConfig } from "./types";
import { DiscordSourceProvider } from "./discord/index";
import { TelegramSourceProvider } from "./telegram/index";

export type SourceProviderType = "discord" | "telegram";

// ─── Singleton providers ────────────────────────────────────────────────────

let discordProvider: DiscordSourceProvider | null = null;
let telegramProvider: TelegramSourceProvider | null = null;

function getDiscordProvider(): DiscordSourceProvider {
  if (!discordProvider) {
    discordProvider = new DiscordSourceProvider();
  }
  return discordProvider;
}

function getTelegramProvider(): TelegramSourceProvider {
  if (!telegramProvider) {
    telegramProvider = new TelegramSourceProvider();
  }
  return telegramProvider;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export class SourceFactory {
  /**
   * Get a source provider by type.
   */
  static getProvider(type: SourceType | SourceProviderType): ISourceProvider {
    return SourceFactory.createProvider(type as SourceType);
  }

  /**
   * Get the Discord provider specifically (convenience method).
   */
  static getDiscordProvider(): DiscordSourceProvider {
    return getDiscordProvider();
  }

  /**
   * Get the Telegram provider specifically (convenience method).
   */
  static getTelegramProvider(): TelegramSourceProvider {
    return getTelegramProvider();
  }

  /**
   * Create a provider for the given source config.
   * The config's `type` field determines which provider is used.
   */
  static getProviderForConfig(config: BaseSourceConfig): ISourceProvider {
    return SourceFactory.createProvider(config.type);
  }

  private static createProvider(type: SourceType): ISourceProvider {
    switch (type) {
      case SourceType.DISCORD:
        return getDiscordProvider();

      case SourceType.TELEGRAM:
        return getTelegramProvider();

      default:
        console.warn(`Unknown source type: ${type}, falling back to Discord`);
        return getDiscordProvider();
    }
  }

  /**
   * Reset cached providers (useful for testing).
   */
  static reset(): void {
    discordProvider = null;
    telegramProvider = null;
  }
}
