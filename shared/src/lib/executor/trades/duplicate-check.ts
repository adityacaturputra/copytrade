import { Position, buildTPTargets } from "../../database";
import type { DuplicateCheckResult } from "../types";

export async function checkDuplicatePosition(
  symbol: string,
  side: "LONG" | "SHORT",
  channelId: string | undefined,
  entryPrice: number | null | undefined,
  takeProfitTargets: number[],
  stopLoss: number | null | undefined,
): Promise<DuplicateCheckResult> {
  const existingPos = await Position.findOne({
    symbol,
    side,
    channelId: channelId || null,
    status: "open",
  });

  if (!existingPos) return { type: "new" };

  const newTP = takeProfitTargets?.[0] ?? null;
  const newSL = stopLoss ?? null;
  const existingTP = existingPos.takeProfitTargets?.[0]?.price ?? null;
  const existingSL = existingPos.stopLossPrice ?? null;
  const existingEntry = existingPos.entryPrice ?? null;
  const newEntry = entryPrice ?? null;

  const numEqual = (
    a: number | null | undefined,
    b: number | null | undefined,
  ) => {
    if ((a === null || a === undefined) && (b === null || b === undefined))
      return true;
    if (a === null || a === undefined || b === null || b === undefined)
      return false;
    return Math.abs(a - b) < 0.01;
  };

  // null entry from same channel = referring to existing position
  const entryMatch =
    newEntry === null ? true : numEqual(newEntry, existingEntry);
  const tpMatch = numEqual(newTP, existingTP);
  const slMatch = numEqual(newSL, existingSL);

  if (entryMatch && tpMatch && slMatch) {
    return { type: "duplicate_exact" };
  }

  if (entryMatch) {
    let updated = false;
    const updates: string[] = [];

    if (!tpMatch && newTP !== null) {
      const newTargets = buildTPTargets([newTP], existingPos.quantity);
      existingPos.takeProfitTargets = newTargets;
      updates.push(`TP: ${existingTP} → ${newTP}`);
      updated = true;
    }
    if (!slMatch && newSL !== null) {
      existingPos.stopLossPrice = newSL;
      updates.push(`SL: ${existingSL} → ${newSL}`);
      updated = true;
    }

    if (updated) {
      await existingPos.save();
      return { type: "duplicate_updated", updates };
    }
    return { type: "duplicate_no_update" };
  }

  // Different entry price — genuinely new signal
  return { type: "new" };
}

/**
 * Core trade execution — single source of truth for:
 *   Risk sizing → Set leverage → Place order → TP/SL → Save position
 *
 * Called by both `executeSignal` (auto mode) and `/api/drafts/[id]/accept` (manual mode).
 * Does NOT handle duplicate checks, max-positions, or skipNoSL — those are
 * the caller's responsibility.
 */
