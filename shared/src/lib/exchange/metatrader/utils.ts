export function parseMetaTraderNumber(value: unknown, fallback: number = 0): number {
  const parsed = typeof value === "number" ? value : parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseMetaTraderTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) return asDate;
  }
  return undefined;
}

export function countMetaTraderDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = value.toString();
  if (!text.includes(".")) return 0;
  const [, frac = ""] = text.split(".");
  return frac.replace(/0+$/, "").length;
}

export function normalizeMetaTraderSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function normalizeMetaTraderSide(value: unknown): "LONG" | "SHORT" {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "sell" ||
    normalized === "short" ||
    normalized === "1" ||
    normalized === "sell_limit" ||
    normalized === "sell_stop"
  ) {
    return "SHORT";
  }
  return "LONG";
}

export function normalizeMetaTraderOrderSide(value: unknown): "BUY" | "SELL" {
  return normalizeMetaTraderSide(value) === "SHORT" ? "SELL" : "BUY";
}

export function normalizeMetaTraderStatus(value: unknown, fallback: string): string {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function extractMetaTraderArray<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];

  for (const key of keys) {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }

  if ("data" in payload) {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return data as T[];
  }

  return [];
}

export function extractMetaTraderObject<T>(payload: unknown, keys: string[]): T {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as T;
      }
    }
    return payload as T;
  }
  return {} as T;
}
