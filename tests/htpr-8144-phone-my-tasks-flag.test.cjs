const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jiti = require("jiti")(__filename);
const { default: flag, HTPR_8144_PHONE_MY_TASKS_FLAG } = jiti(path.join(__dirname, "../src/lib/flags/definitions/htpr-8144-phone-my-tasks.ts"));

test("phone My Tasks repair ships for everyone with a reversible bugfix flag", () => {
  assert.equal(HTPR_8144_PHONE_MY_TASKS_FLAG, "htpr-8144-phone-my-tasks");
  assert.equal(flag.key, HTPR_8144_PHONE_MY_TASKS_FLAG);
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.releaseRisk.risk, "small");
});
