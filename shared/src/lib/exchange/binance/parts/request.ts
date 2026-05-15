import axios from "axios";
import { getCurrentProxyMeta, markCurrentProxyCountryBlocked, markCurrentProxyIpBlocked, markCurrentProxySuccessful } from "../../../proxy/ProxyFactory";
import { BinanceCtx } from "./types";

export async function binanceRequest(ctx: BinanceCtx, method: string, path: string, params: Record<string, any> = {}): Promise<any> {
  try {
    const query = ctx.buildSignedQuery(params);
    const url = `${path}?${query}`;
    let response;
    if (method === "GET") response = await ctx.client.get(url);
    else if (method === "POST") response = await ctx.client.post(url);
    else if (method === "DELETE") response = await ctx.client.delete(url);
    else throw new Error(`Unsupported method ${method}`);

    await markCurrentProxySuccessful();
    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      await markCurrentProxyCountryBlocked();
    }
    throw error;
  }
}
