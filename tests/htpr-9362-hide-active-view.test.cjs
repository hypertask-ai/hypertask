const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const builtin = loadModule("src/lib/constants/builtinViews.ts");
const { parseBoardDisplay } = loadModule("src/lib/firstScreen/boardDisplay.ts");
const { DEFAULT_TABLE_COLUMNS } = loadModule("src/utils/helperFunctions/Views/TableColumnsHelperFunctions.ts");
const blockedId = builtin.BUILTIN_VIEW_IDS.blocked;
const home = { id: "home", title: "Product" };

const project = () => ({
  id: 15,
  title: "Product",
  section: [],
  tasks: [],
  members: [],
  cycles: [],
  project_view: {
    default_view_id: "home",
    allViews: [home],
    user_project_views: [],
  },
});

const listed = (options) => [home.id, blockedId].filter((viewId) => builtin.viewTabIsShown(viewId, {
  projectId: 15,
  defaultViewId: "home",
  activeViewId: options.activeViewId,
  hiddenViewTabIds: options.hiddenViewTabIds,
  keepOpenViewVisible: options.keepOpenViewVisible,
}));

const hiddenBlocked = { [builtin.viewTabPreferenceKey(15, blockedId)]: true };

test("hiding the open Blocked view removes it at once and after leaving that view", () => {
  assert.deepEqual(listed({
    activeViewId: blockedId,
    hiddenViewTabIds: {},
    keepOpenViewVisible: false,
  }), ["home", blockedId]);
  const next = builtin.getViewToActivateWhenHidden(
    project(),
    { 15: blockedId },
    [home, builtin.getBuiltinView(blockedId)],
    blockedId,
  );
  assert.equal(next.id, "home");
  assert.deepEqual(listed({
    activeViewId: blockedId,
    hiddenViewTabIds: hiddenBlocked,
    keepOpenViewVisible: false,
  }), ["home"]);
  assert.deepEqual(listed({
    activeViewId: "home",
    hiddenViewTabIds: hiddenBlocked,
    keepOpenViewVisible: false,
  }), ["home"]);
});

test("with the fix off, the open Blocked view stays in the list until it is no longer open", () => {
  assert.deepEqual(listed({
    activeViewId: blockedId,
    hiddenViewTabIds: hiddenBlocked,
    keepOpenViewVisible: true,
  }), ["home", blockedId]);
  assert.deepEqual(listed({
    activeViewId: "home",
    hiddenViewTabIds: hiddenBlocked,
    keepOpenViewVisible: true,
  }), ["home"]);
});

test("hiding a view that is not open does not move the board", () => {
  assert.equal(builtin.getViewToActivateWhenHidden(project(), {}, [home, builtin.getBuiltinView(blockedId)], blockedId), undefined);
});

test("a view already hidden while open is left for the home view when the board loads", () => {
  const saved = { id: "saved", title: "Sprint" };
  const board = {
    ...project(),
    project_view: {
      default_view_id: "home",
      allViews: [home, saved],
      user_project_views: [{ appliedView: saved }],
    },
  };
  const views = [home, saved, builtin.getBuiltinView(blockedId)];
  assert.equal(builtin.getHiddenOpenViewToLeave(board, {}, views, { saved: true }).id, "home");
  assert.equal(builtin.getHiddenOpenViewToLeave(board, {}, views, {}), undefined);
  assert.equal(builtin.getHiddenOpenViewToLeave(board, { 15: blockedId }, views, hiddenBlocked).id, "home");
  assert.equal(builtin.getHiddenOpenViewToLeave(project(), {}, views, { home: true }), undefined);
});

test("a hidden Blocked view is still hidden when the board display is read back", () => {
  const key = builtin.viewTabPreferenceKey(15, blockedId);
  assert.equal(key, "15:builtin:blocked");
  const display = {
    version: 1,
    accountId: 985,
    timeZone: "UTC",
    locale: "en-US",
    boardLayout: "board",
    theme: "porcelain",
    railCollapsed: true,
    quickTips: true,
    draftsFirst: false,
    isMobile: true,
    board: {
      railOn: true,
      showEmptyViewTabs: false,
      hiddenViewTabIds: { [key]: true },
      viewTabsOrder: { 15: ["home", blockedId] },
      tableColumns: DEFAULT_TABLE_COLUMNS,
      tableWidths: {},
      tableTitleWrap: true,
      openChat: false,
      chatSuppressed: false,
      chatPinned: false,
    },
  };
  const parsed = parseBoardDisplay(JSON.stringify(display), 985);
  assert.equal(parsed.board.hiddenViewTabIds[key], true);
  assert.deepEqual(parsed.board.viewTabsOrder["15"], ["home", blockedId]);
  assert.equal(parseBoardDisplay(JSON.stringify({
    ...display,
    board: { ...display.board, hiddenViewTabIds: { "<script>": true } },
  }), 985), null);
});

function renderedIds(hideOpenView) {
  const hook = loadModule("src/hooks/Homepage/Views/useRenderedViews.ts", {
    "@/lib/flags/definitions/htpr-7865-agent-creator-filter": { HTPR_7865_AGENT_CREATOR_FILTER_FLAG: "htpr-7865-agent-creator-filter" },
    "@/lib/flags/definitions/htpr-8171-hide-tags": { HTPR_8171_HIDE_TAGS_FLAG: "htpr-8171-hide-tags" },
    "@/lib/flags/definitions/htpr-9362-hide-active-view": { HTPR_9362_HIDE_ACTIVE_VIEW_FLAG: "htpr-9362-hide-active-view" },
    "@/lib/flags/definitions/htpr-7804-blocked-by-me": { HTPR_7804_BLOCKED_BY_ME_FLAG: "htpr-7804-blocked-by-me" },
    react: { useMemo: (fn) => fn() },
    "@/lib/state": {
      useRecoilValue: (atom) => ({
        active: { 15: blockedId },
        hidden: hiddenBlocked,
        empty: true,
        user: { id: 6 },
      })[atom] ?? {},
    },
    "@/store": {
      activeBuiltinViewsAtom: "active",
      hiddenViewTabIdsAtom: "hidden",
      showEmptyViewTabsAtom: "empty",
      currentUserAtom: "user",
    },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveColumnsViewFromProject: () => [] },
    "@/lib/savedViews/savedViewTaskCounts": { countTasksInSavedView: () => 1 },
    "@/lib/constants/builtinViews": builtin,
    "./useOrderedViews": { __esModule: true, default: () => [home, builtin.getBuiltinView(blockedId)] },
    "@/hooks/Task Detail/useTimeTracking": { useBoardRunningTimers: () => ({ timers: new Map() }) },
    "@/hooks/useFlag": { useFlag: (key) => key === "htpr-9362-hide-active-view" && hideOpenView },
    "@/lib/flags/keys": {
      HTPR_8826_BLOCKED_BY_ME_LIST_FLAG: "htpr-8826-blocked-by-me-list",
      HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG: "htpr-7725-saved-view-assignee",
    },
  }).default;
  return hook(project()).renderedViews.map((view) => view.id);
}

test("the board tab list drops a hidden open Blocked view only when the fix is on", () => {
  assert.deepEqual(renderedIds(true), ["home"]);
  assert.deepEqual(renderedIds(false), ["home", blockedId]);
});
