/**
 * Custom Proxy Provider
 *
 * For self-hosted VPS or any manual proxy configuration.
 */

import { HttpsProxyAgent } from "https-proxy-agent";
import { IProxyProvider, ProxyInfoResult } from "./types";

export interface CustomProxySettings {
  host: string;
  port: number;
  username: string;
  password: string;
}

export class CustomProvider implements IProxyProvider {
  readonly name = "Custom";
  private settings: CustomProxySettings;

  constructor(settings: CustomProxySettings) {
    this.settings = settings;
  }

  /** Update settings (e.g., when DB config changes) */
  updateSettings(settings: CustomProxySettings): void {
    this.settings = settings;
  }

  async getProxyUrl(): Promise<string | null> {
    if (!this.settings.host) return null;
    return `http://${this.settings.username}:${this.settings.password}@${this.settings.host}:${this.settings.port}`;
  }

  async getProxyAgent(): Promise<HttpsProxyAgent<string> | null> {
    const proxyUrl = await this.getProxyUrl();
    if (!proxyUrl) return null;
    return new HttpsProxyAgent(proxyUrl);
  }

  async getProxyInfo(): Promise<ProxyInfoResult> {
    if (!this.settings.host) {
      return {
        success: false,
        error:
          "Custom proxy not configured. Set host, port, username, and password.",
      };
    }

    return {
      success: true,
      credentials: {
        username: this.settings.username,
        password: this.settings.password,
      },
      proxies: [
        {
          ip: this.settings.host,
          port: this.settings.port,
          username: this.settings.username,
          password: this.settings.password,
          valid: true,
          country_code: "-",
          city_name: "Custom",
        },
      ],
      ipList: [this.settings.host],
      total: 1,
      validCount: 1,
    };
  }
}
