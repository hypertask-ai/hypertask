const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("the add-message route looks the reply up inside the caller's own session", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/ai-chat/add-message/route.ts"), "utf8");
  assert.match(route, /resolveQueuedMessageCreatedAt\(/);
  assert.match(route, /where: \{ id, sessionId, role: "assistant" \}/);
});

test("a queued send carries its reply id and never creates a session", () => {
  const send = fs.readFileSync(path.join(root, "src/hooks/MultiPages/AIChat/aiChatSend.ts"), "utf8");
  assert.match(send, /queuedMessage \? \{ precedesMessageId: assistantMessageId \}/);
  assert.doesNotMatch(send, /parentSessionId/);
  assert.doesNotMatch(send, /createSessionNext[\s\S]{0,200}queuedMessage/);
});
