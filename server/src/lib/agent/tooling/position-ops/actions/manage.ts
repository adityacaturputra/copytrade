import { Position } from "@copytrade/shared/lib/database/index";
import { ensurePersistedProcessId } from "@copytrade/shared/lib/process/id";
import { logProcessStep } from "@copytrade/shared/lib/process/log";
import { findPositionRecord, getLivePositionSnapshot, normalizePositiveNumber, toClosingSide, parseOptionalString } from "../../shared";

export async function managePosition(args: Record<string, unknown>) {
  const position = await findPositionRecord(args);
  const positionDoc = await Position.findById(String(position._id)).exec();
  if (!positionDoc) throw new Error(`Position document not found: ${String(position._id)}`);
  const processId = await ensurePersistedProcessId(positionDoc, "agentman");
  const action = parseOptionalString(args.action);
  const reason = parseOptionalString(args.reason) || "Agent discretionary action";
  if (!action || !["close", "partial_close"].includes(action)) throw new Error(`Invalid action for manage_position: ${String(action)}`);
  const { exchange, currentPrice, pnlPercent } = await getLivePositionSnapshot(position);
  let closeQuantity = positionDoc.quantity;
  if (action === "partial_close") {
    const requested = normalizePositiveNumber(args.quantity, 0);
    if (requested <= 0 || requested >= positionDoc.quantity) throw new Error(`Partial close requires quantity between 0 and ${positionDoc.quantity}`);
    closeQuantity = requested;
  }
  const side = toClosingSide(position.side);
  const result = await exchange.placeOrder({ symbol: position.symbol, side, quantity: closeQuantity, type: "MARKET" });
  if (action === "close") {
    positionDoc.status = "closed";
    positionDoc.closedAt = new Date();
    positionDoc.closeReason = reason;
  } else {
    positionDoc.quantity -= closeQuantity;
    positionDoc.closeReason = `Partial close (${closeQuantity}): ${reason}`;
  }
  await positionDoc.save();
  const response = { success: true, processId, positionId: String(position._id), symbol: position.symbol, action, quantity: closeQuantity, reason, orderResult: result, currentPrice, pnlPercent };
  await logProcessStep({ accountId: position.accountId, processId, type: "agent_tool", action: "manage_position", symbol: position.symbol, details: response, result: "success" });
  return JSON.stringify(response);
}
