const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("agent archive and delete have their own Owner + QA data-deletion feature flag with a release risk", () => {
  const { default: definition, HTPR_8215_AGENT_ARCHIVE_DELETE_FLAG } = load("src/lib/flags/definitions/htpr-8215-agent-archive-delete.ts", {});
  assert.equal(HTPR_8215_AGENT_ARCHIVE_DELETE_FLAG, "htpr-8215-agent-archive-delete");
  assert.equal(definition.key, HTPR_8215_AGENT_ARCHIVE_DELETE_FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.shippedOn, "2026-10-30");
  assert.equal(definition.description, "Agents can archive a ticket or move it to Trash through MCP and the CLI.");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(definition.releaseRisk.highRisk, "data-deletion");
  assert.equal(require("../e2e/smoke/production-flag-modes.json").modes[definition.key], "OWNER_AND_QA");
});
