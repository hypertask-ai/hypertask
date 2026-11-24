const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");
const { filters } = require("./board-filters/runtime.cjs");
const { NOW, fixture, sectionIds } = require("./board-filters/fixture.cjs");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const builtin = jiti(path.join(root, "src/lib/constants/builtinViews.ts"));
const flagFile = path.join(root, "src/lib/flags/definitions/htpr-9361-blocked-view-done.ts");
const flag = fs.existsSync(flagFile)
  ? jiti(flagFile)
  : { default: {}, HTPR_9361_BLOCKED_VIEW_DONE_FLAG: "htpr-9361-blocked-view-done" };
const {
  BLOCKED_BY_ME_VIEW_RULE,
  BLOCKED_VIEW_RULE,
  BUILTIN_VIEW_IDS,
  blockedByMePredicate,
  blockedPredicate,
  blockedViewRule,
  buildBuiltinViewContext,
  builtinViewIdFromViewParam,
} = builtin;

const finished = (leaveFinishedOut) => ({
  leaveFinishedOut,
  doneSectionTitles: new Set(["done", "live"]),
});

test("finished tickets stay out of Blocked and open blocked tickets stay in", () => {
  const waiting = { waitingOnUserId: 6, section: "Doing" };
  const blockedByTicket = { blockingTasks: [{ id: 9 }], section: "Inbox" };
  const finishedWaiting = { waitingOnUserId: 6, section: "Done" };
  const finishedLive = { waitingOnUserId: 6, section: "Live" };

  assert.equal(blockedPredicate(finishedWaiting, finished(true)), false);
  assert.equal(blockedPredicate(finishedLive, finished(true)), false);
  assert.equal(blockedPredicate(waiting, finished(true)), true);
  assert.equal(blockedPredicate(blockedByTicket, finished(true)), true);
  assert.equal(blockedPredicate(finishedWaiting, finished(false)), true);
  assert.equal(blockedPredicate({ waitingOnUserId: null, blockingTasks: [] }, finished(true)), false);
});

test("Blocked by me leaves out a finished ticket waiting on the viewer", () => {
  const context = { currentUserId: 6, ...finished(true) };
  assert.equal(blockedByMePredicate({ waitingOnUserId: 6, section: "Done" }, context), false);
  assert.equal(blockedByMePredicate({ waitingOnUserId: 6, section: "Doing" }, context), true);
  assert.equal(blockedByMePredicate({ waitingOnUserId: 7, section: "Doing" }, context), false);
  assert.equal(
    blockedByMePredicate({ waitingOnUserId: 6, section: "Done" }, { currentUserId: 6, ...finished(false) }),
    true,
  );
});

test("board rows and tab counts drop the Done-column ticket together", () => {
  const { project, sections } = fixture();
  const done = sections.find((section) => section.section_title === "Done").items[0];
  done.waitingOnUserId = 6;
  const off = buildBuiltinViewContext(project, 6, NOW, "Valentin", false);
  const on = buildBuiltinViewContext(project, 6, NOW, "Valentin", true);
  assert.equal(done.section, "Done");
  assert.deepEqual(
    sectionIds(filters.getFilteredSections(sections, project, "builtin:blocked", off)),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    sectionIds(filters.getFilteredSections(sections, project, "builtin:blocked", on)),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    sectionIds(filters.getFilteredSections(sections, project, "builtin:blocked-by-me", off)),
    ["a", "d"],
  );
  assert.deepEqual(
    sectionIds(filters.getFilteredSections(sections, project, "builtin:blocked-by-me", on)),
    ["a"],
  );

  assert.equal(tabCount(project, false), 4);
  assert.equal(tabCount(project, true), 3);
});

test("a move into a Done column writes the title Blocked and Blocked by me read", () => {
  for (const file of [
    "src/hooks/MultiPages/useUpdateTaskInBoards.tsx",
    "src/hooks/Homepage/useHandleKeyDownOperations.ts",
    "src/hooks/Homepage/useMoveTasks.ts",
  ]) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), /taskInColumn\(/);
  }

  const { project, sections } = fixture();
  const inbox = sections.find((section) => section.section_title === "Inbox");
  const done = sections.find((section) => section.section_title === "Done");
  const task = inbox.items.find((item) => item.id === "a");
  const stale = { ...task, sectionId: done.sectionId };
  const placed = builtin.taskInColumn(task, { sectionId: done.sectionId, section_title: done.section_title });
  const on = buildBuiltinViewContext(project, 6, NOW, "Valentin", true);

  assert.equal(stale.section, "Inbox");
  assert.equal(blockedPredicate(stale, on), true);
  assert.equal(blockedByMePredicate(stale, on), true);
  assert.equal(placed.section, "Done");
  assert.equal(placed.sectionId, done.sectionId);
  assert.equal(blockedPredicate(placed, on), false);
  assert.equal(blockedByMePredicate(placed, on), false);

  const movedSections = sections.map((section) => {
    if (section.sectionId === inbox.sectionId) {
      return { ...section, items: section.items.filter((item) => item.id !== task.id) };
    }
    if (section.sectionId === done.sectionId) return { ...section, items: [...section.items, placed] };
    return section;
  });
  const movedProject = {
    ...project,
    tasks: project.tasks.map((item) => (item.id === task.id ? placed : item)),
  };
  assert.equal(
    sectionIds(filters.getFilteredSections(movedSections, movedProject, "builtin:blocked", on)).includes("a"),
    false,
  );
  assert.equal(movedProject.tasks.filter((item) => blockedPredicate(item, on)).some((item) => item.id === "a"), false);
  assert.equal(
    sectionIds(filters.getFilteredSections(movedSections, movedProject, "builtin:blocked-by-me", on)).includes("a"),
    false,
  );
});

