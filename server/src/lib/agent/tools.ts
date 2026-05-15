import type { ToolExecutor } from "./tooling/shared";
import { agentTools } from "./tooling/definitions";
import { accountMarketToolImplementations } from "./tooling/account-market-implementations";
import { draftsToolImplementations } from "./tooling/drafts-implementations";
import { logsSettingsToolImplementations } from "./tooling/logs-settings-implementations";
import { orderManagementToolImplementations } from "./tooling/order-management-implementations";
import { positionOpsToolImplementations } from "./tooling/position-ops/index";
import { sourceToolImplementations } from "./tooling/source-implementations";
import { tradingToolImplementations } from "./tooling/trading-implementations";

export { agentTools };

export const toolImplementations: Record<string, ToolExecutor> = {
  ...accountMarketToolImplementations,
  ...tradingToolImplementations,
  ...orderManagementToolImplementations,
  ...draftsToolImplementations,
  ...sourceToolImplementations,
  ...positionOpsToolImplementations,
  ...logsSettingsToolImplementations,
};
