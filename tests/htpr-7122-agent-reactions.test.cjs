const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loads = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadTs(relativePath, { stubs = false } = {}) {
  delete require.cache[path.join(root, relativePath)];
  const jiti = createJiti(path.join(root, `tests/htpr-7122-loader-${++loads}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
    ...(stubs ? {} : { fsCache: false, moduleCache: false }),
  });
  return jiti(path.join(root, relativePath));
}

function fakeTx(rows) {
  let nextId = rows.length + 1;
  const matches = (row, where) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && Array.isArray(value.in)) return value.in.includes(row[key]);
      return (row[key] ?? null) === value;
    });
  const pick = (row, select) =>
    select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key] ?? null])) : { ...row };
  return {
    rows,
    reaction: {
      findMany: async ({ where, select }) => rows.filter((row) => matches(row, where)).map((row) => pick(row, select)),
      update: async ({ where, data, select }) => {
        const row = rows.find((item) => item.id === where.id);
        Object.assign(row, data);
        return pick(row, select);
      },
      create: async ({ data, select }) => {
        const row = { id: `r${nextId++}`, createdAt, isDeleted: false, agentId: null, agentDisplayName: null, ...data };
        rows.push(row);
        return pick(row, select);
      },
      updateMany: async ({ where, data }) => {
        const hit = rows.filter((row) => matches(row, where));
        hit.forEach((row) => Object.assign(row, data));
        return { count: hit.length };
      },
    },
  };
}

const createdAt = new Date("2026-10-11T06:00:00.000Z");
const RUNNER = { id: "agent-runner-5", displayName: "Runner 5" };
const ownerThumb = () => ({
  id: "owner-1",
  createdAt,
  commentId: 7,
  taskId: 42,
  userId: 6,
  emoji: "\u{1F44D}",
  unified: "1f44d",
  isDeleted: false,
  agentId: null,
  agentDisplayName: null,
});

test("an agent's reaction is saved as the agent, next to its owner's own", async () => {
  const { writeCommentReaction } = loadTs("src/lib/mcp/comments/reactionStore.ts");
  const tx = fakeTx([ownerThumb()]);
  const result = await writeCommentReaction(tx, {
    commentId: 7, taskId: 42, userId: 6, agent: RUNNER, emoji: "\u{1F44D}", active: true,
  });
  assert.equal(result.wasActive, false, "the owner's thumbs up is not the agent's");
  assert.equal(result.reaction.agentId, RUNNER.id);
  assert.equal(result.reaction.agentDisplayName, "Runner 5");
  assert.equal(tx.rows.filter((row) => !row.isDeleted).length, 2);
});

test("an agent removing its reaction keeps the owner's reaction", async () => {
  const { writeCommentReaction } = loadTs("src/lib/mcp/comments/reactionStore.ts");
  const tx = fakeTx([ownerThumb()]);
  const input = { commentId: 7, taskId: 42, userId: 6, agent: RUNNER, emoji: "\u{1F44D}" };
  await writeCommentReaction(tx, { ...input, active: true });
  const removed = await writeCommentReaction(tx, { ...input, active: false });
  assert.equal(removed.wasActive, true);
  assert.deepEqual(
    removed.reactions.map((reaction) => [reaction.id, reaction.agentId]),
    [["owner-1", null]],
  );
  assert.equal(tx.rows.find((row) => row.id === "owner-1").isDeleted, false);
});

test("a person's API reaction never revives or removes their agent's row", async () => {
  const { writeCommentReaction } = loadTs("src/lib/mcp/comments/reactionStore.ts");
  const tx = fakeTx([{ ...ownerThumb(), id: "agent-row", agentId: RUNNER.id, agentDisplayName: "Runner 5" }]);
  const input = { commentId: 7, taskId: 42, userId: 6, agent: null, emoji: "\u{1F44D}" };
  const added = await writeCommentReaction(tx, { ...input, active: true });
  assert.equal(added.wasActive, false);
  assert.equal(added.reaction.agentId, null);
  await writeCommentReaction(tx, { ...input, active: false });
  assert.equal(tx.rows.find((row) => row.id === "agent-row").isDeleted, false);
});

test("the web emoji click only ever finds and deletes the person's own rows", async () => {
  const matchesWhere = (row, where) => Object.entries(where).every(([key, value]) => (row[key] ?? null) === value);
  const rows = [];
  const agentRow = { id: "agent-1", commentId: 7, taskId: 42, userId: 6, unified: "1f44d", agentId: RUNNER.id };
  const seed = (...seeded) => {
    rows.splice(0, rows.length, ...seeded);
  };
  stubModule("src/lib/auth/agentScope.ts", { withAgentScopeRequest: (_req, run) => run() });
  stubModule("src/lib/prisma.ts", {
    default: {
      comment: { findFirst: async () => ({ id: 7 }) },
      reaction: {
        findMany: async ({ where }) => rows.filter((row) => matchesWhere(row, where)),
        deleteMany: async ({ where }) => {
          const hit = rows.filter((row) => matchesWhere(row, where));
          hit.forEach((row) => rows.splice(rows.indexOf(row), 1));
          return { count: hit.length };
        },
      },
    },
  });
  stubModule("src/models/model.ts", {});
  stubModule("src/utils/controllers/FCM/index.ts", { sendDataNewCommentFCM: async () => {} });
  stubModule("src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts", {});
  stubModule("src/lib/realtime/server.ts", { broadcastTaskComment: async () => {} });
  stubModule("src/utils/controllers/comments/readReceipts.ts", { omitCommentSeen: (comment) => comment });
  stubModule("src/lib/agentWebhooks/commentReaction.ts", {
    prepareCommentReactionWebhook: async () => null,
    persistCommentReactionWebhook: async () => [],
  });
  stubModule("src/lib/agentWebhooks/outbox.ts", { publishAgentWebhookDeliveries: async () => {} });
  stubModule("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => ({ userId: 6 }) });
  stubModule("src/utils/controllers/tasks/assertTaskAccess.ts", { userCanAccessTaskContent: async () => true });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", { taskWriteAccessWhere: () => ({}) });
  const { default: handler } = loadTs("src/pages/api/comments/addReaction.ts", { stubs: true });
  const base = { taskId: 42, commentId: 7, emoji: "\u{1F44D}", unified: "1f44d", userId: 6 };
  const click = async (body) => {
    const res = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    await handler({ method: "POST", headers: {}, body: { ...base, ...body } }, res);
    return res;
  };
  const personRow = { id: "person-1", commentId: 7, taskId: 42, userId: 6, unified: "1f44d", agentId: null };

  seed(personRow, agentRow);
  assert.equal((await click({ alreadyReacted: true })).statusCode, 200);
  assert.deepEqual(rows.map((row) => row.id), ["agent-1"]);

  seed(personRow, agentRow);
  assert.equal((await click({})).statusCode, 202);
  assert.deepEqual(rows.map((row) => row.id), ["agent-1"]);

  seed(agentRow);
  assert.equal((await click({ alreadyReacted: true })).statusCode, 200);
  assert.deepEqual(rows.map((row) => row.id), ["agent-1"]);
});

test("a reaction write response hides agents, and survives a rejected agent lookup", async () => {
  const { mapReactionWriteResult } = loadTs("src/lib/mcp/comments/reactionResponse.ts");
  const agentRow = { createdAt, id: "r1", emoji: "👍", userId: 6, agentId: RUNNER.id, agentDisplayName: "Runner 5" };
  const human = { createdAt, id: "r2", emoji: "👍", userId: 7, agentId: null, agentDisplayName: null };
  const result = { changed: true, reaction: agentRow, reactions: [agentRow, human] };

  const seen = [];
  const visible = await mapReactionWriteResult(result, async (ids) => {
    seen.push(ids);
    return new Map([[RUNNER.id, "Runner 5"]]);
  });
  assert.deepEqual(seen, [[RUNNER.id]]);
  assert.equal(visible.changed, true);
  assert.deepEqual(visible.reaction.agent, { id: RUNNER.id, displayName: "Runner 5" });

  const hidden = await mapReactionWriteResult(result, async () => new Map());
  assert.deepEqual(hidden.reaction.agent, { displayName: "Private agent" });
  assert.equal(JSON.stringify(hidden).includes(RUNNER.id), false);
  assert.equal(JSON.stringify(hidden).includes("Runner 5"), false);

  const originalError = console.error;
  console.error = () => {};
  try {
    const failed = await mapReactionWriteResult(result, async () => { throw new Error("db down"); });
    assert.equal(failed.changed, true);
    assert.deepEqual(failed.reactions.map((row) => row.agent ?? null), [{ displayName: "Private agent" }, null]);
    assert.equal(JSON.stringify(failed).includes("Runner 5"), false);
  } finally {
    console.error = originalError;
  }
});

test("MCP reads mark an agent reaction and never attach the owner's user", () => {
  const { mapMcpCommentReaction, reactionAgentIds, commentReactionInclude } = loadTs(
    "src/lib/mcp/comments/reactionResponse.ts",
  );
  assert.equal(commentReactionInclude.select.agentId, true);
  const agentRow = {
    id: "r2", emoji: "\u{1F44D}", userId: 6, agentId: RUNNER.id, agentDisplayName: "Runner 5",
    createdAt,
    user: { id: 6, displayName: "Valentin Yeo" },
  };
  assert.deepEqual(mapMcpCommentReaction(agentRow, new Map([[RUNNER.id, "Runner 5"]])), {
    createdAt: createdAt.toISOString(), id: "r2", emoji: "\u{1F44D}", userId: 6, isAgent: true, agent: { id: RUNNER.id, displayName: "Runner 5" },
  });
  assert.deepEqual(mapMcpCommentReaction(agentRow), {
    createdAt: createdAt.toISOString(), id: "r2", emoji: "\u{1F44D}", userId: 6, isAgent: true, agent: { displayName: "Private agent" },
  });
  const human = { createdAt, id: "r1", emoji: "\u{1F44D}", userId: 6, agentId: null, user: { id: 6, displayName: "Valentin Yeo" } };
  assert.deepEqual(mapMcpCommentReaction(human), {
    createdAt: createdAt.toISOString(), id: "r1", emoji: "\u{1F44D}", userId: 6, user: { id: 6, displayName: "Valentin Yeo" },
  });
  assert.deepEqual(reactionAgentIds([{ reactions: [agentRow, human, agentRow] }, {}]), [RUNNER.id]);
});

test("the tooltip names the agent, even for the agent's owner", () => {
  const { reactorsLabel } = loadTs(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/reactorsLabel.ts",
  );
  const runner = { id: null, displayName: "Runner 5 (agent)" };
  const valentin = { id: 6, displayName: "Valentin Yeo" };
  assert.equal(reactorsLabel([runner], 6), "Runner 5 (agent)");
  assert.equal(reactorsLabel([valentin, runner], 6), "Runner 5 (agent) and you");
  assert.equal(reactorsLabel([valentin], 6), "You (click to remove)");
  assert.equal(reactorsLabel([valentin, runner], 9), "Valentin Yeo and Runner 5 (agent)");
});

test("a reaction webhook event carries the reacting agent as its actor", async () => {
  const actorInputs = [];
  stubModule("src/lib/prisma.ts", { default: {} });
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => true });
  stubModule("src/lib/agentWebhooks/outbox.ts", {
    resolveAgentWebhookActor: async (_tx, input) => {
      actorInputs.push(input);
      return { userId: input.userId, agentId: input.agentId, displayName: "Runner 5" };
    },
    persistAgentWebhookEvents: async (_tx, input) => {
      assert.equal(input.actor.agentId, RUNNER.id);
      return ["d1"];
    },
    publishAgentWebhookDeliveries: async () => {},
  });
  const mod = loadTs("src/lib/agentWebhooks/commentReaction.ts", { stubs: true });
  const prepared = {
    agentId: "agent-other",
    comment: { id: 55, text: "x", task: { id: 9, projectId: 15, ticketNumber: "HTPR-7122", title: "T" } },
  };
  await mod.persistCommentReactionWebhook({}, prepared, {
    commentId: 55, reactorUserId: 6, reactorIsAgent: true, reactorAgentId: RUNNER.id, emoji: "\u{1F44D}", added: true,
  });
  assert.deepEqual(actorInputs, [{ userId: 6, agentId: RUNNER.id }]);
  assert.equal(mod.reactionWebhookTarget({ added: true, reactorIsAgent: true, commentAgentId: "agent-other" }), null);
});
