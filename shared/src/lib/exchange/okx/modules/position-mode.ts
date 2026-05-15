import type { AxiosInstance } from "axios";

export async function getOkxPositionMode(input: {
  client: AxiosInstance;
  authHeaders: (method: string, path: string, body?: string) => Record<string, string>;
  forceRefresh?: boolean;
  cache?: { posMode: "long_short_mode" | "net_mode"; ts: number };
  cacheTtl: number;
  setCache: (cache: { posMode: "long_short_mode" | "net_mode"; ts: number }) => void;
}): Promise<"long_short_mode" | "net_mode"> {
  if (
    !input.forceRefresh &&
    input.cache &&
    Date.now() - input.cache.ts < input.cacheTtl
  ) {
    return input.cache.posMode;
  }

  const path = "/api/v5/account/config";
  const headers = input.authHeaders("GET", path);

  try {
    const response = await input.client.get(path, { headers });
    const data = response.data;
    const posMode = data?.data?.[0]?.posMode;

    if (posMode === "long_short_mode" || posMode === "net_mode") {
      input.setCache({ posMode, ts: Date.now() });
      return posMode;
    }
  } catch (error) {
    console.warn(
      `[OKX] ⚠️ Failed to read account config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return input.cache?.posMode || "long_short_mode";
}
