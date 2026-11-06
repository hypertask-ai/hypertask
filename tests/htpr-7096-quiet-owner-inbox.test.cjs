const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let entryId = 0;

function load() {
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

test("own agent comment without a mention does not notify the owner", async () => {
  const { notifications } = load();
  const ids = await notifications.resolveCommentRecipientUserIds(
    recipientDeps(), task, OWNER, OWNER, "agent-a", "<p>done</p>",
  );
  assert.deepEqual(ids, []);
});

test("own agent comment that mentions the owner still notifies the owner", async () => {
  const { notifications } = load();
  const ids = await notifications.resolveCommentRecipientUserIds(
    recipientDeps(), task, OWNER, OWNER, "agent-a", mentionOf(OWNER),
  );
  assert.deepEqual(ids, [OWNER]);
});

test("human assignees and followers stay, a human comment still notifies the owner", async () => {
  const { notifications } = load();
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

test("an agent comment from a different user's token is not treated as the owner's agent", async () => {
  const { notifications } = load();
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

test("question detection: bold, plain, any paragraph; not mid-sentence", () => {
  const { pure } = load();
  assert.equal(pure.isQuestionComment("<p><strong>Question:</strong> ship it?</p>"), true);
  assert.equal(pure.isQuestionComment("<p>Question: ship it?</p>"), true);
  assert.equal(pure.isQuestionComment("<p>Done.</p><p><strong>Question: </strong>ok?</p>"), true);
  assert.equal(pure.isQuestionComment("<p>I have a Question: here</p>"), false);
  assert.equal(pure.isQuestionComment("<p>Claimed.</p>"), false);
  assert.equal(pure.isQuestionComment(null), false);
});

function importantOf(rows) {
  const { tabs } = load();
  const { tabs: names, data } = tabs.getInboxTabs(rows);
  const important = names.find((tab) => tab.project === "Important");
  return important ? data[important.idx] : [];
}

test("agent mention that is not a Question leaves Important; Question and human stay", async () => {
  const { quiet } = load();
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

test("a Question answered by the owner leaves Important, stays in the list", async () => {
  const { quiet } = load();
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
  const { tabs, data } = load().tabs.getInboxTabs(marked);
  const all = tabs.flatMap((tab) => data[tab.idx]);
  assert.ok(all.includes(0), "answered row stays in the normal list");
});

test("answered time uses earnedAt when the row is display-swapped", () => {
  const { pure } = load();
  const base = { type: "Mentioned", fromAgentId: "a", taskId: 1, comment: q("<p>Question: x</p>") };
  const answered = new Map([[1, new Date("2026-10-10T10:30:00Z").getTime()]]);
  assert.equal(pure.isQuietAgentMention({ ...base, createdAt: "2026-10-10T12:00:00Z", earnedAt: "2026-10-10T10:00:00Z" }, answered), true);
  assert.equal(pure.isQuietAgentMention({ ...base, createdAt: "2026-10-10T12:00:00Z", earnedAt: "2026-10-10T11:00:00Z" }, answered), false);
});

test("question detection: attributed p and li, bold variants, mid-sentence", () => {
  const { pure } = load();
  assert.equal(pure.isQuestionComment('<p class="x">Question: proceed?</p>'), true);
  assert.equal(pure.isQuestionComment('<ul><li data-id="1">Question: proceed?</li></ul>'), true);
  assert.equal(pure.isQuestionComment('<p>Done.</p><p style="a:b"><strong>Question:</strong> ok?</p>'), true);
  assert.equal(pure.isQuestionComment('<div class="c"><b>Question:</b> ok?</div>'), true);
  assert.equal(pure.isQuestionComment('<p class="x">I have a Question: here</p>'), false);
  assert.equal(pure.isQuestionComment('<p class="x">FYI</p>'), false);
});

function mixedDb(events, assignedTaskIds = []) {
  return {
    comment: { groupBy: async () => [] },
    notification: { findMany: async () => events },
    assignees: { findMany: async () => assignedTaskIds.map((taskId) => ({ taskId })) },
  };
}
const ev = (over) => ({
  type: "Mentioned",
  taskId: 9,
  fromAgentId: null,
  createdAt: new Date("2026-10-10T09:00:00.000Z"),
  comment: q("<p>hey</p>"),
  ...over,
});

test("a human mention still active on the task keeps Important despite a newer agent FYI", async () => {
  const { quiet } = load();
  const rows = [row({ taskId: 9, comment: q("<p>FYI done</p>") })];
  const marked = await quiet.markQuietAgentMentions(
    mixedDb([ev({}), ev({ fromAgentId: "agent-a", comment: q("<p>FYI done</p>") })]), OWNER, rows,
  );
  assert.equal(marked[0].quietImportant, undefined);
  assert.deepEqual(importantOf(marked), [0]);
});

test("an unanswered agent Question on the task keeps Important despite a newer FYI", async () => {
  const { quiet } = load();
  const rows = [row({ taskId: 9, comment: q("<p>FYI done</p>") })];
  const marked = await quiet.markQuietAgentMentions(
    mixedDb([
      ev({ fromAgentId: "agent-a", comment: q('<p class="x">Question: ok?</p>') }),
      ev({ fromAgentId: "agent-a", comment: q("<p>FYI done</p>") }),
    ]), OWNER, rows,
  );
  assert.equal(marked[0].quietImportant, undefined);
});

test("only agent FYI mentions on the task quiet it", async () => {
  const { quiet } = load();
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

const fyi = () => ev({ fromAgentId: "agent-a", comment: q("<p>FYI done</p>") });
async function markMixed(events, assigned) {
  const { quiet } = load();
  const rows = [row({ taskId: 9, comment: q("<p>FYI done</p>") })];
  return quiet.markQuietAgentMentions(mixedDb(events, assigned), OWNER, rows);
}

test("a human Comment on a task the owner is assigned to keeps Important despite a newer agent FYI", async () => {
  const marked = await markMixed([ev({ type: "Comment" }), fyi()], [9]);
  assert.equal(marked[0].quietImportant, undefined);
  assert.deepEqual(importantOf(marked), [0]);
});

test("a human Comment on a task the owner is not assigned to is not Important today, so the FYI quiets it", async () => {
  const marked = await markMixed([ev({ type: "Comment" }), fyi()], []);
  assert.equal(marked[0].quietImportant, true);
});

test("a personal Assigned event keeps Important despite a newer agent FYI", async () => {
  const marked = await markMixed([ev({ type: "Assigned" }), fyi()], []);
  assert.equal(marked[0].quietImportant, undefined);
  assert.deepEqual(importantOf(marked), [0]);
});

test("an Assigned event made by an agent is housekeeping and does not keep Important", async () => {
  const marked = await markMixed([ev({ type: "Assigned", fromAgentId: "agent-a" }), fyi()], []);
  assert.equal(marked[0].quietImportant, true);
});

test("a direct reply keeps Important despite a newer agent FYI", async () => {
  const marked = await markMixed([ev({ type: "Comment", fromAgentId: "agent-a", directReply: true }), fyi()], []);
  assert.equal(marked[0].quietImportant, undefined);
});

test("a human mention plus a newer agent FYI keeps Important", async () => {
  const marked = await markMixed([ev({ type: "Mentioned" }), fyi()], []);
  assert.equal(marked[0].quietImportant, undefined);
  assert.deepEqual(importantOf(marked), [0]);
});

test("only an agent FYI is quiet, an unanswered agent Question stays Important", async () => {
  const quietOnly = await markMixed([fyi()], []);
  assert.equal(quietOnly[0].quietImportant, true);
  assert.deepEqual(importantOf(quietOnly), []);
  const question = await markMixed(
    [ev({ fromAgentId: "agent-a", comment: q("<p>Question: ok?</p>") }), fyi()], [],
  );
  assert.equal(question[0].quietImportant, undefined);
});

test("bold Question with the colon inside or outside the tags is detected", () => {
  const { pure } = load();
  assert.equal(pure.isQuestionComment("<p><strong>Question</strong>: ok?</p>"), true);
  assert.equal(pure.isQuestionComment("<p><strong>Question:</strong> ok?</p>"), true);
  assert.equal(pure.isQuestionComment("<p><strong>Questions</strong>: ok?</p>"), false);
});

test("assignee or follower owner is filtered from own agent chatter, mention path stays", async () => {
  const { notifications } = load();
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
