const test = require("node:test");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const { fixture } = require("./helpers/htpr-7166-fixture.cjs");

const body = {
  projectId: 17,
  board_columns_view: [{ id: 1, section_title: "default" }],
  board_filters: { addedFilters: [] },
  board_subtask_setting: "Flattened_Card",
  board_subtask_explicit: true,
};

const nullish = (value) => JSON.parse(JSON.stringify(value, (_key, item) => (item === undefined ? null : item)));

const sameSettings = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .every((key) => isDeepStrictEqual(nullish(a[key]), nullish(b[key])));

const setup = (flagOn, draftExplicit = true) => {
  const h = fixture({
    owner: true,
    unsaved: true,
    defaultView: { board_subtask_setting: "None", board_columns_view: body.board_columns_view },
    draft: { board_subtask_explicit: draftExplicit, board_subtask_setting: "None" },
  });
  h.uv.appliedView = null;
  h.uv.appliedViewId = null;
  h.mocks["@/lib/savedViews/boardDefaultSubtasks"] = { boardDefaultShowsSubtasks: async () => flagOn };
  h.mocks["@/utils/helperFunctions/helperFunctions"] = {
    isDeepEqual: sameSettings,
    getCurrentProject: () => ({ _sections: [], firstTask: null }),
  };
  for (const name of ["create", "update", "delete"]) {
    h.prisma.view[name] = async (query) => {
      h.writes.push([`view-${name}`, query]);
      if (name === "delete") {
        h.uv.unsavedViewId = null;
        h.uv.unsavedView = null;
      } else Object.assign(h.draft, query.data);
      return h.draft;
    };
  }
  return { h, post: h.load("src/lib/api/project-writes/views/unsaved-view.ts").POST };
};

test("with the switch on, showing sub-tickets again on the main tab deletes the explicit hide draft", async () => {
  const { h, post } = setup(true);
  assert.equal((await post(h.request(body))).status, 200);
  assert.ok(h.writes.some(([name]) => name === "view-delete"), "the draft is deleted");
  assert.ok(!h.writes.some(([name]) => name === "view-update"));
  assert.equal(h.uv.unsavedViewId, null);
});

test("with the switch on, an explicit hide still survives a matching write", async () => {
  const { h, post } = setup(true);
  assert.equal((await post(h.request({ ...body, board_subtask_setting: "None" }))).status, 200);
  assert.ok(!h.writes.some(([name]) => name === "view-delete"));
  assert.equal(h.draft.board_subtask_setting, "None");
});

test("with the switch on, a different show setting keeps the draft", async () => {
  const { h, post } = setup(true);
  assert.equal((await post(h.request({ ...body, board_subtask_setting: "Flattened" }))).status, 200);
  assert.ok(!h.writes.some(([name]) => name === "view-delete"));
  assert.equal(h.draft.board_subtask_setting, "Flattened");
});

test("with the switch off, the draft is kept as before", async () => {
  const { h, post } = setup(false);
  assert.equal((await post(h.request(body))).status, 200);
  assert.ok(!h.writes.some(([name]) => name === "view-delete"), "the draft is not deleted");
  assert.equal(h.draft.board_subtask_setting, "Flattened_Card");
  assert.equal(h.uv.unsavedViewId, "draft");
});

test("with the switch off, a request equal to the stored default is deleted as before", async () => {
  const { h, post } = setup(false, false);
  assert.equal((await post(h.request({ ...body, board_subtask_setting: "None", board_subtask_explicit: false }))).status, 200);
  assert.ok(h.writes.some(([name]) => name === "view-delete"));
});
