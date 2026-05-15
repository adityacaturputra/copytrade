import axios, { type AxiosInstance } from "axios";

export async function setOkxAccountMode(input: {
  client: AxiosInstance;
  authHeaders: (method: string, path: string, body?: string) => Record<string, string>;
  accountMode?: "1" | "2" | "3" | "4";
}): Promise<void> {
  const accountMode = input.accountMode || "2";
  const path = "/api/v5/account/set-account-mode";
  const body = JSON.stringify({ acctMode: accountMode });
  const headers = input.authHeaders("POST", path, body);

  console.log(
    `[OKX] Setting account mode to ${accountMode} (${accountMode === "2" ? "Single-currency margin" : accountMode === "3" ? "Multi-currency margin" : "mode " + accountMode})...`,
  );

  try {
    const response = await input.client.post(path, body, { headers });
    const data = response.data;

    if (data.code === "0") {
      console.log(`[OKX] ✅ Account mode set to ${accountMode}`);
      return;
    }

    console.error(
      `[OKX] ❌ Failed to set account mode: code=${data.code}, msg=${data.msg}`,
    );
    throw new Error(
      `Failed to set OKX account mode: ${data.msg || "Unknown error"} (code: ${data.code})`,
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.warn(
        `[OKX] ⚠️ set-account-mode endpoint returned 404 — this is normal for simulated trading or when account mode is already correct`,
      );
      throw new Error(
        "set-account-mode not available (simulated trading or already configured)",
      );
    }
    throw error;
  }
}

export async function setOkxPositionMode(input: {
  client: AxiosInstance;
  authHeaders: (method: string, path: string, body?: string) => Record<string, string>;
  setCachedMode: (mode: "long_short_mode" | "net_mode") => void;
  positionMode?: "long_short_mode" | "net_mode";
}): Promise<void> {
  const positionMode = input.positionMode || "long_short_mode";
  const path = "/api/v5/account/set-position-mode";
  const body = JSON.stringify({ posMode: positionMode });
  const headers = input.authHeaders("POST", path, body);

  console.log(`[OKX] Setting position mode to "${positionMode}"...`);

  const response = await input.client.post(path, body, { headers });
  const data = response.data;

  if (data.code === "0") {
    console.log(`[OKX] ✅ Position mode set to ${positionMode}`);
    input.setCachedMode(positionMode);
    return;
  }

  console.error(
    `[OKX] ❌ Failed to set position mode: code=${data.code}, msg=${data.msg}`,
  );
  throw new Error(
    `Failed to set OKX position mode: ${data.msg || "Unknown error"} (code: ${data.code})`,
  );
}

export async function ensureOkxAccountConfigured(input: {
  symbol: string;
  setAccountMode: (accountMode?: "1" | "2" | "3" | "4") => Promise<void>;
  setPositionMode: (
    symbol: string,
    positionMode?: "long_short_mode" | "net_mode",
  ) => Promise<void>;
}): Promise<void> {
  try {
    await input.setAccountMode("2");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[OKX] ⚠️ Could not set account mode (may already be correct): ${errMsg}`,
    );
  }

  try {
    await input.setPositionMode(input.symbol, "long_short_mode");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[OKX] ⚠️ Could not set position mode (may already be correct): ${errMsg}`,
    );
  }
}
