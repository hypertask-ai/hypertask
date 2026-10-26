const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers/flag-files.cjs");

test("task conversation continuity defaults to Everyone and remains reversible", () => {
  const module = load("src/lib/flags/definitions/htpr-7736-chat-follows-task.ts");
  assert.equal(module.HTPR_7736_CHAT_FOLLOWS_TASK_FLAG, "htpr-7736-chat-follows-task");
  assert.equal(module.default.key, module.HTPR_7736_CHAT_FOLLOWS_TASK_FLAG);
  assert.equal(module.default.kind, "improvement");
  assert.equal(module.default.defaultMode, "EVERYONE");
  assert.equal(module.default.releaseRisk.risk, "small");
});
