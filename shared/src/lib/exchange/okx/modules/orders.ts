import axios, { type AxiosInstance } from "axios";
import type { OrderParams, OrderResult } from "../../types";

export async function placeOkxOrder(input: {
  client: AxiosInstance;
  orderParams: OrderParams;
  authHeaders: (method: string, path: string, body?: string) => Record<string, string>;
  isAccountConfigRetryable: (code?: string, message?: string) => boolean;
  buildPayloadError: (message: string, payload?: string | Record<string, string>) => Error;
  toOkxSymbol: (symbol: string) => string;
  getPositionMode: () => Promise<"long_short_mode" | "net_mode">;
  validateInstrument: (symbol: string) => Promise<{ ctVal: string; lotSz: string; minSz: string }>;
  roundToLotSize: (quantity: number, lotSz: string, minSz: string) => number;
  setLeverage: (
    symbol: string,
    leverage: number,
    marginMode?: "cross" | "isolated",
    sideHint?: "BUY" | "SELL",
  ) => Promise<unknown>;
  getTickerPrice: (symbol: string) => Promise<number>;
  handleAccountConfigRetry: (
    orderBody: Record<string, string>,
    orderParams: OrderParams,
    path: string,
  ) => Promise<OrderResult>;
}): Promise<OrderResult> {
  const instId = input.toOkxSymbol(input.orderParams.symbol);
  const isBuy = input.orderParams.side === "BUY";
  const positionMode = await input.getPositionMode();
  const posSide =
    positionMode === "long_short_mode" ? (isBuy ? "long" : "short") : undefined;

  let instrumentInfo: Awaited<ReturnType<typeof input.validateInstrument>>;
  try {
    instrumentInfo = await input.validateInstrument(input.orderParams.symbol);
  } catch (validationError) {
    const errMsg = validationError instanceof Error ? validationError.message : String(validationError);
    console.error(`[OKX] ❌ Instrument validation failed: ${errMsg}`);
    throw validationError;
  }

  const ctVal = parseFloat(instrumentInfo.ctVal || "1");
  const contracts = input.orderParams.quantity / ctVal;
  const roundedQty = input.roundToLotSize(
    contracts,
    instrumentInfo.lotSz,
    instrumentInfo.minSz,
  );

  if (contracts !== roundedQty) {
    console.log(
      `[OKX] 🔢 Quantity: ${input.orderParams.quantity} base → ${contracts.toFixed(4)} contracts → ${roundedQty} contracts (ctVal=${ctVal}, lotSz=${instrumentInfo.lotSz}, minSz=${instrumentInfo.minSz})`,
    );
  }

  if (roundedQty <= 0) {
    throw new Error(
      `Order quantity too small: ${input.orderParams.quantity} base → ${contracts.toFixed(6)} contracts → ${roundedQty} after lot size rounding (ctVal=${ctVal}, lotSz=${instrumentInfo.lotSz}, minSz=${instrumentInfo.minSz})`,
    );
  }

  if (input.orderParams.leverage) {
    await input.setLeverage(
      input.orderParams.symbol,
      input.orderParams.leverage,
      "isolated",
      input.orderParams.side,
    );
  }

  const orderBody: Record<string, string> = {
    instId,
    tdMode: "isolated",
    side: isBuy ? "buy" : "sell",
    ordType: input.orderParams.type === "LIMIT" ? "limit" : "market",
    sz: String(roundedQty),
  };
  if (posSide) orderBody.posSide = posSide;
  if (input.orderParams.type === "LIMIT" && input.orderParams.price) {
    orderBody.px = String(input.orderParams.price);
  }

  const body = JSON.stringify(orderBody);
  const path = "/api/v5/trade/order";
  const headers = input.authHeaders("POST", path, body);

  console.log(
    `[OKX] 📤 Placing order: ${isBuy ? "BUY" : "SELL"} ${input.orderParams.quantity} ${instId}${posSide ? ` (posSide=${posSide})` : ` (posMode=${positionMode})`}...`,
  );

  let response;
  try {
    response = await input.client.post(path, body, { headers });
  } catch (axiosError) {
    const errMsg = axiosError instanceof Error ? axiosError.message : String(axiosError);
    console.error(`[OKX] ❌ Order request failed: ${errMsg}`);

    if (axios.isAxiosError(axiosError) && axiosError.response?.data) {
      const errorData = axiosError.response.data;
      console.error(`[OKX] 📄 Response body:`, JSON.stringify(errorData, null, 2));
      const sCode = errorData?.data?.[0]?.sCode;
      const sMsg = errorData?.data?.[0]?.sMsg;
      if (
        input.isAccountConfigRetryable(sCode, sMsg) ||
        input.isAccountConfigRetryable(errorData?.code, errorData?.msg)
      ) {
        return input.handleAccountConfigRetry(orderBody, input.orderParams, path);
      }
    }

    throw input.buildPayloadError(`OKX order request failed: ${errMsg}`, orderBody);
  }

  const data = response.data;
  if (input.isAccountConfigRetryable(data.data?.[0]?.sCode, data.data?.[0]?.sMsg)) {
    console.warn(
      `[OKX] ⚠️ Detected account configuration error in order response — attempting auto-fix`,
    );
    return input.handleAccountConfigRetry(orderBody, input.orderParams, path);
  }

  if (data.code === "0" && data.data?.[0]) {
    const result = data.data[0];
    if (result.sCode === "0") {
      const price = input.orderParams.price || (await input.getTickerPrice(input.orderParams.symbol));
      console.log(`[OKX] ✅ Order placed: orderId=${result.ordId}, price=${price}`);
      return {
        orderId: result.ordId,
        price,
        quantity: roundedQty,
        status: "submitted",
      };
    }

    console.error(`[OKX] ❌ Order rejected: sCode=${result.sCode}, sMsg=${result.sMsg}`);
    throw input.buildPayloadError(
      `OKX order rejected: [${result.sCode}] ${result.sMsg}`,
      orderBody,
    );
  }

  const specificError = data.data?.[0];
  if (specificError?.sMsg) {
    console.error(
      `[OKX] ❌ Failed to place order: sCode=${specificError.sCode}, sMsg=${specificError.sMsg}`,
    );
    throw input.buildPayloadError(
      `OKX order failed: [${specificError.sCode}] ${specificError.sMsg}`,
      orderBody,
    );
  }

  console.error(`[OKX] ❌ Failed to place order: code=${data.code}, msg=${data.msg}`);
  throw input.buildPayloadError(
    `Failed to place OKX order: [${data.code}] ${data.msg || "Unknown error"}`,
    orderBody,
  );
}

