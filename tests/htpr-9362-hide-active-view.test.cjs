const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const builtin = loadModule("src/lib/constants/builtinViews.ts");
const { default: flag } = loadModule("src/lib/flags/definitions/htpr-9362-hide-active-view.ts");

const project = (overrides = {}) => ({
  id: 15,
  section: [],
  tasks: [],
  project_view: {
    default_view_id: "home",
    allViews: [{ id: "home", title: "Home" }],
    user_project_views: [],
  },
  ...overrides,
});
const blocked = builtin.getBuiltinView(builtin.BUILTIN_VIEW_IDS.blocked);
const list = [{ id: "home", title: "Home" }, blocked];

test("hiding the active builtin view hands back the default view", () => {
  const target = builtin.getViewToActivateWhenHidden(
    project(),
    { 15: builtin.BUILTIN_VIEW_IDS.blocked },
    list,
    builtin.BUILTIN_VIEW_IDS.blocked,
  );
  assert.equal(target, list[0]);
  assert.equal(target.id, "home");
});

test("hiding a view that is not open leaves the selection alone", () => {
  assert.equal(
    builtin.getViewToActivateWhenHidden(
      project(),
      {},
      list,
      builtin.BUILTIN_VIEW_IDS.blocked,
    ),
    undefined,
  );
});

test("hiding the open saved view hands back the default view", () => {
  const withApplied = project();
  withApplied.project_view.user_project_views = [{ appliedView: { id: "other" } }];
  const target = builtin.getViewToActivateWhenHidden(
    withApplied,
    {},
    [{ id: "home" }, { id: "other" }],
    "other",
  );
  assert.equal(target.id, "home");
});

test("hiding a view on a board with no default view leaves the selection alone", () => {
  const bare = project();
  bare.project_view.default_view_id = undefined;
  assert.equal(
    builtin.getViewToActivateWhenHidden(
      bare,
      { 15: builtin.BUILTIN_VIEW_IDS.blocked },
      list,
      builtin.BUILTIN_VIEW_IDS.blocked,
    ),
    undefined,
  );
});

test("hiding the default view never asks the board to switch to itself", () => {
  assert.equal(
    builtin.getViewToActivateWhenHidden(project(), {}, list, "home"),
    undefined,
  );
});

test("HTPR-9362 view hide is a reversible low-risk bugfix for everyone", () => {
  assert.equal(flag.key, "htpr-9362-hide-active-view");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
