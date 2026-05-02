import { beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import {
  authenticateAgentRequest,
  getAgentApprovalRequired,
  hasRequiredAgentRole,
  isAgentAuthConfigured,
} from "./auth";

beforeEach(() => {
  delete process.env.AGENT_REQUIRE_MUTATION_APPROVAL;
});

test("agent auth is always configured and returns admin role", () => {
  assert.equal(isAgentAuthConfigured(), true);

  const auth = authenticateAgentRequest({} as never);
  assert.deepEqual(auth, { role: "admin", source: "default" });
});

test("agent auth role priority works correctly", () => {
  assert.equal(hasRequiredAgentRole("admin", "viewer"), true);
  assert.equal(hasRequiredAgentRole("admin", "operator"), true);
  assert.equal(hasRequiredAgentRole("admin", "admin"), true);
  assert.equal(hasRequiredAgentRole("operator", "viewer"), true);
  assert.equal(hasRequiredAgentRole("viewer", "operator"), false);
  assert.equal(hasRequiredAgentRole("viewer", "admin"), false);
});

test("agent approval setting reads from env", () => {
  assert.equal(getAgentApprovalRequired(), true);
  process.env.AGENT_REQUIRE_MUTATION_APPROVAL = " false ";
  assert.equal(getAgentApprovalRequired(), false);
});
