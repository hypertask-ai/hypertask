// HTPR-7096: with the flag on, the owner's inbox only hears from their own
// agents when a comment mentions them, an agent mention is Important only when
// it is an unanswered Question. Flag off keeps today's behaviour.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7096-quiet-owner-inbox";
let entryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function load(flagOn, flagChecks = []) {
  stubModule("src/lib/flags.ts", {
    isFeatureEnabled: async (key, userId) => {
      flagChecks.push([key, userId]);
      return flagOn;
    },
  });
  const jiti = require("jiti")(path.join(root, `tests/htpr-7096-${++entryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  return {
    notifications: jiti(path.join(root, "src/utils/controllers/comments/commentNotifications.ts")),
    quiet: jiti(path.join(root, "src/utils/controllers/notifications/quietOwnerInbox.ts")),
    pure: jiti(path.join(root, "src/lib/inboxQuietAgents.ts")),
    tabs: jiti(path.join(root, "src/utils/helperFunctions/inboxHelpers.ts")),
  };
}

const OWNER = 8;
const task = { id: 99, projectId: 15, userId: OWNER };
const mentionOf = (userId) =>
  `<p><span data-type="mention" class="mention" data-id="x" data-label="name-${userId}">x</span> hi</p>`;

function recipientDeps({ assignees = [], followers = [] } = {}) {
  return {
    includeSenderInRecipients: (agentId) => Boolean(agentId),
    shouldNotifyTaskOwnerForComment: (creatorId, ownerId, agentId) =>
      Boolean(agentId) || creatorId !== ownerId,
    getMentionedUserIdsFromCommentText: (text) =>
      [...text.matchAll(/data-label="name-(\d+)"/g)].map((m) => Number(m[1])),
    prisma: {
      assignees: { findMany: async () => assignees },
      follower: { findMany: async () => followers },
    },
  };
}

test("1 flag on: own agent comment without a mention does not notify the owner", async () => {
  const checks = [];
  const { notifications } = load(true, checks);
  const ids = await notifications.resolveCommentRecipientUserIds(
    recipientDeps(), task, OWNER, OWNER, "agent-a", "<p>done</p>",
  );
  assert.deepEqual(ids, []);
  assert.deepEqual(checks, [[flagKey, OWNER]]);
});

test("1 flag on: own agent comment that mentions the owner still notifies the owner", async () => {
  const { notifications } = load(true);
  const ids = await notifications.resolveCommentRecipientUserIds(
    recipientDeps(), task, OWNER, OWNER, "agent-a", mentionOf(OWNER),
  );
  assert.deepEqual(ids, [OWNER]);
});

test("1 flag off: own agent comment notifies the owner as today", async () => {
  const { notifications } = load(false);
  const ids = await notifications.resolveCommentRecipientUserIds(
    recipientDeps(), task, OWNER, OWNER, "agent-a", "<p>done</p>",
  );
  assert.deepEqual(ids, [OWNER]);
});

test("1 flag on: human assignees and followers stay, a human comment still notifies the owner", async () => {
  const { notifications } = load(true);
  const deps = recipientDeps({ assignees: [{ userId: 11 }], followers: [{ userId: 12 }] });
  const agent = await notifications.resolveCommentRecipientUserIds(
    deps, task, OWNER, OWNER, "agent-a", "<p>done</p>",
  );
  assert.deepEqual([...agent].sort((a, b) => a - b), [11, 12]);
  const human = await notifications.resolveCommentRecipientUserIds(
    deps, task, 7, OWNER, null, "<p>hello</p>",
  );
  assert.deepEqual([...human].sort((a, b) => a - b), [8, 11, 12]);
});

test("1 flag on: an agent comment from a different user's token is not treated as the owner's agent", async () => {
  const { notifications } = load(true);
  const ids = await notifications.resolveCommentRecipientUserIds(
    recipientDeps(), task, 7, OWNER, "agent-z", "<p>done</p>",
  );
  assert.deepEqual(ids, [OWNER]);
});

const q = (text) => ({ text });
const row = (over) => ({
  id: String(Math.random()),
  type: "Mentioned",
  projectId: 15,
  taskId: 99,
  seen: false,
  userId: OWNER,
  fromAgentId: "agent-a",
  createdAt: "2026-10-10T10:00:00.000Z",
  project: { title: "Product", name: "product" },
  comment: q("<p>FYI</p>"),
  ...over,
});

test("2 question detection: bold, plain, any paragraph; not mid-sentence", () => {
  const { pure } = load(true);
  assert.equal(pure.isQuestionComment("<p><strong>Question:</strong> ship it?</p>"), true);
  assert.equal(pure.isQuestionComment("<p>Question: ship it?</p>"), true);
  assert.equal(pure.isQuestionComment("<p>Done.</p><p><strong>Question: </strong>ok?</p>"), true);
  assert.equal(pure.isQuestionComment("<p>I have a Question: here</p>"), false);
  assert.equal(pure.isQuestionComment("<p>Claimed.</p>"), false);
  assert.equal(pure.isQuestionComment(null), false);
});

function importantOf(rows) {
  const { tabs } = load(true);
  const { tabs: names, data } = tabs.getInboxTabs(rows);
  const important = names.find((tab) => tab.project === "Important");
  return important ? data[important.idx] : [];
}

test("2 flag on: agent mention that is not a Question leaves Important; Question and human stay", async () => {
  const { quiet } = load(true);
  const rows = [
    row({ comment: q("<p>FYI done</p>"), taskId: 1 }),
    row({ comment: q("<p><strong>Question:</strong> ok?</p>"), taskId: 2 }),
    row({ fromAgentId: null, comment: q("<p>hey</p>"), taskId: 3 }),
  ];
  const db = { comment: { groupBy: async () => [] }, notification: { findMany: async () => [] } };
  const marked = await quiet.markQuietAgentMentions(db, OWNER, rows);
  assert.deepEqual(marked.map((r) => r.quietImportant === true), [true, false, false]);
  assert.deepEqual(importantOf(marked), [1, 2]);
});

test("2 flag off: rows are untouched and every mention is Important as today", async () => {
  const { quiet } = load(false);
  const rows = [row({ taskId: 1 }), row({ comment: q("<p>Question: ok?</p>"), taskId: 2 })];
  const marked = await quiet.markQuietAgentMentions(
    { comment: { groupBy: async () => { throw new Error("no query when off"); } } }, OWNER, rows,
  );
  assert.equal(marked, rows);
  assert.deepEqual(importantOf(marked), [0, 1]);
});

test("3 flag on: a Question answered by the owner leaves Important, stays in the list", async () => {
  const { quiet } = load(true);
  const rows = [
    row({ comment: q("<p>Question: ok?</p>"), taskId: 5, createdAt: "2026-10-10T10:00:00.000Z" }),
    row({ comment: q("<p>Question: ok?</p>"), taskId: 6, createdAt: "2026-10-10T10:00:00.000Z" }),
  ];
  let seenWhere;
  const db = {
    notification: { findMany: async () => [] },
    comment: {
      groupBy: async ({ where }) => {
        seenWhere = where;
        return [{ taskId: 5, _max: { createdAt: new Date("2026-10-10T11:00:00.000Z") } },
                { taskId: 6, _max: { createdAt: new Date("2026-10-10T09:00:00.000Z") } }];
      },
    },
  };
  const marked = await quiet.markQuietAgentMentions(db, OWNER, rows);
  assert.deepEqual(marked.map((r) => r.quietImportant === true), [true, false]);
  assert.equal(seenWhere.creatorId, OWNER);
  assert.equal(seenWhere.agentId, null);
  assert.deepEqual(importantOf(marked), [1]);
  const { tabs, data } = load(true).tabs.getInboxTabs(marked);
  const all = tabs.flatMap((tab) => data[tab.idx]);
  assert.ok(all.includes(0), "answered row stays in the normal list");
});

test("3 answered time uses earnedAt when the row is display-swapped", () => {
  const { pure } = load(true);
  const base = { type: "Mentioned", fromAgentId: "a", taskId: 1, comment: q("<p>Question: x</p>") };
  const answered = new Map([[1, new Date("2026-10-10T10:30:00Z").getTime()]]);
  assert.equal(pure.isQuietAgentMention({ ...base, createdAt: "2026-10-10T12:00:00Z", earnedAt: "2026-10-10T10:00:00Z" }, answered), true);
  assert.equal(pure.isQuietAgentMention({ ...base, createdAt: "2026-10-10T12:00:00Z", earnedAt: "2026-10-10T11:00:00Z" }, answered), false);
});

test("4 question detection: attributed p and li, bold variants, mid-sentence", () => {
  const { pure } = load(true);
  assert.equal(pure.isQuestionComment('<p class="x">Question: proceed?</p>'), true);
  assert.equal(pure.isQuestionComment('<ul><li data-id="1">Question: proceed?</li></ul>'), true);
  assert.equal(pure.isQuestionComment('<p>Done.</p><p style="a:b"><strong>Question:</strong> ok?</p>'), true);
  assert.equal(pure.isQuestionComment('<div class="c"><b>Question:</b> ok?</div>'), true);
  assert.equal(pure.isQuestionComment('<p class="x">I have a Question: here</p>'), false);
  assert.equal(pure.isQuestionComment('<p class="x">FYI</p>'), false);
});

function mixedDb(events) {
  return { comment: { groupBy: async () => [] }, notification: { findMany: async () => events } };
}
const ev = (over) => ({
  taskId: 9,
  fromAgentId: null,
  createdAt: new Date("2026-10-10T09:00:00.000Z"),
  comment: q("<p>hey</p>"),
  ...over,
});

test("5 flag on: a human mention still active on the task keeps Important despite a newer agent FYI", async () => {
  const { quiet } = load(true);
  const rows = [row({ taskId: 9, comment: q("<p>FYI done</p>") })];
  const marked = await quiet.markQuietAgentMentions(
    mixedDb([ev({}), ev({ fromAgentId: "agent-a", comment: q("<p>FYI done</p>") })]), OWNER, rows,
  );
  assert.equal(marked[0].quietImportant, undefined);
  assert.deepEqual(importantOf(marked), [0]);
});

test("5 flag on: an unanswered agent Question on the task keeps Important despite a newer FYI", async () => {
  const { quiet } = load(true);
  const rows = [row({ taskId: 9, comment: q("<p>FYI done</p>") })];
  const marked = await quiet.markQuietAgentMentions(
    mixedDb([
      ev({ fromAgentId: "agent-a", comment: q('<p class="x">Question: ok?</p>') }),
      ev({ fromAgentId: "agent-a", comment: q("<p>FYI done</p>") }),
    ]), OWNER, rows,
  );
  assert.equal(marked[0].quietImportant, undefined);
});

test("5 flag on: only agent FYI mentions on the task quiet it", async () => {
  const { quiet } = load(true);
  const rows = [row({ taskId: 9, comment: q("<p>FYI done</p>") })];
  const marked = await quiet.markQuietAgentMentions(
    mixedDb([
      ev({ fromAgentId: "agent-a", comment: q("<p>FYI one</p>") }),
      ev({ fromAgentId: "agent-b", comment: q("<p>FYI two</p>") }),
    ]), OWNER, rows,
  );
  assert.equal(marked[0].quietImportant, true);
  assert.deepEqual(importantOf(marked), []);
});

test("6 flag on: assignee or follower owner is filtered from own agent chatter, mention path stays", async () => {
  const { notifications } = load(true);
  const deps = recipientDeps({ assignees: [{ userId: OWNER }, { userId: 11 }], followers: [{ userId: OWNER }] });
  const quiet = await notifications.resolveCommentRecipientUserIds(
    deps, task, OWNER, OWNER, "agent-a", "<p>done</p>",
  );
  assert.deepEqual(quiet, [11]);
  const mentioned = await notifications.resolveCommentRecipientUserIds(
    deps, task, OWNER, OWNER, "agent-a", mentionOf(OWNER),
  );
  assert.deepEqual([...mentioned].sort((a, b) => a - b), [8, 11]);
});

test("6 flag off: assignee owner still gets own agent chatter", async () => {
  const { notifications } = load(false);
  const deps = recipientDeps({ assignees: [{ userId: OWNER }] });
  const ids = await notifications.resolveCommentRecipientUserIds(
    deps, task, OWNER, OWNER, "agent-a", "<p>done</p>",
  );
  assert.deepEqual(ids, [OWNER]);
});
