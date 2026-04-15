import { MessageType } from "../enums";
import { normalizeTradingSignal } from "./SignalNormalizer";
import { BulkMessageInput, BulkSignalResult, TradingSignal } from "./types";

interface BulkSignalResponseItem {
  messageId?: string | number;
  signal?: Record<string, unknown> | null;
}

interface VisionExtractionPayload {
  isSignal?: boolean;
  messageType?: MessageType;
  extractedText?: string;
}

export interface VisionExtractionResult {
  isSignal: boolean;
  messageType?: MessageType;
  extractedText: string;
  rawResponse: string;
}

function stripCodeFences(response: string): string {
  return response
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

function extractJsonPayload(response: string): string | null {
  const cleaned = stripCodeFences(response);
  if (!cleaned) return null;

  if (
    (cleaned.startsWith("{") && cleaned.endsWith("}")) ||
    (cleaned.startsWith("[") && cleaned.endsWith("]"))
  ) {
    return cleaned;
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  return objectMatch ? objectMatch[0] : null;
}

export function parseJsonResponse<T>(response: string): T | null {
  const payload = extractJsonPayload(response);
  if (!payload) return null;

  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

export function parseSignalResponse(
  response: string,
  rawSignal?: string,
): TradingSignal | null {
  const parsed = parseJsonResponse<Record<string, unknown>>(response);
  const signal = normalizeTradingSignal(parsed);
  if (!signal) return null;

  return rawSignal ? { ...signal, rawSignal } : signal;
}

export function parseBulkSignalResponse(
  response: string,
  messages: BulkMessageInput[],
): BulkSignalResult[] | null {
  const parsed = parseJsonResponse<BulkSignalResponseItem[]>(response);
  if (!Array.isArray(parsed)) return null;

  const responseMap = new Map<string, TradingSignal | null>();
  for (const item of parsed) {
    const msgId = item?.messageId;
    if (msgId === undefined || msgId === null) continue;

    const signal =
      item?.signal && typeof item.signal === "object"
        ? normalizeTradingSignal(item.signal)
        : null;
    responseMap.set(String(msgId), signal);
  }

  const mapped = messages.map((msg, index) => ({
    messageId: msg.messageId,
    signal:
      responseMap.get(msg.messageId) ??
      responseMap.get(String(index + 1)) ??
      null,
  }));

  if (mapped.every((result) => result.signal === null) && parsed.length > 0) {
    return messages.map((msg, index) => {
      const item = parsed[index];
      const signal =
        item?.signal && typeof item.signal === "object"
          ? normalizeTradingSignal(item.signal)
          : null;
      return { messageId: msg.messageId, signal };
    });
  }

  return mapped;
}

export function parseVisionExtractionResponse(
  responseText: string,
): VisionExtractionResult {
  const parsed = parseJsonResponse<VisionExtractionPayload>(responseText);
  const messageType =
    typeof parsed?.messageType === "string"
      ? (parsed.messageType as MessageType)
      : undefined;
  const shouldIgnore =
    messageType === MessageType.RESULT_STATUS ||
    messageType === MessageType.IGNORE;

  return {
    isSignal: parsed?.isSignal === true && !shouldIgnore,
    messageType,
    extractedText:
      !shouldIgnore && typeof parsed?.extractedText === "string"
        ? parsed.extractedText
        : "",
    rawResponse: responseText,
  };
}
