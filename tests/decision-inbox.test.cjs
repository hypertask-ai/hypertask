const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const HOUR = 3600_000;
const now = Date.now();
const at = (hoursAgo) => new Date(now - hoursAgo * HOUR);

const task = (id, over = {}) => ({
  id,
  title: `Ticket ${id}`,
  ticketNumber: `HTPR-${id}`,
  uniqueIndex: id,
  projectId: 15,
  section: "Valentin Review",
  sectionChangedAt: at(5),
  ...over,
});

const load = ({ db, flagOn = true, flags = [] }) => {
  const source = fs.readFileSync(
    path.join(root, "src/utils/controllers/inbox/decisions.ts"),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/flags": { isFeatureEnabled: async () => flagOn, listFeatureFlagModes: async () => flags },
    "@/lib/flags/keys": { HTPR_7072_DECISION_INBOX_FLAG: "htpr-7072-decision-inbox" },
    "@/lib/flags/cluster": { isUnreleasedFeatureFlag: (f) => f.mode === "OWNER_ONLY" || f.mode === "OWNER_AND_QA" },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({ OR: [] }) },
  };
  new Function("module", "exports", "require", js)(mod, mod.exports, (r) => stubs[r] ?? require(r));
  return mod.exports.getDecisionInbox;
};

const makeDb = ({ reviewTasks = [], mentions = [], viewerComments = [] }) => {
  const calls = [];
  const log = (name, fn) => async (args) => {
    calls.push(name);
    return fn(args);
  };
  return {
    calls,
    user: { findUnique: log("user", async () => ({ displayName: "Valentin" })) },
    task: { findMany: log("task", async () => reviewTasks) },
    notification: { findMany: log("notification", async () => mentions) },
    comment: { findMany: log("comment", async () => viewerComments) },
  };
};

// commentText is the stored plain text; the controller only reads it (or strips text when absent).
const mention = (t, id, text, hoursAgo, commentText = text) => ({
  task: t,
  comment: { id, taskId: t.id, text, commentText, createdAt: at(hoursAgo) },
});

test("review column matches the first name as well as the full name", async () => {
  const db = makeDb({});
  let where;
  db.user.findUnique = async () => ({ displayName: "Valentin Yeo" });
  db.task.findMany = async (args) => { where = args.where; return []; };
  await load({ db })(6, false);
  const names = where.OR.map((clause) => clause.section.equals);
  assert.deepEqual(names, ["Valentin Yeo Review", "Valentin Review"]);
});

test("review column ticket shows as Waiting in the column", async () => {
  const db = makeDb({ reviewTasks: [task(1)] });
  const rows = await load({ db })(6, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "review");
  assert.equal(rows[0].question, "Waiting in Valentin Review");
  assert.equal(rows[0].href, "/detail/project-15/1");
});

test("unanswered Question comment is kept and deep links to the comment", async () => {
  const t = task(2);
  const db = makeDb({ mentions: [mention(t, 90, "<p><strong>Question:</strong> Ship it?</p>", 3)], reviewTasks: [t] });
  const rows = await load({ db })(6, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "question");
  assert.equal(rows[0].question, "Ship it?");
  assert.equal(rows[0].href, "/detail/project-15/2#comment-90");
});

test("question text is decoded once: nested tags go, escaped entities stay literal", async () => {
  const t = task(4);
  const html = "<p>Question: Keep &amp;lt;b&amp;gt; and <<b>i>x</i> &lt;tag&gt;?</p>";
  const db = makeDb({ mentions: [mention(t, 92, html, 1, "")] });
  const rows = await load({ db })(6, false);
  assert.equal(rows[0].question, "Keep &lt;b&gt; and x <tag>?");
});

test("a later comment by the viewer clears the question", async () => {
  const t = task(3);
  const db = makeDb({
    mentions: [mention(t, 91, "<p>Question: Ship it?</p>", 3)],
    viewerComments: [{ taskId: 3, createdAt: at(1) }],
  });
  assert.deepEqual(await load({ db })(6, false), []);
});

test("a viewer comment older than the question does not clear it", async () => {
  const t = task(4);
  const db = makeDb({
    mentions: [mention(t, 92, "Question: Ship it?", 3)],
    viewerComments: [{ taskId: 4, createdAt: at(9) }],
  });
  assert.equal((await load({ db })(6, false)).length, 1);
});

test("mentions that are not Questions are ignored", async () => {
  const db = makeDb({ mentions: [mention(task(5), 93, "<p>FYI look</p>", 2)] });
  assert.deepEqual(await load({ db })(6, false), []);
});

test("non-owner sees no flag rows, owner sees unreleased ones only", async () => {
  const flags = [
    { key: "a-flag", mode: "OWNER_AND_QA", description: "Shows X. More text.", updatedAt: at(2), shippedOn: null },
    { key: "b-flag", mode: "EVERYONE", description: "Shows Y.", updatedAt: at(2), shippedOn: null },
  ];
  assert.deepEqual(await load({ db: makeDb({}), flags })(6, false), []);
  const rows = await load({ db: makeDb({}), flags })(6, true);
  assert.deepEqual(rows.map((r) => [r.kind, r.question, r.href]), [
    ["flag", "Release Shows X.?", "/admin/flags/a-flag"],
  ]);
});

test("flag off returns nothing and runs no queries", async () => {
  const db = makeDb({ reviewTasks: [task(1)] });
  assert.deepEqual(await load({ db, flagOn: false })(6, true), []);
  assert.deepEqual(db.calls, []);
});

test("rows are sorted oldest waiting first", async () => {
  const db = makeDb({ reviewTasks: [task(1, { sectionChangedAt: at(1) }), task(2, { sectionChangedAt: at(8) })] });
  const rows = await load({ db })(6, false);
  assert.deepEqual(rows.map((r) => r.taskId), [2, 1]);
});

test("query count is fixed regardless of row count", async () => {
  const count = async (n) => {
    const list = Array.from({ length: n }, (_, i) => task(100 + i));
    const db = makeDb({
      reviewTasks: list,
      mentions: list.map((t, i) => mention(t, 500 + i, "Question: ok?", 2)),
    });
    await load({ db })(6, false);
    return db.calls.length;
  };
  assert.equal(await count(1), await count(40));
  assert.ok((await count(40)) <= 5);
});
