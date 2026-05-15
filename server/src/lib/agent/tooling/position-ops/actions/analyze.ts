import { Position } from "@copytrade/shared/lib/database/index";
import { AIFactory } from "@copytrade/shared/lib/ai/AIFactory";
import { buildPositionAnalysisInput } from "@copytrade/shared/lib/ai/PositionMonitorContext";
import { logProcessStep } from "@copytrade/shared/lib/process/log";
import { ensurePersistedProcessId, getResolvedProcessId } from "@copytrade/shared/lib/process/id";
import { findPositionRecord, getLivePositionSnapshot } from "../../shared";

export async function analyzePositionContext(args: Record<string, unknown>) {
  const position = await findPositionRecord(args);
  const positionDoc = await Position.findById(String(position._id)).exec();
  const processId = positionDoc ? await ensurePersistedProcessId(positionDoc, "agentpos") : getResolvedProcessId(position.processId, "agentpos");
  const { currentPrice, pnlPercent, exchangePosition } = await getLivePositionSnapshot(position);
  const aiInput = await buildPositionAnalysisInput(position, currentPrice, pnlPercent, processId);
  const analysis = await AIFactory.getAnalyzer().analyzePosition(aiInput);
  await logProcessStep({ accountId: position.accountId, processId, type: "agent_tool", action: "analyze_position_context", symbol: position.symbol, details: { positionId: String(position._id), currentPrice, pnlPercent, decision: analysis.decision, confidence: analysis.confidence }, result: "success" });
  return JSON.stringify({ success: true, processId, positionId: String(position._id), symbol: position.symbol, accountId: position.accountId || null, liveSnapshot: { currentPrice, pnlPercent, exchangePosition }, aiInput, analysis });
}
