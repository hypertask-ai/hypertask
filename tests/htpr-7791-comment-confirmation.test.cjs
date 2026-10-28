const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function harness({ unavailable = false } = {}) {
  const sets = new Map();
  const tokens = new Map();
  const writes = [];
  const redis = {
    multi() {
      const queued = [];
      const transaction = {
        sadd(key, ...members) {
          queued.push(() => {
            const set = sets.get(key) ?? new Set();
            members.forEach((member) => set.add(member));
            sets.set(key, set);
          });
          return transaction;
        },
        expire(_key, seconds) {
          assert.equal(seconds, 900);
          return transaction;
        },
        async exec() {
          queued.forEach((apply) => apply());
          return [[null, 1], [null, 1]];
        },
      };
      return transaction;
    },
    async srem(key, ...members) {
      return members.filter((member) => sets.get(key)?.delete(member)).length;
    },
    async del(key) { return sets.delete(key) ? 1 : 0; },
    async set(key, value) { tokens.set(key, value); },
    async getdel(key) {
      const value = tokens.get(key) ?? null;
      tokens.delete(key);
      return value;
    },
  };
  const { requireCrossMessageConfirmation } = load("src/lib/ai/bulkConfirmation.ts", {
    "@/lib/redis": { getRedis: async () => {
      if (unavailable) throw new Error("Redis unavailable");
      return redis;
    } },
  });
  const { createAddCommentTool } = load("src/lib/ai/tools/addComment.ts", {
    ai: { tool: (definition) => definition },
    "@/lib/ai/bulkConfirmation": { requireCrossMessageConfirmation },
    "@/lib/prisma": { default: {
      task: { findUnique: async ({ where }) => ({ id: where.id, title: "Task", projectId: 15, uniqueIndex: where.id, userId: 985 }) },
      user: { findUnique: async ({ where }) => ({ id: where.id }) },
      comment: { findUnique: async () => null },
    } },
    "@/lib/ai/tools/execution": {
      withToolErrors: (fn) => fn,
      resolveTaskForTool: async (_user, identifier) => ({ task: { id: identifier.task_id ?? Number(identifier.ticket_number.split("-")[1]) } }),
    },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value) => value, commentInclude: () => ({}) },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (text) => text },
    "@/utils/controllers/comments/processMentions": {
      convertPlainTextMentionsToHtml: (text) => text,
      resolveTextMentions: async (text) => text,
    },
    "@/utils/helperFunctions/toStoredHtml": { toStoredHtml: (text) => text },
    "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async (text) => text },
    "@/utils/controllers/comments/createCommentService": { createCommentService: async ({ taskId, text, creatorId }) => {
      writes.push({ taskId, text, creatorId });
      return { id: writes.length };
    } },
    "@/utils/controllers/urls/extractUrlsFromContent": { buildMcpImageUrls: () => [], persistUrlsForComment: async () => {} },
    "@/lib/realtime/server": { broadcastTaskComment() {} },
    "@/lib/flags": {},
    "@/lib/flags/keys": {},
    "@/lib/ai/chatStream/prompt": { COMMENT_TASK_LINK_RULE: "" },
    "@/lib/ai/chatStream/errors": { errorMessage: (error) => error.message },
  });
  function turn({ userId = 985, sessionId = "chat-7791" } = {}) {
    const tool = createAddCommentTool({
      user: { id: userId }, confirmationSessionId: sessionId,
      bulkPreviewsIssued: new Set(), sendStatus() {}, body: {}, inlineAgentImagesEnabled: true,
    }).hypertask_add_comment;
    return (input) => tool.execute(tool.inputSchema.parse(input));
  }
  return { turn, writes };
}

const ids = Array.from({ length: 15 }, (_, index) => 1000 + index);
const comment = { text: "Flag review complete" };

async function preview(h, input = { task_ids: ids, ...comment }) {
  const result = await h.turn()({ ...input, confirmed: false });
  assert.equal(result.confirmation_required, true);
  assert.deepEqual(h.writes, []);
}

test("now works: one later confirmation posts all 15 previewed comments after re-batching", async () => {
  const h = harness();
  await preview(h);
  const yes = h.turn();
  for (const task_ids of [ids.slice(10), ids.slice(3, 10), ids.slice(0, 3)]) {
    const result = await yes({ task_ids, ...comment, confirmed: true });
    assert.equal(result.success, true);
  }
  assert.deepEqual(h.writes.map(({ taskId }) => taskId).sort(), ids);
  assert.deepEqual(h.writes.map(({ text }) => text), Array(15).fill("Flag review complete"));
});

