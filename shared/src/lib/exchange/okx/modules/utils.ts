import CryptoJS from "crypto-js";

export function getOkxBaseUrl(): string {
  return (
    process.env.OKX_PROXY_URL ||
    process.env.OKX_BASE_URL ||
    "https://www.okx.com"
  );
}

export function signOkxRequest(
  timestamp: string,
  method: string,
  path: string,
  secretKey: string,
  body?: string,
): string {
  const message = timestamp + method + path + (body || "");
  return CryptoJS.HmacSHA256(message, secretKey).toString(
    CryptoJS.enc.Base64,
  );
}

export function getOkxTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export function buildOkxAuthHeaders(input: {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  simulated: boolean;
  method: string;
  path: string;
  body?: string;
}): Record<string, string> {
  const timestamp = getOkxTimestamp();
  const sign = signOkxRequest(
    timestamp,
    input.method,
    input.path,
    input.secretKey,
    input.body,
  );
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": input.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": input.passphrase,
  };
  if (input.simulated) {
    headers["x-simulated-trading"] = "1";
  }
  return headers;
}

export function formatOkxPayloadForError(
  payload?: string | Record<string, string>,
): string {
  if (!payload) return "";
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export function buildOkxPayloadError(
  message: string,
  payload?: string | Record<string, string>,
): Error {
  const payloadText = formatOkxPayloadForError(payload);
  return new Error(payloadText ? `${message} | payload=${payloadText}` : message);
}

export function isRetryableOkxAccountConfigError(
  code?: string,
  message?: string,
): boolean {
  if (code === "51010") return true;
  return code === "51000" && (message || "").toLowerCase().includes("posside");
}

export function toOkxSwapSymbol(symbol: string): string {
  if (symbol.includes("-")) return symbol;
  const quote = symbol.endsWith("USDT")
    ? "USDT"
    : symbol.endsWith("USD")
      ? "USD"
      : null;
  if (quote) {
    const base = symbol.slice(0, -quote.length);
    return `${base}-${quote}-SWAP`;
  }
  return `${symbol}-USDT-SWAP`;
}

export function fromOkxSwapSymbol(instId: string): string {
  return instId.replace(/-/g, "").replace("SWAP", "");
}

export function roundOkxQuantityToLotSize(
  quantity: number,
  lotSz: string,
  minSz: string,
): number {
  const lot = parseFloat(lotSz);
  const min = parseFloat(minSz);
  if (lot <= 0) return quantity;

  let rounded = Math.floor(quantity / lot) * lot;
  const decimals = lotSz.includes(".") ? lotSz.split(".")[1].length : 0;
  rounded = parseFloat(rounded.toFixed(decimals));

  if (rounded < min) {
    console.warn(
      `[OKX] ⚠️ Rounded quantity ${rounded} is below minSz ${min}, using minSz`,
    );
    rounded = min;
  }

  return rounded;
}
