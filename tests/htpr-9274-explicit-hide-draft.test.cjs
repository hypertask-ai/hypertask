const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./helpers/htpr-7166-fixture.cjs");

const body = {
  projectId: 17,
  board_columns_view: [{ id: 1, section_title: "default" }],
  board_filters: { addedFilters: [] },
  board_subtask_setting: "None",
};

const setup = (options = {}) => {
  const h = fixture({ owner: true, ...options });
  h.mocks["@/lib/savedViews/boardDefaultSubtasks"] = { boardDefaultShowsSubtasks: async () => true };
  h.mocks["@/utils/helperFunctions/helperFunctions"] = {
    isDeepEqual: () => true,
    getCurrentProject: () => ({ _sections: [], firstTask: null }),
  };
  for (const name of ["create", "update", "delete"]) {
    h.prisma.view[name] = async (query) => {
      h.writes.push([`view-${name}`, query]);
      if (name === "delete") {
        h.draft.deleted = true;
        h.uv.unsavedViewId = null;
        h.uv.unsavedView = null;
      } else Object.assign(h.draft, query.data);
      return h.draft;
    };
  }
  return { h, post: h.load("src/lib/api/project-writes/views/unsaved-view.ts").POST };
};

test("an explicit hide on the main tab survives a later write whose body matches the board", async () => {
  const { h, post } = setup();
  assert.equal((await post(h.request({ ...body, board_subtask_explicit: true }))).status, 200);
  const created = h.writes.find(([name]) => name === "view-create")[1].data;
  assert.equal(created.board_subtask_setting, "None");
  assert.equal(created.board_subtask_explicit, true);
  h.uv.unsavedViewId = "draft";
  h.uv.unsavedView = h.draft;
  assert.equal((await post(h.request(body))).status, 200);
  assert.ok(!h.writes.some(([name]) => name === "view-delete"), "the explicit hide draft is kept");
  assert.equal(h.draft.board_subtask_explicit, true);
  assert.equal(h.draft.board_subtask_setting, "None");
});

test("a stored explicit hide stops protecting the draft once the request shows sub-tickets again", async () => {
  const { h, post } = setup({
    unsaved: true,
    draft: { board_subtask_explicit: true, board_subtask_setting: "None" },
  });
  assert.equal((await post(h.request({ ...body, board_subtask_setting: "Flattened_Card" }))).status, 200);
  assert.ok(h.writes.some(([name]) => name === "view-delete"), "the draft is deleted once the settings match the board again");
  assert.ok(!h.writes.some(([name]) => name === "view-update"));
  assert.equal(h.uv.unsavedViewId, null);
});
