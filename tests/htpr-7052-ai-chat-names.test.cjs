const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const naming = load("src/lib/ai/chatSessionNaming.ts", {});
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function fakePrisma({ task = null, project = null } = {}) {
  const updates = [];
  return {
    updates,
    task: { findUnique: async () => task },
    project: { findFirst: async () => project },
    chatSession: { updateMany: async (args) => { updates.push(args); } },
  };
}

test("content name: first sentence of the first message, trimmed", () => {
  assert.equal(naming.nameFromMessage("  How do I set up recurring tasks? Also other things."), "How do I set up recurring tasks");
  assert.equal(naming.nameFromMessage("<p>Plan the launch</p>"), "Plan the launch");
});

test("content name is cut at a word boundary, about 50 characters", () => {
  const name = naming.nameFromMessage("Please summarise every open ticket on the product board for the upcoming release review meeting");
  assert.ok(name.length <= 53, name);
  assert.ok(name.endsWith("..."));
  assert.ok(!/\s\.\.\.$/.test(name));
  assert.ok("Please summarise every open ticket on the product board for the upcoming release review meeting".startsWith(name.slice(0, -3)));
});

test("content wins over ticket and board", async () => {
  const prisma = fakePrisma({ task: { title: "Ticket name" }, project: { title: "Board", name: "board" } });
  const title = await naming.nameNewChatSession(prisma, { sessionId: "s", userId: 1, message: "Fix the login bug", taskId: 5, projectId: 2 });
  assert.equal(title, "Fix the login bug");
  assert.deepEqual(prisma.updates[0].where, { id: "s", userId: 1, title: "New AI Chat" });
  assert.equal(prisma.updates[0].data.title, "Fix the login bug");
});

test("ticket name when there is no content", async () => {
  const prisma = fakePrisma({ task: { title: "Name new AI chats after the ticket" } });
  const title = await naming.nameNewChatSession(prisma, { sessionId: "s", userId: 1, message: "  ", taskId: 5, projectId: 2 });
  assert.equal(title, "Name new AI chats after the ticket");
});

test("Ctrl+J on a ticket: an empty session is named after the ticket", async () => {
  const prisma = fakePrisma({ task: { title: "Ticket name" } });
  assert.equal(await naming.titleForEmptySession(prisma, { taskId: 9 }), "Ticket name");
});

test("board fallback uses the board title, then its name; last resort is the old default", async () => {
  assert.equal(await naming.titleForEmptySession(fakePrisma({ project: { title: "Hypertask Product", name: "p" } }), { projectId: 2 }), "Hypertask Product");
  assert.equal(await naming.titleForEmptySession(fakePrisma({ project: { title: null, name: "plain-board" } }), { projectId: 2 }), "plain-board");
  const none = fakePrisma();
  assert.equal(await naming.titleForEmptySession(none, {}), "New AI Chat");
  assert.equal(await naming.nameNewChatSession(none, { sessionId: "s", userId: 1 }), "New AI Chat");
  assert.equal(none.updates.length, 0, "nothing is written when only the default remains");
});

test("flag off keeps the old behaviour: both routes gate naming on the server flag", () => {
  const stream = read("src/app/api/ai/chat/stream/route.ts");
  const create = read("src/app/api/ai-chat/create-session/route.ts");
  for (const source of [stream, create]) {
    assert.match(source, /isFeatureEnabled\(HTPR_7052_AI_CHAT_NAMES_FLAG, /);
  }
  assert.match(stream, /if \(await isFeatureEnabled\(HTPR_7052_AI_CHAT_NAMES_FLAG[^]*?nameNewChatSession/);
  assert.match(create, /isFeatureEnabled\(HTPR_7052_AI_CHAT_NAMES_FLAG[^]*?&&[^]*?userCanAccessTaskContent[^]*?titleForEmptySession/);
  assert.match(create, /\.\.\.\(title \? \{ title \} : \{\}\)/, "no title key is written when the flag is off");
  assert.match(read("src/prisma/schema.prisma"), /title String @default\("New AI Chat"\)/);
});

test("the flag is a feature flag defaulting to Owner + QA", () => {
  const source = read("src/lib/flags/definitions/htpr-7052-ai-chat-names.ts");
  assert.match(source, /key: HTPR_7052_AI_CHAT_NAMES_FLAG/);
  assert.match(source, /kind: "feature"/);
  assert.match(source, /defaultMode: "OWNER_AND_QA"/);
});
