const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

test("purge removes old empty AI chats and never creates a replacement", async () => {
  const queries = [];
  const prisma = {
    chatSession: {
      findMany: async (query) => {
        queries.push(query);
        return [{ id: "empty-old" }];
      },
      deleteMany: async (query) => {
        queries.push(query);
        assert.equal(query.where.agentId, null);
        assert.deepEqual(query.where.messages, { none: {} });
        assert.deepEqual(query.where.id, { in: ["empty-old"] });
        return { count: 1 };
      },
      create: async () => {
        throw new Error("empty chat purge must not create a session");
      },
    },
  };
  const api = load("src/utils/controllers/ai-chat/invokeChatSessionExpiry.ts", {
    "@/lib/prisma": { default: prisma },
  });
  const now = new Date("2026-11-10T12:00:00.000Z");
  assert.equal(await api.purgeEmptyAiChats(now), 1);
  assert.equal(queries[0].take, 100);
  assert.equal(queries[0].where.agentId, null);
  assert.deepEqual(queries[0].where.messages, { none: {} });
  assert.equal(queries[0].where.updatedAt.lt.toISOString(), "2026-11-10T11:45:00.000Z");
  await api.recreateSessionIfEmpty(985);
  assert.equal(queries.length, 2);

  queries.length = 0;
  prisma.chatSession.findMany = async (query) => {
    queries.push(query);
    return [];
  };
  assert.equal(await api.purgeEmptyAiChats(now), 0);
  assert.equal(queries.length, 1);
});
