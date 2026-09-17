const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("the database enforces one room per board and one delivery per target", () => {
  const schema = read("src/prisma/schema.prisma");
  const migration = read(
    "src/prisma/migrations/20260918100000_add_agent_rooms/migration.sql",
  );
  assert.match(schema, /model AgentRoom[\s\S]*projectId\s+Int\s+@unique/);
  assert.match(
    schema,
    /model AgentRoomDelivery[\s\S]*@@unique\(\[messageId, agentId\]\)/,
  );
  assert.match(migration, /AgentRoomMessage_roomId_exchangeId_idx/);
  assert.match(migration, /AgentRoomMessage_botTurnDepth_check/);
  assert.match(migration, /"botTurnDepth" BETWEEN 0 AND 3/);
  assert.match(migration, /AgentRoomMessage_author_check/);
});

test("room runtime APIs expose poll, transcript reply, and handled acknowledgement", () => {
  const pending = read("src/app/api/mcp/chat/rooms/pending/route.ts");
  const messages = read(
    "src/app/api/mcp/chat/rooms/[roomId]/messages/route.ts",
  );
  const handled = read(
    "src/app/api/mcp/chat/rooms/messages/[messageId]/handled/route.ts",
  );
  assert.match(pending, /handledAt: null/);
  assert.doesNotMatch(pending, /handledAt:\s*new Date/);
  assert.match(messages, /createAgentRoomReply/);
  assert.match(handled, /markAgentRoomMessageHandled/);
});

test("the flagged room screen reuses the existing composer and shows safeguards", () => {
  const page = read("src/app/agents/chat/page.tsx");
  const directChat = read("src/app/agents/chat/AgentChatClient.tsx");
  const room = read("src/app/agents/chat/AgentRoomClient.tsx");
  assert.match(page, /agentRoomsEnabled/);
  assert.match(directChat, /Board rooms/);
  assert.match(room, /AI_Tiptap_Container/);
  assert.match(room, /turns today/);
  assert.match(room, /"Stopping…" : "Stop"/);
  assert.match(room, /Product Bot can call in another bot by name/);
});
