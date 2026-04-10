declare module "https-proxy-agent" {
  export class HttpsProxyAgent<T = Record<string, unknown>> {
    constructor(proxy: string | URL | Record<string, unknown>);
  }
}

declare module "crypto-js" {
  const CryptoJS: any;
  export = CryptoJS;
}
