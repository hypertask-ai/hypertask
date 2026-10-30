const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("agent task tracking has its own Everyone-default feature flag with a release risk", () => {
  const { default: definition, HTPR_8217_AGENT_FOLLOW_REMINDER_FLAG } = load("src/lib/flags/definitions/htpr-8217-agent-follow-reminder.ts", {});
  assert.equal(HTPR_8217_AGENT_FOLLOW_REMINDER_FLAG, "htpr-8217-agent-follow-reminder");
  assert.equal(definition.key, HTPR_8217_AGENT_FOLLOW_REMINDER_FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.ok(definition.description.startsWith("Agents can follow, star and set a reminder"));
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(definition.releaseRisk.highRisk, undefined);
  assert.equal(require("../e2e/smoke/production-flag-modes.json").modes[definition.key], "EVERYONE");
  assert.deepEqual(require("../e2e/smoke/flag-modes/htpr-8217-agent-follow-reminder.json"), { mode: "EVERYONE" });
});
