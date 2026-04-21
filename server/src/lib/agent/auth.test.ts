import { beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  authenticateAgentRequest,
  extractAgentPasswordFromRequest,
  getAgentApprovalRequired,
  getConfiguredAgentPasswords,
  hasRequiredAgentRole,
  isAgentAuthConfigured,
  resolveAgentRoleFromPassword,
} from "./auth";

function createRequest(options: {
  headers?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
} = {}): Request {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(options.headers || {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );

  return {
    body: options.body || {},
    header(name: string) {
      return normalizedHeaders[name.toLowerCase()];
    },
  } as Request;
}

beforeEach(() => {
  delete process.env.AGENT_ADMIN_PASSWORD;
  delete process.env.AGENT_OPERATOR_PASSWORD;
  delete process.env.AGENT_PASSWORD;
  delete process.env.AGENT_VIEWER_PASSWORD;
  delete process.env.AGENT_REQUIRE_MUTATION_APPROVAL;
});

test("agent auth reads configured passwords and role resolution", () => {
  process.env.AGENT_ADMIN_PASSWORD = " admin ";
  process.env.AGENT_PASSWORD = " operator ";
  process.env.AGENT_VIEWER_PASSWORD = " viewer ";

  assert.deepEqual(getConfiguredAgentPasswords(), [
    { role: "admin", password: "admin" },
    { role: "operator", password: "operator" },
    { role: "viewer", password: "viewer" },
  ]);
  assert.equal(isAgentAuthConfigured(), true);
  assert.equal(resolveAgentRoleFromPassword(" operator "), "operator");
  assert.equal(resolveAgentRoleFromPassword("missing"), null);
});

test("agent auth extracts passwords from headers, bearer tokens, and body", () => {
  assert.deepEqual(
    extractAgentPasswordFromRequest(
      createRequest({ headers: { "x-agent-password": "secret" } }),
    ),
    { password: "secret", source: "header" },
  );
  assert.deepEqual(
    extractAgentPasswordFromRequest(
      createRequest({ headers: { authorization: "Bearer token-123" } }),
    ),
    { password: "token-123", source: "header" },
  );
  assert.deepEqual(
    extractAgentPasswordFromRequest(
      createRequest({ body: { password: "body-secret" } }),
    ),
    { password: "body-secret", source: "body" },
  );
  assert.deepEqual(extractAgentPasswordFromRequest(createRequest()), {
    password: undefined,
    source: null,
  });
});

test("agent auth authenticates requests, compares role priority, and reads approval setting", () => {
  process.env.AGENT_ADMIN_PASSWORD = "admin";
  process.env.AGENT_OPERATOR_PASSWORD = "operator";

  const auth = authenticateAgentRequest(
    createRequest({ headers: { "x-agent-auth": "operator" } }),
  );
  assert.deepEqual(auth, { role: "operator", source: "header" });
  assert.equal(authenticateAgentRequest(createRequest()), null);

  assert.equal(hasRequiredAgentRole("admin", "viewer"), true);
  assert.equal(hasRequiredAgentRole("viewer", "operator"), false);

  assert.equal(getAgentApprovalRequired(), true);
  process.env.AGENT_REQUIRE_MUTATION_APPROVAL = " false ";
  assert.equal(getAgentApprovalRequired(), false);
});