export async function retryOkxOrderAfterAccountFix(input: {
  client: AxiosInstance;
  orderBody: Record<string, string>;
  orderParams: OrderParams;
  path: string;
  authHeaders: (method: string, path: string, body?: string) => Record<string, string>;
  buildPayloadError: (message: string, payload?: string | Record<string, string>) => Error;
  ensureAccountConfigured: (symbol: string) => Promise<void>;
  setLeverage: (
    symbol: string,
    leverage: number,
    marginMode?: "cross" | "isolated",
    sideHint?: "BUY" | "SELL",
  ) => Promise<unknown>;
  getTickerPrice: (symbol: string) => Promise<number>;
}): Promise<OrderResult> {
  console.warn(
    `[OKX] ⚠️ Account/position mode incompatible. Auto-fixing account configuration...`,
  );
  await input.ensureAccountConfigured(input.orderParams.symbol);

  if (input.orderParams.leverage) {
    await input.setLeverage(
      input.orderParams.symbol,
      input.orderParams.leverage,
      "isolated",
      input.orderParams.side,
    );
  }

  console.log(`[OKX] 🔄 Retrying order after account fix...`);
  const retryBody = JSON.stringify(input.orderBody);
  const retryHeaders = input.authHeaders("POST", input.path, retryBody);

  try {
    const retryResponse = await input.client.post(input.path, retryBody, {
      headers: retryHeaders,
    });
    const retryData = retryResponse.data;

    if (
      retryData.code === "0" &&
      retryData.data?.[0] &&
      retryData.data[0].sCode === "0"
    ) {
      const retryResult = retryData.data[0];
      const price = input.orderParams.price || (await input.getTickerPrice(input.orderParams.symbol));
      console.log(
        `[OKX] ✅ Order succeeded after auto-fix: orderId=${retryResult.ordId}`,
      );
      return {
        orderId: retryResult.ordId,
        price,
        quantity: input.orderParams.quantity,
        status: "submitted",
      };
    }

    console.error(`[OKX] ❌ Order still failed after auto-fix:`, JSON.stringify(retryData, null, 2));
    const retryErrMsg = retryData.data?.[0]?.sMsg || retryData.msg || "Unknown error";
    const retryErrCode = retryData.data?.[0]?.sCode || retryData.code;
    throw input.buildPayloadError(
      `OKX order failed after auto-fix: [${retryErrCode}] ${retryErrMsg}`,
      retryBody,
    );
  } catch (retryError) {
    if (axios.isAxiosError(retryError) && retryError.response?.data) {
      console.error(
        `[OKX] ❌ Retry request failed with status ${retryError.response.status}:`,
        JSON.stringify(retryError.response.data, null, 2),
      );
    }
    const retryErrMsg = retryError instanceof Error ? retryError.message : String(retryError);
    throw input.buildPayloadError(
      `OKX order retry request failed: ${retryErrMsg}`,
      retryBody,
    );
  }
}

