const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const flag = "htpr-9021-no-empty-chats";

test("no-empty-chats is an Everyone bugfix with a ticket-specific rollback", () => {
  const { default: definition, HTPR_9021_NO_EMPTY_CHATS_FLAG } = load("src/lib/flags/definitions/htpr-9021-no-empty-chats.ts", {});
  assert.equal(HTPR_9021_NO_EMPTY_CHATS_FLAG, flag);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});

function expiryFixture({ enabled, remaining }) {
  const calls = [];
  const { recreateSessionIfEmpty } = load("src/utils/controllers/ai-chat/invokeChatSessionExpiry.ts", {
    "@/lib/prisma": { default: { chatSession: {
      count: async (args) => { calls.push(["count", args]); return remaining; },
      create: async (args) => { calls.push(["create", args]); return { id: "new" }; },
    } } },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { calls.push(["flag", key, userId]); return enabled; } },
  });
  return { calls, recreateSessionIfEmpty };
}

test("expiry sweep with the flag on seeds no replacement chat", async () => {
  const { calls, recreateSessionIfEmpty } = expiryFixture({ enabled: true, remaining: 0 });
  await recreateSessionIfEmpty(6);
  assert.deepEqual(calls, [["flag", flag, 6]]);
});

test("expiry sweep with the flag off still seeds a chat for a user with none", async () => {
  const { calls, recreateSessionIfEmpty } = expiryFixture({ enabled: false, remaining: 0 });
  await recreateSessionIfEmpty(6);
  assert.deepEqual(calls.map((call) => call[0]), ["flag", "count", "create"]);
  assert.deepEqual(calls[2][1], { data: { userId: 6 } });
});

test("expiry sweep with the flag off leaves users who still have chats alone", async () => {
  const { calls, recreateSessionIfEmpty } = expiryFixture({ enabled: false, remaining: 2 });
  await recreateSessionIfEmpty(6);
  assert.deepEqual(calls.map((call) => call[0]), ["flag", "count"]);
});

test("expiry sweep falls back to the old behaviour when the flag lookup fails", async () => {
  const calls = [];
  const { recreateSessionIfEmpty } = load("src/utils/controllers/ai-chat/invokeChatSessionExpiry.ts", {
    "@/lib/prisma": { default: { chatSession: {
      count: async () => 0,
      create: async (args) => { calls.push(args); return { id: "new" }; },
    } } },
    "@/lib/flags": { isFeatureEnabled: async () => { throw new Error("flags unavailable"); } },
  });
  await recreateSessionIfEmpty(6);
  assert.equal(calls.length, 1);
});

test("cleanup script only matches old, unowned, message-free chats", async () => {
  const { EMPTY_CHAT_FILTER, COUNT_SQL, DELETE_BATCH_SQL, BATCH_SIZE } = await import("../scripts/htpr-9021-delete-empty-chats.mjs");
  assert.match(EMPTY_CHAT_FILTER, /s\."agentId" IS NULL/);
  assert.match(EMPTY_CHAT_FILTER, /s\."createdAt" < now\(\) - interval '1 hour'/);
  assert.match(EMPTY_CHAT_FILTER, /NOT EXISTS \(SELECT 1 FROM "ChatMessage" m WHERE m\."sessionId" = s\.id\)/);
  assert.match(EMPTY_CHAT_FILTER, /NOT EXISTS \(SELECT 1 FROM "AgentRun" r WHERE r\."chatSessionId" = s\.id\)/);
  assert.match(EMPTY_CHAT_FILTER, /NOT EXISTS \(SELECT 1 FROM "ChatSessionParticipant" p WHERE p\."sessionId" = s\.id\)/);
  assert.ok(COUNT_SQL.includes(EMPTY_CHAT_FILTER));
  assert.ok(DELETE_BATCH_SQL.includes(EMPTY_CHAT_FILTER));
  assert.ok(BATCH_SIZE > 0);
});

function fakeDb(total) {
  const queries = [];
  let left = total;
  return {
    queries,
    query: async (sql, params) => {
      queries.push([sql, params]);
      if (sql.startsWith("SELECT count")) return { rows: [{ count: left }] };
      const removed = Math.min(left, params[0]);
      left -= removed;
      return { rowCount: removed };
    },
  };
}

test("cleanup script dry run counts and deletes nothing", async () => {
  const { run, COUNT_SQL } = await import("../scripts/htpr-9021-delete-empty-chats.mjs");
  const db = fakeDb(1200);
  const logs = [];
  const result = await run(db, false, (line) => logs.push(line));
  assert.deepEqual(result, { total: 1200, deleted: 0 });
  assert.deepEqual(db.queries.map((query) => query[0]), [COUNT_SQL]);
  assert.match(logs.join("\n"), /1200 empty chat sessions match/);
  assert.match(logs.join("\n"), /dry run/);
});

test("cleanup script apply deletes in batches until none match", async () => {
  const { run, DELETE_BATCH_SQL, BATCH_SIZE } = await import("../scripts/htpr-9021-delete-empty-chats.mjs");
  const db = fakeDb(BATCH_SIZE * 2 + 7);
  const result = await run(db, true, () => {});
  assert.deepEqual(result, { total: BATCH_SIZE * 2 + 7, deleted: BATCH_SIZE * 2 + 7, remaining: 0 });
  const deletes = db.queries.filter((query) => query[0] === DELETE_BATCH_SQL);
  assert.equal(deletes.length, 4);
  assert.ok(deletes.every((query) => query[1][0] === BATCH_SIZE));
});

test("sidebar shows the general chat instead of creating one when the flag is on", () => {
  const source = read("src/components/AI_CHAT/AI_Chat_Sidebar.tsx");
  assert.match(source, /if \(noEmptyChats\) await chat\.showGeneralChat\(\);\s*else await chat\.startNewSession\(\);/);
  assert.match(source, /noEmptyChats \? chat\.showGeneralChat\(\) : chat\.startNewSession\(\)/);
  assert.match(source, /onNewChat[\s\S]{0,200}chat\.startNewSession\(\)/);
});

test("mount and board changes look for a chat without creating one when the flag is on", () => {
  const source = read("src/hooks/MultiPages/AIChat/useAiChatSessions.ts");
  assert.match(source, /ensureSessionForCurrentBoard = useCallback\(async \(timeoutMs = 5000, allowCreate = true\)/);
  assert.match(source, /const allowCreate = !noEmptyChats;/);
  assert.equal((source.match(/!allowCreate/g) ?? []).length, 4);
  assert.match(read("src/hooks/MultiPages/AIChat/useAiChatAttachments.ts"), /ensureSessionForCurrentBoard\(timeoutMs\)/);
});

test("history hides chats that have no messages when the flag is on", () => {
  const source = read("src/hooks/MultiPages/AIChat/usePagedChatHistory.ts");
  assert.match(source, /noEmptyChats \? allHistorySessions\.filter\(\(session\) => session\.hasMessages !== false\) : allHistorySessions/);
  assert.match(source, /if \(noEmptyChats \|\| identityRef\.current !== identity/);
});
