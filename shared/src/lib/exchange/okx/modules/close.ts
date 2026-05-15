import type { AxiosInstance } from "axios";
import type { PositionInfo } from "../../types";

export async function closeOkxPosition(input: {
  client: AxiosInstance;
  symbol: string;
  positionId?: string;
  quantity?: number;
  authHeaders: (method: string, path: string, body?: string) => Record<string, string>;
  toOkxSymbol: (symbol: string) => string;
  getPositionMode: () => Promise<"long_short_mode" | "net_mode">;
  getOpenPositions: () => Promise<PositionInfo[]>;
}): Promise<void> {
  const instId = input.toOkxSymbol(input.symbol);
  const positionMode = await input.getPositionMode();
  const positions = await input.getOpenPositions();
  const pos = positions.find(
    (item) => item.symbol === input.symbol || item.positionId === input.positionId,
  );

  if (!pos) throw new Error(`No open position found for ${input.symbol}`);

  const posSide =
    positionMode === "long_short_mode"
      ? pos.side === "LONG"
        ? "long"
        : "short"
      : undefined;
  const mgnMode = pos.marginType || "isolated";

  const closePayload: Record<string, string> = {
    instId,
    mgnMode,
    type: "market",
    sz: String(input.quantity || pos.quantity),
    side: pos.side === "LONG" ? "sell" : "buy",
    tdMode: mgnMode,
  };
  if (posSide) closePayload.posSide = posSide;
  const closeBody = JSON.stringify(closePayload);

  const closePath = "/api/v5/trade/close-position";
  const closeHeaders = input.authHeaders("POST", closePath, closeBody);

  console.log(
    `[OKX] 📤 Closing position: ${instId}${posSide ? ` ${posSide}` : ""} (${mgnMode}) qty=${input.quantity || pos.quantity}...`,
  );

  try {
    const response = await input.client.post(closePath, closeBody, { headers: closeHeaders });
    const data = response.data;
    if (data.code === "0" && data.data?.[0]?.sCode === "0") {
      console.log(`[OKX] ✅ Position closed: ${instId}`);
      return;
    }
    console.warn(
      `[OKX] ⚠️ close-position failed (${mgnMode}): code=${data.code}, msg=${data.msg}. Trying opposite order...`,
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[OKX] ⚠️ close-position request failed: ${errMsg}. Trying opposite order...`);
  }

  const fallbackPayload: Record<string, string> = {
    instId,
    tdMode: mgnMode,
    side: pos.side === "LONG" ? "sell" : "buy",
    ordType: "market",
    sz: String(input.quantity || pos.quantity),
    reduceOnly: "true",
  };
  if (posSide) fallbackPayload.posSide = posSide;
  const fallbackBody = JSON.stringify(fallbackPayload);

  const orderPath = "/api/v5/trade/order";
  const fallbackHeaders = input.authHeaders("POST", orderPath, fallbackBody);
  console.log(`[OKX] 📤 Placing opposite order to close: ${instId} (${mgnMode})...`);

  const fallbackResp = await input.client.post(orderPath, fallbackBody, { headers: fallbackHeaders });
  const fallbackData = fallbackResp.data;
  if (fallbackData.code !== "0" || fallbackData.data?.[0]?.sCode !== "0") {
    console.error(`[OKX] ❌ Failed to close position:`, JSON.stringify(fallbackData, null, 2));
    throw new Error(
      `Failed to close OKX position: ${fallbackData.msg || fallbackData.data?.[0]?.sMsg || "Unknown error"}`,
    );
  }

  console.log(`[OKX] ✅ Position closed via opposite order: ${instId}`);
}

export async function closeAllOkxPositions(input: {
  getOpenPositions: () => Promise<PositionInfo[]>;
  closePosition: (symbol: string, positionId?: string, quantity?: number) => Promise<void>;
}): Promise<{ closed: string[]; errors: string[] }> {
  const closed: string[] = [];
  const errors: string[] = [];

  try {
    const positions = await input.getOpenPositions();
    for (const pos of positions) {
      try {
        await input.closePosition(pos.symbol, pos.positionId, pos.quantity);
        closed.push(pos.symbol);
      } catch (error) {
        errors.push(`${pos.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  } catch (error) {
    errors.push(`Failed to fetch positions: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  return { closed, errors };
}
