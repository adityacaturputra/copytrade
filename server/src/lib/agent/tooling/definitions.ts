import OpenAI from "openai";
import { account_marketTools } from "./categories/account-market";
import { orders_tradingTools } from "./categories/orders-trading";
import { order_mgmtTools } from "./categories/order-mgmt";
import { draftsTools } from "./categories/drafts";
import { signal_sourcesTools } from "./categories/signal-sources";
import { position_opsTools } from "./categories/position-ops";
import { database_logsTools } from "./categories/database-logs";
import { settings_riskTools } from "./categories/settings-risk";

export const agentTools: OpenAI.ChatCompletionTool[] = [
  ...account_marketTools,
  ...orders_tradingTools,
  ...order_mgmtTools,
  ...draftsTools,
  ...signal_sourcesTools,
  ...position_opsTools,
  ...database_logsTools,
  ...settings_riskTools
];
