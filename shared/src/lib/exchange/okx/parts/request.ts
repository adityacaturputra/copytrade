import axios from "axios";
import CryptoJS from "crypto-js";

export function getOkxTimestamp(): string {
  return new Date().toISOString();
}

export function signOkx(timestamp: string, method: string, path: string, body: string, secretKey: string): string {
  const message = timestamp + method.toUpperCase() + path + body;
  return CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(message, secretKey));
}

export async function okxRequest(ctx: any, method: "GET" | "POST", path: string, payload: any = {}): Promise<any> {
  const body = method === "POST" ? JSON.stringify(payload) : "";
  const headers = ctx.authHeaders(method, path, body);
  const response = method === "GET" ? await ctx.client.get(path, { headers, params: payload }) : await ctx.client.post(path, body, { headers });
  if (response.data.code !== "0") throw new Error(response.data.msg || "OKX API error");
  return response.data;
}
