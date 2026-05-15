import axios from "axios";

type HttpErrorFormatOptions = {
  payload?: unknown;
  includeResponseBody?: boolean;
  messageKeys?: string[];
  codeKeys?: string[];
};

type HttpErrorDetails = {
  status?: number;
  code?: string;
  message: string;
  responseBody?: string;
};

const DEFAULT_MESSAGE_KEYS = [
  "msg",
  "message",
  "retMsg",
  "sMsg",
  "error_description",
  "error",
] as const;

const DEFAULT_CODE_KEYS = ["code", "retCode", "sCode", "errCode"] as const;

function serializeUnknown(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readFirstValue(
  value: unknown,
  keys: readonly string[],
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
    if (typeof candidate === "number" || typeof candidate === "boolean") {
      return String(candidate);
    }
  }

  return undefined;
}

export function getHttpErrorDetails(
  error: unknown,
  options: Omit<HttpErrorFormatOptions, "payload" | "includeResponseBody"> = {},
): HttpErrorDetails {
  const messageKeys = options.messageKeys || [...DEFAULT_MESSAGE_KEYS];
  const codeKeys = options.codeKeys || [...DEFAULT_CODE_KEYS];

  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;
    const responseBody =
      responseData !== undefined ? serializeUnknown(responseData) : undefined;
    const message =
      readFirstValue(responseData, messageKeys) ||
      (responseBody && typeof responseData === "string" ? responseBody : "") ||
      error.message ||
      "Unknown HTTP error";
    const code = readFirstValue(responseData, codeKeys);

    return {
      status: error.response?.status,
      code,
      message,
      responseBody,
    };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

export function buildHttpErrorMessage(
  prefix: string,
  error: unknown,
  options: HttpErrorFormatOptions = {},
): string {
  const details = getHttpErrorDetails(error, options);
  const parts = [prefix];

  if (typeof details.status === "number") {
    parts.push(`status=${details.status}`);
  }

  if (details.code) {
    parts.push(`code=${details.code}`);
  }

  let message = `${parts.join(" ")}: ${details.message}`;

  if (options.payload !== undefined) {
    message += ` | payload=${serializeUnknown(options.payload)}`;
  }

  if (
    options.includeResponseBody !== false &&
    details.responseBody &&
    details.responseBody !== details.message
  ) {
    message += ` | response=${details.responseBody}`;
  }

  return message;
}
