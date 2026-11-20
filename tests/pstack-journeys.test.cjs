const assert = require("node:assert/strict");
const test = require("node:test");
const { journeyIds, pagesForFiles } = require("../scripts/lib/pstack-journeys.cjs");

const pages = [
  {
    name: "boards-and-views",
    text: "Board drawings live in `src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx`.\n" +
      "Board routes are `src/app/[...boardURL]/page.tsx`.\n" +
      "- `calendar-control-state` With `htpr-7962-calendar-control-state` on, the Filter button is named Filter.\n" +
      "Open `/api/invite/reSendInvite` to resend an invite.\n",
  },
  {
    name: "login",
    text: "Sign in at `/login`. Flags live in `src/lib/flags/definitions/` and never change a page the person sees.\n",
  },
  {
    name: "inbox",
    text: "Notifications land here from `src/pages/api/queues/inboxReminder.ts`.\n",
  },
];

test("a changed flag definition selects the page whose sub-feature or flag key it names", () => {
  const chosen = pagesForFiles({ files: ["src/lib/flags/definitions/htpr-7962-calendar-control-state.ts"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
  assert.equal(chosen[0].score, 4);
});

test("a changed flag definition selects a page that lists only the slug", () => {
  const chosen = pagesForFiles({ files: ["src/lib/flags/definitions/htpr-9000-calendar-control-state.ts"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
});

test("a flag key in the diff selects the page that names it", () => {
  const chosen = pagesForFiles({ files: ["src/utils/controllers/projects/rename.ts"], diff: "+ if (flags.htpr-7962-calendar-control-state)", pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
});

test("a shared flag directory scores nothing, so an unrelated page is not selected", () => {
  assert.deepEqual(pagesForFiles({ files: ["src/lib/flags/definitions/htpr-9999-unknown-thing.ts"], pages }), []);
});

test("a shared src directory scores nothing", () => {
  assert.deepEqual(pagesForFiles({ files: ["src/utils/controllers/whatever.ts"], pages }), []);
});

test("a named source path and a named API path both select the page", () => {
  assert.deepEqual(pagesForFiles({ files: ["src/app/[...boardURL]/page.tsx"], pages }).map((item) => item.page), ["boards-and-views"]);
  assert.deepEqual(pagesForFiles({ files: ["src/pages/api/queues/inboxReminder.ts"], pages }).map((item) => item.page), ["inbox"]);
  assert.deepEqual(pagesForFiles({ files: ["src/pages/api/invite/reSendInvite.ts"], pages }).map((item) => item.page), ["boards-and-views"]);
});

test("a specific component directory selects its page and scores two", () => {
  const chosen = pagesForFiles({ files: ["src/components/PageComponents/Kanban/KanbanSectionComponents/column.tsx"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
  assert.equal(chosen[0].score, 2);
});

test("a source path named verbatim scores three", () => {
  const chosen = pagesForFiles({ files: ["src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views"]);
  assert.equal(chosen[0].score, 3);
});

test("a generic basename never selects a page", () => {
  const generic = [{ name: "themes", text: "Every page.tsx and route.ts draws this." }];
  assert.deepEqual(pagesForFiles({ files: ["src/app/settings/page.tsx"], pages: generic }), []);
  assert.deepEqual(pagesForFiles({ files: ["package.json", "README.md", "tsconfig.json"], pages: generic }), []);
});

test("a feature-named component file selects its page by name", () => {
  const named = [{ name: "calendar", text: "The card is `calendar-control-state.tsx`." }];
  assert.deepEqual(pagesForFiles({ files: ["src/components/calendar-control-state.tsx"], pages: named }).map((item) => item.page), ["calendar"]);
});

test("pages carry a score and are ordered by it, then by name", () => {
  const chosen = pagesForFiles({ files: ["src/lib/flags/definitions/htpr-7962-calendar-control-state.ts", "src/pages/api/queues/inboxReminder.ts"], pages });
  assert.deepEqual(chosen.map((item) => item.page), ["boards-and-views", "inbox"]);
});

test("a test file alone never selects a page", () => {
  const tested = [
    { name: "agent-runs", text: "Verification: `tests/agent-runs.test.cjs` covers the run timeline.\n" },
    { name: "billing-and-plans", text: "Verification: `tests/billing-and-plans.test.cjs` covers checkout.\n" },
  ];
  assert.deepEqual(pagesForFiles({ files: ["tests/agent-runs.test.cjs", "tests/billing-and-plans.test.cjs"], pages: tested }), []);
});

test("a page that names a test keeps working when the source beside it changes", () => {
  const tested = [{ name: "inbox", text: "Notifications land here from `src/pages/api/queues/inboxReminder.ts`.\n`tests/inbox.test.cjs` covers it.\n" }];
  assert.deepEqual(pagesForFiles({ files: ["tests/inbox.test.cjs"], pages: tested }), []);
  assert.deepEqual(pagesForFiles({ files: ["src/pages/api/queues/inboxReminder.ts"], pages: tested }).map((item) => item.page), ["inbox"]);
});

test("a flag-looking test filename is not a flag key, a changed flag line still is", () => {
  const flags = [{ name: "save-limits", text: "With `htpr-9106-save-limit` on, a save stops at the agent deadline.\n" }];
  const header = "diff --git a/tests/htpr-9106-save-limit.test.cjs b/tests/htpr-9106-save-limit.test.cjs\n--- a/tests/htpr-9106-save-limit.test.cjs\n+++ b/tests/htpr-9106-save-limit.test.cjs\n@@ -1 +1 @@\n-const budget = 30;\n+const budget = 60;\n";
  assert.deepEqual(pagesForFiles({ files: [], diff: header, pages: flags }), []);
  assert.deepEqual(pagesForFiles({ files: [], diff: "+  if (flags.htpr-9106-save-limit) return;\n", pages: flags }).map((item) => item.page), ["save-limits"]);
});

test("an app change that matches no page returns nothing, so the run falls back", () => {
  assert.deepEqual(pagesForFiles({ files: ["src/lib/api/task-writes/create-global.ts"], diff: "htpr-9399-archived-board-tickets", pages }), []);
});

test("journeys pair one area id per matched page with one change id", () => {
  assert.deepEqual(journeyIds({ pages: ["boards-and-views", "inbox"] }), ["area:boards-and-views", "area:inbox", "change:primary"]);
  assert.deepEqual(journeyIds({ pages: [], bugfix: true }), ["change:repro"]);
});
