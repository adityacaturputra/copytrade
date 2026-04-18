import type { Request } from "express";

export type AgentRole = "viewer" | "operator" | "admin";

export interface AgentAuthResult {
  role: AgentRole;
  source: "header" | "body";
}

const ROLE_PRIORITY: Record<AgentRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

function normalizePassword(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getConfiguredAgentPasswords(): Array<{
  role: AgentRole;
  password: string;
}> {
  const adminPassword = normalizePassword(process.env.AGENT_ADMIN_PASSWORD);
  const operatorPassword =
    normalizePassword(process.env.AGENT_OPERATOR_PASSWORD) ||
    normalizePassword(process.env.AGENT_PASSWORD);
  const viewerPassword = normalizePassword(process.env.AGENT_VIEWER_PASSWORD);

  return [
    adminPassword ? { role: "admin", password: adminPassword } : null,
    operatorPassword ? { role: "operator", password: operatorPassword } : null,
    viewerPassword ? { role: "viewer", password: viewerPassword } : null,
  ].filter((entry): entry is { role: AgentRole; password: string } =>
    Boolean(entry),
  );
}

export function isAgentAuthConfigured(): boolean {
  return getConfiguredAgentPasswords().length > 0;
}

export function resolveAgentRoleFromPassword(
  password: string | undefined,
): AgentRole | null {
  const normalized = normalizePassword(password);
  if (!normalized) return null;

  const match = getConfiguredAgentPasswords().find(
    (entry) => entry.password === normalized,
  );
  return match?.role || null;
}

export function hasRequiredAgentRole(
  actualRole: AgentRole,
  minimumRole: AgentRole,
): boolean {
  return ROLE_PRIORITY[actualRole] >= ROLE_PRIORITY[minimumRole];
}

export function extractAgentPasswordFromRequest(req: Request): {
  password: string | undefined;
  source: "header" | "body" | null;
} {
  const headerPassword =
    req.header("x-agent-password") ||
    req.header("x-agent-auth") ||
    undefined;
  if (headerPassword) {
    return { password: headerPassword, source: "header" };
  }

  const authHeader = req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return {
      password: authHeader.slice("Bearer ".length).trim(),
      source: "header",
    };
  }

  const bodyPassword =
    typeof req.body?.password === "string" ? req.body.password : undefined;
  if (bodyPassword) {
    return { password: bodyPassword, source: "body" };
  }

  return { password: undefined, source: null };
}

export function authenticateAgentRequest(req: Request): AgentAuthResult | null {
  const { password, source } = extractAgentPasswordFromRequest(req);
  const role = resolveAgentRoleFromPassword(password);
  if (!role || !source) return null;
  return { role, source };
}

export function getAgentApprovalRequired(): boolean {
  return (process.env.AGENT_REQUIRE_MUTATION_APPROVAL || "true")
    .trim()
    .toLowerCase() !== "false";
}
