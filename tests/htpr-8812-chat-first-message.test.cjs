const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("first-message setup is an Everyone bugfix with a ticket-specific rollback", () => {
  const { default: definition, HTPR_8812_CHAT_FIRST_MESSAGE_FLAG } = load("src/lib/flags/definitions/htpr-8812-chat-first-message.ts", {});
  assert.equal(HTPR_8812_CHAT_FIRST_MESSAGE_FLAG, "htpr-8812-chat-first-message");
  assert.equal(definition.key, HTPR_8812_CHAT_FIRST_MESSAGE_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
