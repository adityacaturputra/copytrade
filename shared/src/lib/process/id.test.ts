import { beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";

const processLogMocks = vi.hoisted(() => ({
  createTradeProcessId: vi.fn(() => "generated-process-id"),
}));

vi.mock("./log", () => ({
  createTradeProcessId: processLogMocks.createTradeProcessId,
}));

import { ensurePersistedProcessId, getResolvedProcessId } from "./id";

beforeEach(() => {
  processLogMocks.createTradeProcessId.mockClear();
  processLogMocks.createTradeProcessId.mockReturnValue("generated-process-id");
});

test("getResolvedProcessId trims existing ids or generates a fallback", () => {
  assert.equal(getResolvedProcessId("  abc-123  ", "trade"), "abc-123");
  assert.equal(getResolvedProcessId(undefined, "trade"), "generated-process-id");
  assert.deepEqual(processLogMocks.createTradeProcessId.mock.calls, [["trade"]]);
});

test("ensurePersistedProcessId avoids unnecessary saves and persists new ids", async () => {
  const existingSave = vi.fn();
  const generatedSave = vi.fn();
  const existingDoc = {
    processId: "keep-me",
    save: existingSave,
  };
  const generatedDoc = {
    processId: " ",
    save: generatedSave,
  };

  assert.equal(
    await ensurePersistedProcessId(existingDoc, "draft"),
    "keep-me",
  );
  assert.equal(existingSave.mock.calls.length, 0);

  assert.equal(
    await ensurePersistedProcessId(generatedDoc, "draft"),
    "generated-process-id",
  );
  assert.equal(generatedDoc.processId, "generated-process-id");
  assert.equal(generatedSave.mock.calls.length, 1);
});