test("Blocked states its rule and a cycle view keeps its own line", () => {
  assert.equal(blockedViewRule("builtin:blocked"), BLOCKED_VIEW_RULE);
  assert.equal(blockedViewRule("builtin:blocked-by-me"), BLOCKED_BY_ME_VIEW_RULE);
  assert.equal(blockedViewRule("builtin:overdue"), null);

  const landingState = fs.readFileSync(path.join(root, "src/app/[...boardURL]/useLandingSectionState.ts"), "utf8");
  assert.match(landingState, /leaveFinishedOut \? blockedViewRule\(activeViewId\) : null/);
  const page = fs.readFileSync(path.join(root, "src/app/[...boardURL]/LandingPage.tsx"), "utf8");
  assert.match(page, /blockedRuleText && \(/);
  assert.match(page, /data-testid="blocked-view-rule"[\s\S]{0,80}\{blockedRuleText\}/);

  const cycle = renderCycle("builtin:current-cycle", {
    cyclesEnabled: true,
    cycles: [{ id: 1, number: 4, projectId: 15, startDate: "2020-01-01", endDate: "2100-01-01" }],
    section: [],
  });
  assert.match(cycle, /data-testid="cycle-board-meta"/);
  assert.match(cycle, /Cycle 4/);
  assert.doesNotMatch(cycle, /blocked-view-rule/);
  assert.equal(renderCycle("builtin:blocked", { section: [], cycles: [] }), "");
});

test("a board link opens a built-in view with its rule", () => {
  assert.equal(builtinViewIdFromViewParam("builtin:blocked"), BUILTIN_VIEW_IDS.blocked);
  assert.equal(builtinViewIdFromViewParam(" Builtin:Blocked-By-Me "), BUILTIN_VIEW_IDS.blockedByMe);
  assert.equal(builtinViewIdFromViewParam("builtin:overdue"), BUILTIN_VIEW_IDS.overdue);
  assert.equal(builtinViewIdFromViewParam("blocked"), undefined);
  assert.equal(builtinViewIdFromViewParam("builtin:not-a-view"), undefined);
  assert.equal(builtinViewIdFromViewParam(null), undefined);
  assert.equal(builtinViewIdFromViewParam(undefined), undefined);

  const landing = fs.readFileSync(path.join(root, "src/app/[...boardURL]/useLandingSectionState.ts"), "utf8");
  assert.match(landing, /builtinViewIdFromViewParam\(new URLSearchParams\(window\.location\.search\)\.get\("view"\)\)/);
  assert.match(landing, /current\[currentProjectId\] === viewId/);
});

test("the Blocked done-column switch ships on for everyone", () => {
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.HTPR_9361_BLOCKED_VIEW_DONE_FLAG, "htpr-9361-blocked-view-done");
});

function tabCount(project, enabled) {
  const { default: useRenderedViews } = loadModule("src/hooks/Homepage/Views/useRenderedViews.ts", {
    react: { useMemo: (fn) => fn() },
    "@/lib/state": {
      useRecoilValue: (atom) => (atom === "user" ? { id: 6, displayName: "Valentin" } : {}),
    },
    "@/store": { currentUserAtom: "user" },
    "./useOrderedViews": { default: () => builtin.BUILTIN_VIEWS },
    "@/hooks/Task Detail/useTimeTracking": { useBoardRunningTimers: () => ({ timers: new Map() }) },
    "@/hooks/useFlag": {
      useFlag: (key) => (key === flag.HTPR_9361_BLOCKED_VIEW_DONE_FLAG ? enabled : false),
    },
    "@/lib/constants/builtinViews": builtin,
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveColumnsViewFromProject: () => [] },
    "@/lib/savedViews/savedViewTaskCounts": { countTasksInSavedView: () => 0 },
  });
  return useRenderedViews(project).viewTaskCounts.get("builtin:blocked");
}

function loadCycleMeta() {
  return loadModule("src/components/PageComponents/Kanban/HeaderComponents/CycleBoardMeta.tsx", {
    "@/lib/constants/builtinViews": builtin,
    "@/lib/cycles": jiti(path.join(root, "src/lib/cycles.ts")),
  }).default;
}

function renderCycle(activeViewId, project) {
  return renderToStaticMarkup(
    React.createElement(loadCycleMeta(), { activeViewId, project }),
  );
}
