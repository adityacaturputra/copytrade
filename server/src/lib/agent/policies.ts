import type { AgentRole } from "./auth";

export type AgentToolMode = "read" | "mutating";

export interface AgentToolPolicy {
  mode: AgentToolMode;
  minimumRole: AgentRole;
  requiresApproval: boolean;
}

const READ_ONLY_POLICY: AgentToolPolicy = {
  mode: "read",
  minimumRole: "viewer",
  requiresApproval: false,
};

const OPERATOR_MUTATING_POLICY: AgentToolPolicy = {
  mode: "mutating",
  minimumRole: "operator",
  requiresApproval: true,
};

const ADMIN_MUTATING_POLICY: AgentToolPolicy = {
  mode: "mutating",
  minimumRole: "admin",
  requiresApproval: true,
};

export const agentToolPolicies: Record<string, AgentToolPolicy> = {
  get_trading_accounts: READ_ONLY_POLICY,
  get_account_info: READ_ONLY_POLICY,
  get_ticker_price: READ_ONLY_POLICY,
  get_open_positions: READ_ONLY_POLICY,
  get_exchange_positions: READ_ONLY_POLICY,
  get_klines: READ_ONLY_POLICY,
  get_open_orders: READ_ONLY_POLICY,
  get_algo_orders: READ_ONLY_POLICY,
  get_order_history: READ_ONLY_POLICY,
  get_pending_drafts: READ_ONLY_POLICY,
  get_signal_sources: READ_ONLY_POLICY,
  check_source_health: READ_ONLY_POLICY,
  fetch_source_messages: READ_ONLY_POLICY,
  get_discord_sources: READ_ONLY_POLICY,
  get_telegram_sources: READ_ONLY_POLICY,
  check_telegram_source_health: READ_ONLY_POLICY,
  analyze_position_context: READ_ONLY_POLICY,
  review_signal_thread: READ_ONLY_POLICY,
  get_process_logs: READ_ONLY_POLICY,
  get_stats: READ_ONLY_POLICY,
  get_recent_logs: READ_ONLY_POLICY,
  get_recent_signals: READ_ONLY_POLICY,
  get_all_positions_history: READ_ONLY_POLICY,
  get_trading_mode: READ_ONLY_POLICY,
  get_risk_settings: READ_ONLY_POLICY,
  calculate_risk_preview: READ_ONLY_POLICY,

  place_order: OPERATOR_MUTATING_POLICY,
  close_position: OPERATOR_MUTATING_POLICY,
  set_leverage: OPERATOR_MUTATING_POLICY,
  set_stop_loss: OPERATOR_MUTATING_POLICY,
  set_take_profit: OPERATOR_MUTATING_POLICY,
  cancel_order: OPERATOR_MUTATING_POLICY,
  cancel_all_orders: OPERATOR_MUTATING_POLICY,
  cancel_algo_orders: OPERATOR_MUTATING_POLICY,
  modify_stop_loss: OPERATOR_MUTATING_POLICY,
  modify_take_profit: OPERATOR_MUTATING_POLICY,
  accept_draft: OPERATOR_MUTATING_POLICY,
  reject_draft: OPERATOR_MUTATING_POLICY,
  manage_position: OPERATOR_MUTATING_POLICY,
  sync_position_with_exchange: OPERATOR_MUTATING_POLICY,

  close_all_positions: ADMIN_MUTATING_POLICY,
  accept_all_drafts: ADMIN_MUTATING_POLICY,
  reject_all_drafts: ADMIN_MUTATING_POLICY,
  set_trading_mode: ADMIN_MUTATING_POLICY,
  check_signal_now: ADMIN_MUTATING_POLICY,
};

export function getAgentToolPolicy(toolName: string): AgentToolPolicy | null {
  return agentToolPolicies[toolName] || null;
}
