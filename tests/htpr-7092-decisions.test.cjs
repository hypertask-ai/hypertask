const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

// Loads a TS source file with the "@/..." aliases resolved back to src/.
function loadTsModule(relativePath, stubs = {}) {
  const filename = path.join(root, relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (stubs[request]) return stubs[request];
    if (request.startsWith("@/")) {
      const base = path.join("src", request.slice(2));
      return loadTsModule(fs.existsSync(path.join(root, `${base}.ts`)) ? `${base}.ts` : `${base}/index.ts`);
    }
    return require(request);
  };
  loaded._compile(javascript, filename);
  return loaded.exports;
}

const FLAG = "htpr-7092-decisions";
const { isQuestionComment, pickDecisionTaskIds } = loadTsModule("src/lib/inboxDecisions.ts");
const builtin = loadTsModule("src/lib/constants/builtinViews.ts");
const { getInboxTabs } = loadTsModule("src/utils/helperFunctions/inboxHelpers.ts");
const jiti = require("jiti")(path.join(root, "tests/builtin-views-jiti-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getFilteredSections } = jiti(path.join(root, "src/utils/helperFunctions/Views/FilterHelperFunctions.ts"));

const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600_000);

test("flag file registers htpr-7092-decisions as Owner + QA", () => {
  const def = loadTsModule("src/lib/flags/definitions/htpr-7092-decisions.ts");
  assert.equal(def.HTPR_7092_DECISIONS_FLAG, FLAG);
  assert.equal(def.default.key, FLAG);
  assert.equal(def.default.defaultMode, "OWNER_AND_QA");
  assert.equal(def.default.kind, "feature");
});

test("Question detection accepts bold and plain Question: only at the start", () => {
  assert.equal(isQuestionComment("<p><strong>Question:</strong> ship it?</p>"), true);
  assert.equal(isQuestionComment("Question: ship it?"), true);
  assert.equal(isQuestionComment("<p>  question: lower case </p>"), true);
  assert.equal(isQuestionComment("<p>Next: a question: later</p>"), false);
  assert.equal(isQuestionComment("Claimed. Session working it now."), false);
  assert.equal(isQuestionComment(null), false);
});

test("a Question is a decision until the viewer answers it later", () => {
  const mentions = [
    { taskId: 1, text: "<p>Question: a?</p>", commentText: "Question: a?", createdAt: at(5) },
    { taskId: 2, text: "<p>Question: b?</p>", commentText: "Question: b?", createdAt: at(5) },
    { taskId: 3, text: "<p>Just FYI</p>", commentText: "Just FYI", createdAt: at(5) },
  ];
  const answered = [{ taskId: 2, createdAt: at(1) }];
  const early = [{ taskId: 1, createdAt: at(9) }];
  assert.deepEqual([...pickDecisionTaskIds(mentions, [...answered, ...early])], [1]);
});

const projectOf = (id) => ({ id, title: `Board ${id}`, name: `Board ${id}` });
const row = (id, taskId, over = {}) => ({
  id: String(id),
  type: "Mentioned",
  taskId,
  projectId: 15,
  project: projectOf(15),
  userId: 6,
  seen: false,
  createdAt: new Date().toISOString(),
  task: { status: "Normal", section: "Valentin Review", createdAt: new Date().toISOString(), assignees: [] },
  ...over,
});

const names = (result) => result.tabs.map((tab) => tab.project);

test("Decisions split lists only marked rows and sits right after Important", () => {
  const rows = [row(1, 101, { isDecision: true }), row(2, 102)];
  const result = getInboxTabs(rows, [], true, Date.now());
  const decisionsTab = result.tabs.find((tab) => tab.project === "Decisions");
  assert.ok(decisionsTab, "Decisions tab exists");
  assert.deepEqual(result.data[decisionsTab.idx], [0]);
  assert.equal(names(result)[0], "Important");
  assert.equal(names(result)[1], "Decisions");
  // The row also stays in its normal split (Important).
  const important = result.tabs.find((tab) => tab.project === "Important");
  assert.ok(result.data[important.idx].includes(0));
});

test("flag off: no marked rows means no Decisions tab", () => {
  const result = getInboxTabs([row(1, 101), row(2, 102)], [], true, Date.now());
  assert.equal(names(result).includes("Decisions"), false);
});

const section = (title, items) => ({ section_title: title, items, visibility: true });
const task = (id, sectionTitle) => ({ id, section: sectionTitle });

test("Decisions board view keeps only the user's Review column and UX Sign-off, hiding empty ones", () => {
  const project = {
    members: [{ userId: 6, user: { displayName: "Valentin Yeo" } }, { userId: 7, agentId: "a", user: { displayName: "Bot" } }],
    sections: [],
  };
  const context = builtin.buildBuiltinViewContext(project, 6);
  assert.deepEqual(context.currentUserNames, ["Valentin Yeo", "Valentin"]);
  const sections = [
    section("Backlog", [task(1, "Backlog")]),
    section("Valentin Review", [task(2, "Valentin Review")]),
    section("UX Sign-off", [task(3, "UX Sign-off")]),
    section("Abdul Review", [task(4, "Abdul Review")]),
    section("In Review", []),
  ];
  const out = getFilteredSections(sections, project, builtin.BUILTIN_VIEW_IDS.decisions, context);
  assert.deepEqual(out.map((s) => s.section_title), ["Valentin Review", "UX Sign-off"]);

  const withEmpty = [section("Valentin Review", []), section("UX Sign-off", [task(3, "UX Sign-off")])];
  const hidden = getFilteredSections(withEmpty, project, builtin.BUILTIN_VIEW_IDS.decisions, context);
  assert.deepEqual(hidden.map((s) => s.section_title), ["UX Sign-off"]);
});

test("Decisions is a built-in view available on every board", () => {
  const view = builtin.BUILTIN_VIEWS.find((v) => v.id === "builtin:decisions");
  assert.equal(view.title, "Decisions");
  assert.equal(view.builtin, true);
  assert.equal(view.available, undefined);
  assert.equal(builtin.isBuiltinViewId("builtin:decisions"), true);
});

test("flag off hides the board view: the view list drops it unless the flag is on", () => {
  const source = fs.readFileSync(path.join(root, "src/hooks/Homepage/Views/useOrderedViews.ts"), "utf8");
  assert.match(source, /useFlag\(HTPR_7092_DECISIONS_FLAG\)/);
  assert.match(source, /view\.id !== BUILTIN_VIEW_IDS\.decisions \|\| decisionsEnabled/);
});

const loadServer = (enabled, db) =>
  loadTsModule("src/utils/controllers/notifications/decisionTasks.ts", {
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/flags/keys": { HTPR_7092_DECISIONS_FLAG: FLAG },
  }).getDecisionTaskIds;

test("server: flag off returns no decisions and runs no query", async () => {
  let queries = 0;
  const db = {
    notification: { findMany: async () => { queries++; return []; } },
    comment: { findMany: async () => { queries++; return []; } },
  };
  const ids = await loadServer(false, db)(6, {});
  assert.equal(ids.size, 0);
  assert.equal(queries, 0);
});

test("server: flag on returns unanswered Question tasks with two queries", async () => {
  const calls = [];
  const db = {
    notification: {
      findMany: async (args) => {
        calls.push(["notification", args.where.type]);
        return [
          { taskId: 1, comment: { text: "<p><strong>Question:</strong> a?</p>", commentText: "Question: a?", createdAt: at(5) } },
          { taskId: 2, comment: { text: "<p>Question: b?</p>", commentText: "Question: b?", createdAt: at(5) } },
        ];
      },
    },
    comment: {
      findMany: async (args) => {
        calls.push(["comment", args.where.creatorId]);
        return [{ taskId: 2, createdAt: at(1) }];
      },
    },
  };
  const ids = await loadServer(true, db)(6, { userId: 6 });
  assert.deepEqual([...ids], [1]);
  assert.deepEqual(calls, [["notification", "Mentioned"], ["comment", 6]]);
});

test("server: getAll marks rows only through the gated helper", () => {
  const source = fs.readFileSync(path.join(root, "src/utils/controllers/notifications/getAll.ts"), "utf8");
  assert.match(source, /getDecisionTaskIds\(parsedUserId, inboxWhere\)/);
  assert.match(source, /isDecision: true/);
});

test("Question in a later paragraph matches (summary sentence first)", () => {
  const html =
    "<p><strong>The clickable wireframe is ready for you.</strong></p><p>Details here.</p>" +
    '<p><strong>Question:</strong> <span data-type="mention">@Valentin Yeo</span>, should we build it?</p>';
  assert.equal(isQuestionComment(html), true);
  assert.equal(isQuestionComment("Summary line\nQuestion: yes or no?"), true);
  assert.equal(isQuestionComment("<p>First</p><p><strong>Question:</strong> ok?</p>"), true);
});

test("Question: in the middle of a sentence or paragraph does not match", () => {
  assert.equal(isQuestionComment("<p>I have one Question: should we?</p>"), false);
  assert.equal(isQuestionComment("<p>Summary</p><p>Open point, Question: later</p>"), false);
  assert.equal(isQuestionComment("<p>The question: is open</p>"), false);
});

test("a first-paragraph question still matches", () => {
  assert.equal(isQuestionComment("<p><strong>Question:</strong> go?</p><p>More</p>"), true);
});

test("later-paragraph Question counts through pickDecisionTaskIds", () => {
  const html = "<p><strong>Summary.</strong></p><p><strong>Question:</strong> @V ok?</p>";
  const ids = pickDecisionTaskIds([{ taskId: 9, text: html, commentText: "Summary. Question: @V ok?", createdAt: at(3) }], []);
  assert.deepEqual([...ids], [9]);
});

test("Decisions board view sits right after the home tab for viewers who never reordered", () => {
  const { sortViewsByOrder } = loadTsModule("src/utils/helperFunctions/Views/ViewOrderHelperFunctions.ts");
  const saved = (id, created) => ({ id, title: id, createdAt: created });
  const views = [
    ...builtin.BUILTIN_VIEWS,
    saved("bugs", "2024-02-01"),
    saved("home", "2024-01-01"),
    saved("stale", "2024-03-01"),
  ];
  const ids = (list) => list.map((v) => v.id);
  const none = ids(sortViewsByOrder(views, undefined, "home"));
  assert.deepEqual(none.slice(0, 4), ["home", "builtin:decisions", "bugs", "stale"]);
  // A saved order that predates the view (does not list it) still puts it after home.
  const older = ids(sortViewsByOrder(views, ["home", "stale", "bugs"], "home"));
  assert.deepEqual(older.slice(0, 4), ["home", "builtin:decisions", "stale", "bugs"]);
  // A user who placed it explicitly keeps their placement.
  const placed = ids(sortViewsByOrder(views, ["home", "bugs", "builtin:decisions"], "home"));
  assert.deepEqual(placed.slice(0, 3), ["home", "bugs", "builtin:decisions"]);
});
