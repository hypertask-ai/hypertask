const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers/flag-files.cjs");

test("task conversation continuity defaults to Everyone and remains reversible", () => {
  const flagModule = load("src/lib/flags/definitions/htpr-7736-chat-follows-task.ts");
  assert.equal(flagModule.HTPR_7736_CHAT_FOLLOWS_TASK_FLAG, "htpr-7736-chat-follows-task");
  assert.equal(flagModule.default.key, flagModule.HTPR_7736_CHAT_FOLLOWS_TASK_FLAG);
  assert.equal(flagModule.default.kind, "improvement");
  assert.equal(flagModule.default.defaultMode, "EVERYONE");
  assert.equal(flagModule.default.releaseRisk.risk, "small");
});
