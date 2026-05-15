import { Position } from "@copytrade/shared/lib/database/index";
import { buildProtectionSnapshot, normalizeProtectionTargets, getDbTakeProfitTargets } from "../../position-protection";
import { ensurePersistedProcessId } from "@copytrade/shared/lib/process/id";
import { logProcessStep } from "@copytrade/shared/lib/process/log";
import { findPositionRecord, getLivePositionSnapshot, normalizePositiveNumber, roundPrice } from "../../shared";

export async function getPositionProtection(args: Record<string, unknown>) {
  const position = await findPositionRecord(args);
  const positionDoc = await Position.findById(String(position._id)).exec();
  if (!positionDoc) throw new Error(`Position document not found: ${String(position._id)}`);
  const processId = await ensurePersistedProcessId(positionDoc, "agentprot");
  const { exchange, currentPrice, pnlPercent, exchangePosition } = await getLivePositionSnapshot(position);
  const protection = await buildProtectionSnapshot(positionDoc.toObject(), exchange);
  const response = { success: true, processId, positionId: String(position._id), accountId: position.accountId || null, symbol: position.symbol, side: position.side, liveSnapshot: { currentPrice, pnlPercent, exchangePosition }, protection };
  await logProcessStep({ accountId: position.accountId, processId, type: "agent_tool", action: "get_position_protection", symbol: position.symbol, details: response, result: "success" });
  return JSON.stringify(response);
}