test("still refused: no preview or later confirmation means no comments", async () => {
  for (const confirmed of [undefined, false, true]) {
    const h = harness();
    const result = await h.turn()({ task_ids: ids, ...comment, confirmed });
    assert.equal(result.confirmation_required, true);
    assert.deepEqual(h.writes, []);
  }
});

test("still allowed: an ordinary single comment needs no bulk confirmation", async () => {
  const h = harness();
  const result = await h.turn()({ task_id: 1000, ...comment });
  assert.equal(result.success, true);
  assert.deepEqual(h.writes, [{ taskId: 1000, text: "Flag review complete", creatorId: 985 }]);
});

test("now refused: explicit small-batch previews do not write, and one yes posts all 15", async () => {
  const h = harness();
  const proposed = h.turn();
  for (const task_id of ids) {
    const result = await proposed({ task_id, ...comment, confirmed: false });
    assert.equal(result.confirmation_required, true);
  }
  assert.deepEqual(h.writes, []);
  const result = await h.turn()({ task_ids: ids, ...comment, confirmed: true });
  assert.equal(result.success, true);
  assert.equal(h.writes.length, 15);
});

test("now works: one later yes posts 15 individually previewed, different comments", async () => {
  const h = harness();
  const proposed = h.turn();
  for (const task_id of ids) {
    const result = await proposed({ task_id, text: `Flag review for ${task_id}`, confirmed: false });
    assert.equal(result.confirmation_required, true);
  }
  assert.deepEqual(h.writes, []);
  const yes = h.turn();
  for (const task_id of ids) {
    const result = await yes({ task_id, text: `Flag review for ${task_id}`, confirmed: true });
    assert.equal(result.success, true);
  }
  assert.deepEqual(h.writes, ids.map((taskId) => ({ taskId, text: `Flag review for ${taskId}`, creatorId: 985 })));
});

test("still allowed: identifiers and ordering can change without changing the previewed tasks", async () => {
  const h = harness();
  await preview(h);
  const result = await h.turn()({ ticket_numbers: [...ids].reverse().map((id) => `HTPR-${id}`), ...comment, confirmed: true });
  assert.equal(result.success, true);
  assert.equal(h.writes.length, 15);
});

for (const changes of [
  { task_ids: [...ids.slice(0, 14), 9999] },
  { task_ids: [9999] },
  { text: "A different comment" },
  { images: ["https://example.com/changed.png"] },
  { image_urls: ["https://example.com/changed.png"] },
  { inline_images: false },
  { mentions: [{ user_id: 123, display_name: "Other person" }] },
]) {
  test(`still refused: confirmation cannot widen or change ${Object.keys(changes)[0]} ${JSON.stringify(changes)}`, async () => {
    const h = harness();
    await preview(h);
    const result = await h.turn()({ task_ids: ids, ...comment, ...changes, confirmed: true });
    assert.equal(result.confirmation_required, true);
    assert.deepEqual(h.writes, []);
  });
}

test("still refused: the same message cannot approve its own preview", async () => {
  const h = harness();
  const turn = h.turn();
  assert.equal((await turn({ task_ids: ids, ...comment, confirmed: false })).confirmation_required, true);
  assert.equal((await turn({ task_ids: ids, ...comment, confirmed: true })).confirmation_required, true);
  assert.deepEqual(h.writes, []);
});

for (const identity of [{ userId: 123 }, { sessionId: "other-chat" }]) {
  test(`still refused: a preview is isolated by ${Object.keys(identity)[0]}`, async () => {
    const h = harness();
    await preview(h);
    const result = await h.turn(identity)({ task_ids: ids, ...comment, confirmed: true });
    assert.equal(result.confirmation_required, true);
    assert.deepEqual(h.writes, []);
  });
}

test("still refused: each previewed comment can only be posted once", async () => {
  const h = harness();
  await preview(h);
  assert.equal((await h.turn()({ task_ids: ids, ...comment, confirmed: true })).success, true);
  assert.equal((await h.turn()({ task_ids: ids, ...comment, confirmed: true })).confirmation_required, true);
  assert.equal(h.writes.length, 15);
});

test("still refused: unavailable confirmation storage fails closed", async () => {
  const h = harness({ unavailable: true });
  const result = await h.turn()({ task_ids: ids, ...comment, confirmed: true });
  assert.equal(result.confirmation_required, true);
  assert.deepEqual(h.writes, []);
});
