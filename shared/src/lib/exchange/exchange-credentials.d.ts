import { type ExchangeProvider } from "./provider-config";
/**
 * ExchangeCredentials — per-account exchange configuration stored in DB.
 */
export interface ExchangeCredentials {
    provider: ExchangeProvider;
    apiKey?: string;
    secretKey?: string;
    passphrase?: string;
    simulated?: boolean;
    baseUrl?: string;
    login?: string;
    password?: string;
    server?: string;
    platform?: string;
    bridgeToken?: string;
    [key: string]: unknown;
}
export type ExchangeCredentialValues = Omit<ExchangeCredentials, "provider">;
export declare function buildExchangeCredentials(providerValue: unknown, exchangeData?: Record<string, unknown> | null): ExchangeCredentials | null;
//# sourceMappingURL=exchange-credentials.d.ts.map