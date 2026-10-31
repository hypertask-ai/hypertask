const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const { default: definition, HTPR_8231_AGENT_ARCHIVE_DONE_FLAG } = load(
  "src/lib/flags/definitions/htpr-8231-agent-archive-done.ts",
  {},
);

test("agent archive of Done tickets ships as a high-risk owner and QA flag", () => {
  assert.equal(HTPR_8231_AGENT_ARCHIVE_DONE_FLAG, "htpr-8231-agent-archive-done");
  assert.equal(definition.key, HTPR_8231_AGENT_ARCHIVE_DONE_FLAG);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "access");
});

test("the task write controller reads the flag for its owner and passes it to the Done guard", () => {
  const source = fs.readFileSync(
    path.join(root, "src/utils/controllers/tasks/single.ts"),
    "utf8",
  );
  const flagRead = source.indexOf("HTPR_8231_AGENT_ARCHIVE_DONE_FLAG");
  const guardCall = source.indexOf("await assertAgentMayLeaveDone(");
  assert.ok(flagRead > 0, "controller reads the archive flag");
  assert.match(source, /requestedMutation\.status === "Archive"/);
  assert.match(source, /isFeatureEnabled\(\s*\(/);
  assert.ok(guardCall > flagRead, "guard call follows the flag read");
  assert.match(source, /\{\s*mayArchive:\s*mayArchiveDoneTask\s*\}/);
});

test("the agent archive route keeps its Done guard call sites", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/mcp/tasks/agentDoneLifecycle.ts"),
    "utf8",
  );
  assert.match(source, /requestedStatus === 'Deleted'\) return true/);
  assert.match(source, /requestedStatus === 'Archive' && !options\.mayArchive/);
});
