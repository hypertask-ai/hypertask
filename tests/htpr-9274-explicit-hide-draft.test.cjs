const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./helpers/htpr-7166-fixture.cjs");

const body = {
  projectId: 17,
  board_columns_view: [{ id: 1, section_title: "default" }],
  board_filters: { addedFilters: [] },
  board_subtask_setting: "None",
};

const statefulDraft = (h) => {
  h.prisma.view.create = async ({ data }) => {
    h.writes.push(["view-create", { data }]);
    Object.assign(h.draft, data);
    return h.draft;
  };
  h.prisma.view.update = async ({ where, data }) => {
    h.writes.push(["view-update", { where, data }]);
    Object.assign(h.draft, data);
    return h.draft;
  };
  h.prisma.view.delete = async ({ where }) => {
    h.writes.push(["view-delete", { where }]);
    h.draft.deleted = true;
    h.uv.unsavedViewId = null;
    h.uv.unsavedView = null;
    return h.draft;
  };
};

test("an explicit hide on the main tab survives a later write whose body matches the board", async () => {
  const h = fixture({ owner: true });
  h.mocks["@/lib/savedViews/boardDefaultSubtasks"] = { boardDefaultShowsSubtasks: async () => true };
  h.mocks["@/utils/helperFunctions/helperFunctions"] = {
    isDeepEqual: () => true,
    getCurrentProject: () => ({ _sections: [], firstTask: null }),
  };
  statefulDraft(h);
  const post = h.load("src/lib/api/project-writes/views/unsaved-view.ts").POST;

  const explicitHide = await post(h.request({ ...body, board_subtask_explicit: true }));
  assert.equal(explicitHide.status, 200);
  const created = h.writes.find(([name]) => name === "view-create");
  assert.ok(created, "the explicit hide is stored as a draft");
  assert.equal(created[1].data.board_subtask_setting, "None");
  assert.equal(created[1].data.board_subtask_explicit, true);

  h.uv.unsavedViewId = "draft";
  h.uv.unsavedView = h.draft;
  h.uv.appliedViewId = null;
  h.uv.appliedView = null;

  const laterWrite = await post(h.request(body));
  assert.equal(laterWrite.status, 200);
  assert.equal(h.draft.deleted, undefined, "the explicit hide draft is kept");
  assert.equal(h.uv.unsavedViewId, "draft");
  assert.equal(h.draft.board_subtask_explicit, true);
  assert.equal(h.draft.board_subtask_setting, "None");
  assert.ok(!h.writes.some(([name]) => name === "view-delete"));
  assert.ok(!h.writes.some(([name, query]) => query.data?.board_subtask_explicit === false));
});

test("a stored explicit hide stops protecting the draft once the request shows sub-tickets again", async () => {
  const h = fixture({
    owner: true,
    unsaved: true,
    draft: { board_subtask_explicit: true, board_subtask_setting: "None" },
  });
  h.mocks["@/lib/savedViews/boardDefaultSubtasks"] = { boardDefaultShowsSubtasks: async () => true };
  h.mocks["@/utils/helperFunctions/helperFunctions"] = {
    isDeepEqual: () => true,
    getCurrentProject: () => ({ _sections: [], firstTask: null }),
  };
  statefulDraft(h);
  const post = h.load("src/lib/api/project-writes/views/unsaved-view.ts").POST;

  assert.equal(h.draft.board_subtask_explicit, true);

  const laterWrite = await post(h.request({ ...body, board_subtask_setting: "Flattened_Card" }));
  assert.equal(laterWrite.status, 200);
  assert.ok(
    h.writes.some(([name]) => name === "view-delete"),
    "the draft is deleted once the settings match the board again"
  );
  assert.equal(h.draft.deleted, true);
  assert.equal(h.uv.unsavedViewId, null);
  assert.ok(!h.writes.some(([name]) => name === "view-update"));
});
