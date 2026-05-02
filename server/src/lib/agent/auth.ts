import type { Request } from "express";

export type AgentRole = "viewer" | "operator" | "admin";

export interface AgentAuthResult {
  role: AgentRole;
  source: "header" | "body" | "default";
}

const ROLE_PRIORITY: Record<AgentRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

/**
 * Agent auth is now open — no password required to chat.
 * Mutating actions are protected by ACTION_PASSWORD instead (see action-auth.ts).
 * Always returns admin role so all tools are available;
 * mutating tools are gated by the action password in the loop.
 */
export function isAgentAuthConfigured(): boolean {
  return true;
}

export function authenticateAgentRequest(_req: Request): AgentAuthResult {
  return { role: "admin", source: "default" };
}

export function hasRequiredAgentRole(
  actualRole: AgentRole,
  minimumRole: AgentRole,
): boolean {
  return ROLE_PRIORITY[actualRole] >= ROLE_PRIORITY[minimumRole];
}

export function getAgentApprovalRequired(): boolean {
  return (
    (process.env.AGENT_REQUIRE_MUTATION_APPROVAL || "true")
      .trim()
      .toLowerCase() !== "false"
  );
}
