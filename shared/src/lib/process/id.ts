import { createTradeProcessId } from "./log";

type ProcessTrackedDocument = {
  processId?: string | null;
  save: () => Promise<unknown>;
};

export function getResolvedProcessId(
  currentProcessId: string | null | undefined,
  fallbackPrefix: string,
): string {
  if (typeof currentProcessId === "string" && currentProcessId.trim().length > 0) {
    return currentProcessId.trim();
  }

  return createTradeProcessId(fallbackPrefix);
}

export async function ensurePersistedProcessId<T extends ProcessTrackedDocument>(
  document: T,
  fallbackPrefix: string,
): Promise<string> {
  const processId = getResolvedProcessId(document.processId, fallbackPrefix);

  if (document.processId === processId) {
    return processId;
  }

  document.processId = processId;
  await document.save();
  return processId;
}
