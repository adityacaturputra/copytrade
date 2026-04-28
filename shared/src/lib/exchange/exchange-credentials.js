"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExchangeCredentials = buildExchangeCredentials;
const provider_config_1 = require("./provider-config");
function buildExchangeCredentials(providerValue, exchangeData) {
    const provider = (0, provider_config_1.normalizeExchangeProvider)(providerValue);
    if (!provider)
        return null;
    const data = exchangeData || {};
    return {
        ...data,
        provider,
        apiKey: typeof data.apiKey === "string" ? data.apiKey : undefined,
        secretKey: typeof data.secretKey === "string" ? data.secretKey : undefined,
        passphrase: typeof data.passphrase === "string" ? data.passphrase : undefined,
        simulated: typeof data.simulated === "boolean" ? data.simulated : undefined,
        baseUrl: typeof data.baseUrl === "string" ? data.baseUrl : undefined,
        login: typeof data.login === "string" ? data.login : undefined,
        password: typeof data.password === "string" ? data.password : undefined,
        server: typeof data.server === "string" ? data.server : undefined,
        platform: typeof data.platform === "string" ? data.platform : undefined,
        bridgeToken: typeof data.bridgeToken === "string" ? data.bridgeToken : undefined,
    };
}
//# sourceMappingURL=exchange-credentials.js.map