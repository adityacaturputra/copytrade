import type { ProxyAgentLike } from "../types";

type HttpsProxyAgentCtor = new (proxyUrl: string) => ProxyAgentLike;

let cachedCtor: HttpsProxyAgentCtor | null = null;

export async function createHttpsProxyAgent(
  proxyUrl: string,
): Promise<ProxyAgentLike> {
  if (!cachedCtor) {
    const mod = await import("https-proxy-agent");
    cachedCtor = mod.HttpsProxyAgent as unknown as HttpsProxyAgentCtor;
  }
  return new cachedCtor(proxyUrl);
}
