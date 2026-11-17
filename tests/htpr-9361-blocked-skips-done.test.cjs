const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-9361-blocked-skips-done";
const builtin = loadModule("src/lib/constants/builtinViews.ts");
const doneTitles = new Set(["done"]);

function project() {
  return {
    id: 15,
    cyclesEnabled: false,
    section: [
      { id: 1, sectionId: 1, section_title: "Doing", isDone: false },
      { id: 2, sectionId: 2, section_title: "Done", isDone: true },
    ],
    sections: [],
    tasks: [
      { id: "open", section: "Doing", sectionId: 1, status: "Normal", waitingOnUserId: 9 },
      { id: "waiting-done", section: "Done", sectionId: 2, status: "Normal", waitingOnUserId: 9 },
      { id: "blocked-done", section: "Done", sectionId: 2, status: "Normal", blockingTasks: [{ id: 10 }] },
    ],
    project_view: { default_view_id: "default", user_project_views: [] },
  };
}

function blockedCount(enabled) {
  const useRenderedViews = loadModule("src/hooks/Homepage/Views/useRenderedViews.ts", {
    react: { useMemo: (fn) => fn() },
    "@/lib/state": { useRecoilValue: (atom) => (atom === "user" ? { id: 6, displayName: "Valentin" } : {}) },
    "@/store": { currentUserAtom: "user" },
    "./useOrderedViews": { default: () => builtin.BUILTIN_VIEWS },
    "@/hooks/Task Detail/useTimeTracking": { useBoardRunningTimers: () => ({ timers: new Map() }) },
    "@/hooks/useFlag": { useFlag: (key) => (key === FLAG ? enabled : false) },
    "@/lib/constants/builtinViews": builtin,
  }).default;
  return useRenderedViews(project()).viewTaskCounts.get(builtin.BUILTIN_VIEW_IDS.blocked);
}

function ruleLine(enabled) {
  const CycleBoardMeta = loadModule(
    "src/components/PageComponents/Kanban/HeaderComponents/CycleBoardMeta.tsx",
    { "@/hooks/useFlag": { useFlag: () => enabled } },
  ).default;
  return renderToStaticMarkup(
    React.createElement(CycleBoardMeta, { activeViewId: builtin.BUILTIN_VIEW_IDS.blocked, project: project() }),
  );
}

test("Blocked leaves out finished tickets only when the flag is on", () => {
  assert.equal(blockedCount(false), 3);
  assert.equal(blockedCount(true), 1);
});

test("Blocked and Blocked by me skip done columns when asked", () => {
  const open = { section: "Doing", waitingOnUserId: 9 };
  const waitingInDone = { section: "Done", waitingOnUserId: 9 };
  const blockedInDone = { section: "Done", blockingTasks: [{ id: 10 }] };

  assert.equal(builtin.blockedPredicate(waitingInDone, { doneSectionTitles: doneTitles }), true);
  assert.equal(
    builtin.blockedPredicate(waitingInDone, { doneSectionTitles: doneTitles, excludeDoneFromBlocked: true }),
    false,
  );
  assert.equal(
    builtin.blockedPredicate(blockedInDone, { doneSectionTitles: doneTitles, excludeDoneFromBlocked: true }),
    false,
  );
  assert.equal(
    builtin.blockedPredicate(open, { doneSectionTitles: doneTitles, excludeDoneFromBlocked: true }),
    true,
  );
  assert.equal(
    builtin.blockedByMePredicate(
      { ...waitingInDone, waitingOnUserId: 6 },
      { currentUserId: 6, doneSectionTitles: doneTitles, excludeDoneFromBlocked: true },
    ),
    false,
  );
  assert.equal(
    builtin.blockedByMePredicate(
      { ...open, waitingOnUserId: 6 },
      { currentUserId: 6, doneSectionTitles: doneTitles, excludeDoneFromBlocked: true },
    ),
    true,
  );
});

test("Blocked by me reads the column a ticket sits in, not its stale title", () => {
  const moved = { id: "moved", section: "Doing", sectionId: 1, ranking: "a", waitingOnUserId: 6 };
  const staleProject = {
    id: 15,
    section: [
      { id: 1, sectionId: 1, section_title: "Doing", isDone: false },
      { id: 2, sectionId: 2, section_title: "Done", isDone: true },
    ],
    sections: [{ id: 2, sectionId: 2, section_title: "Done", items: [moved] }],
    tasks: [moved],
  };
  const sections = builtin.getBlockedByMeSections(staleProject, {
    currentUserId: 6,
    doneSectionTitles: doneTitles,
    excludeDoneFromBlocked: true,
  });

  assert.equal(sections.reduce((count, section) => count + section.items.length, 0), 0);
});

test("the built-in views state their rule in one short line", () => {
  const blocked = builtin.BUILTIN_VIEWS.find((view) => view.id === builtin.BUILTIN_VIEW_IDS.blocked);
  const blockedByMe = builtin.BUILTIN_VIEWS.find((view) => view.id === builtin.BUILTIN_VIEW_IDS.blockedByMe);

  assert.match(blocked.rule, /Finished tickets stay out\.$/);
  assert.match(blockedByMe.rule, /Finished tickets stay out\.$/);
});

test("the rule line appears on the board only when the flag is on", () => {
  assert.match(ruleLine(true), /Finished tickets stay out\./);
  assert.equal(ruleLine(false).includes("Finished tickets"), false);
});
