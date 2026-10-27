const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/htpr-7785-jiti-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { resolveQueuedMessageCreatedAt } = jiti(path.join(root, "src/lib/aiChat/queuedMessageOrder.ts"));

const replyCreatedAt = new Date("2026-10-26T10:00:00.500Z");
const lookupReturning = (row) => async () => row;

test("a queued human message sorts just before the reply it waited for", async () => {
  const createdAt = await resolveQueuedMessageCreatedAt("human", "assistant-1", lookupReturning({ createdAt: replyCreatedAt }));
  assert.equal(createdAt.getTime(), replyCreatedAt.getTime() - 1);
});

test("a queued message whose reply is not stored yet keeps the normal insert time", async () => {
  assert.equal(await resolveQueuedMessageCreatedAt("human", "assistant-1", lookupReturning(null)), undefined);
});

test("a normal send without a preceding reply keeps the normal insert time", async () => {
  let looked = false;
  const createdAt = await resolveQueuedMessageCreatedAt("human", undefined, async () => { looked = true; return null; });
  assert.equal(createdAt, undefined);
  assert.equal(looked, false);
});

test("assistant messages are never back-dated", async () => {
  assert.equal(await resolveQueuedMessageCreatedAt("assistant", "assistant-1", lookupReturning({ createdAt: replyCreatedAt })), undefined);
});
