// HTPR-7122: an agent token used to save its emoji reaction as its owner's own,
// so a Runner's thumbs up looked and read exactly like Valentin's approval. These
// lock in that agent reactions are stored, shown and read as the agent.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    // Stubbed modules live in require.cache, which jiti only reads with its module cache on.
    ...(stubs ? {} : { fsCache: false, moduleCache: false }),
  });
  return jiti(path.join(root, relativePath));
}

// A small in-memory Reaction table that honours the where clauses the store uses.
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
        const row = { id: `r${nextId++}`, isDeleted: false, agentId: null, agentDisplayName: null, ...data };
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

const RUNNER = { id: "agent-runner-5", displayName: "Runner 5" };
const ownerThumb = () => ({
  id: "owner-1",
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

test("the web emoji click only ever finds and deletes the person's own rows", () => {
  const page = fs.readFileSync(path.join(root, "src/pages/api/comments/addReaction.ts"), "utf8");
  const scoped = page.match(/userId:userId,\s*(?:\/\/[^\n]*\n\s*)?agentId:null,/g) || [];
  // findMany plus both deleteMany calls.
  assert.equal(scoped.length, 3);
});

test("the MCP route reacts as the calling agent and names it on the inbox notification", () => {
  const route = fs.readFileSync(path.join(root, "src/app/api/mcp/comments/[comment_id]/reactions/route.ts"), "utf8");
  assert.match(route, /setReaction\(target, userId, emoji, active, ctx\.agentId \?\? null\)/);
  assert.match(route, /writeCommentReaction\(tx, \{/);
  assert.match(route, /reactorAgentId: agent\?\.id \?\? null/);
  assert.match(route, /fromAgentId: agentId/);
  assert.doesNotMatch(route, /where: \{ commentId: target\.commentId, userId, unified \}/);
  // The write response names only agents the caller may see, like the comment reads.
  assert.match(route, /loadVisibleReactionAgents\(\s*reactionAgentIds\(\[\{ reactions: result\.reactions \}\]\)/);
  assert.match(route, /reactions: result\.reactions\.map\(\(row\) => mapMcpCommentReaction\(row, visibleAgents\)\)/);
});

test("MCP reads mark an agent reaction and never attach the owner's user", () => {
  const { mapMcpCommentReaction, reactionAgentIds, commentReactionInclude } = loadTs(
    "src/lib/mcp/comments/reactionResponse.ts",
  );
  assert.equal(commentReactionInclude.select.agentId, true);
  const agentRow = {
    id: "r2", emoji: "\u{1F44D}", userId: 6, agentId: RUNNER.id, agentDisplayName: "Runner 5",
    user: { id: 6, displayName: "Valentin Yeo" },
  };
  assert.deepEqual(mapMcpCommentReaction(agentRow, new Map([[RUNNER.id, "Runner 5"]])), {
    id: "r2", emoji: "\u{1F44D}", userId: 6, isAgent: true, agent: { id: RUNNER.id, displayName: "Runner 5" },
  });
  assert.deepEqual(mapMcpCommentReaction(agentRow), {
    id: "r2", emoji: "\u{1F44D}", userId: 6, isAgent: true, agent: { displayName: "Private agent" },
  });
  const human = { id: "r1", emoji: "\u{1F44D}", userId: 6, agentId: null, user: { id: 6, displayName: "Valentin Yeo" } };
  assert.deepEqual(mapMcpCommentReaction(human), {
    id: "r1", emoji: "\u{1F44D}", userId: 6, user: { id: 6, displayName: "Valentin Yeo" },
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

test("task detail and shared reaction groups show agents as agents", () => {
  const load = fs.readFileSync(path.join(root, "src/utils/controllers/taskDetail/load.ts"), "utf8");
  assert.equal((load.match(/JSONB_AGG\(\$\{reactionReactor\(userId, slimUser\)\}\) AS users/g) || []).length, 2);
  assert.match(load, /'id', NULL,\s*'isAgent', true/);
  assert.match(load, /\|\| ' \(agent\)'/);
  const shared = fs.readFileSync(path.join(root, "src/utils/controllers/tasks/getSharedTask.ts"), "utf8");
  assert.match(shared, /CASE WHEN r\."agentId" IS NULL THEN TO_JSONB\(u\.\*\) ELSE/);
  // A public share never names an agent, so a reacting agent reads as "Private agent".
  assert.match(shared, /'isAgent', true,\s*'displayName', 'Private agent'/);
  assert.doesNotMatch(shared, /r\."agentDisplayName"/);
  const sheet = fs.readFileSync(
    path.join(root, "src/components/PageComponents/TaskDetail/CommentAndDescription/Common/MobileReactorsSheet.tsx"),
    "utf8",
  );
  assert.match(sheet, /const isCurrentUser = user\.id != null && user\.id === currentUser\?\.id;/);
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
  // And an agent's reaction never becomes an event for another agent at all.
  assert.equal(mod.reactionWebhookTarget({ added: true, reactorIsAgent: true, commentAgentId: "agent-other" }), null);
});

test("the migration only adds two nullable columns and is safe to re-run", () => {
  const sql = fs.readFileSync(
    path.join(root, "src/prisma/migrations/20261011140000_htpr_7122_reaction_agent/migration.sql"),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "agentId" TEXT,/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "agentDisplayName" TEXT;/);
  assert.match(sql, /set_config\('lock_timeout', '2s', true\)/);
  const statements = sql.replace(/--[^\n]*/g, "");
  assert.match(statements, /ALTER TABLE "Reaction"/);
  assert.doesNotMatch(statements, /\b(DROP|UPDATE|DELETE|NOT NULL|DEFAULT|CREATE INDEX|CONSTRAINT)\b/i);
});
