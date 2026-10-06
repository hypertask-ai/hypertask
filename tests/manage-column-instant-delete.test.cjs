const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");

const source = fs.readFileSync(
  path.join(__dirname, "../src/components/Modals/commands/manageColumn.tsx"),
  "utf8",
);
const file = ts.createSourceFile("manageColumn.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["updateSection", "handleSectionUpdateVis", "confirmDelete"]);
const declarations = [];
function visit(node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => names.has(d.name.getText(file)))) {
    declarations.push(node.getText(file));
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(declarations.length, names.size);
const javascript = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(t, { enabled = true, typed = false, updating = false } = {}) {
  const queryClient = new QueryClient();
  t.after(() => queryClient.clear());
  const sections = [1, 2, 3].map((id) => ({ id, section_title: `Column ${id}`, ranking: `A0${id}`, visibility: true }));
  const project = {
    id: 15,
    section: sections,
    sections: sections.map(({ id, ...rest }) => ({ sectionId: id, ...rest, items: [{ id: id * 10 }] })),
    filteredSections: [...sections],
  };
  const other = { id: 16, sections };
  const minimal = { id: 15, section: sections };
  const keys = [["projectsAll"], ["projectsAllMinimal"], ["projectsAllMinimal", "owner"], ["GetAllManageColumns", 15, 985]];
  const values = [{ updatedProjects: [project, other], metadata: "retained" }, [project, other], [minimal, other], sections];
  keys.forEach((key, i) => queryClient.setQueryData(key, values[i]));
  const before = keys.map((key) => queryClient.getQueryData(key));
  const network = deferred();
  const queue = deferred();
  const state = { project, editMode: true, deleteModal: true, errors: [], requests: [], refetches: [] };
  queryClient.refetchQueries = async (filter) => { state.refetches.push(filter); };
  const write = (...args) => { state.requests.push(args); return network.promise; };
  const bindings = {
    queryClient, instantColumnDelete: enabled, editSection: sections[1], currentProject: project,
    currentUser: { id: 985 }, globalConstants: { GetAllManageColumnsPrefixKey: "GetAllManageColumns" },
    sections, updating, typedWrite: typed ? write : undefined, axios: { post: write },
    setCurrentProject: (value) => { state.project = typeof value === "function" ? value(state.project) : value; },
    setEditMode: (value) => { state.editMode = typeof value === "function" ? value(state.editMode) : value; },
    setDeleteModal: (value) => { state.deleteModal = value; }, setUpdating: () => {},
    queueSave: (run) => queue.promise.then(run), toast: { error: (text) => state.errors.push(text) },
    console: { log: () => {} },
  };
  const confirm = new Function(...Object.keys(bindings), `${javascript}\nreturn confirmDelete;`)(...Object.values(bindings));
  return { confirm, queryClient, state, keys, before, network, queue };
}

function assertRemoved(h) {
  const ids = (list) => list.map((s) => s.id ?? s.sectionId);
  for (const field of ["section", "sections", "filteredSections"]) {
    assert.deepEqual(ids(h.state.project[field]), [1, 3]);
    assert.deepEqual(ids(h.queryClient.getQueryData(h.keys[0]).updatedProjects[0][field]), [1, 3]);
  }
  for (const key of h.keys.slice(1, 3)) {
    const projects = h.queryClient.getQueryData(key);
    assert.deepEqual(ids(projects[0].section), [1, 3]);
    assert.equal(projects[1], h.before[0].updatedProjects[1]);
  }
  assert.deepEqual(ids(h.queryClient.getQueryData(h.keys[3])), [1, 3]);
  assert.equal(h.state.editMode, false);
  assert.equal(h.state.deleteModal, false);
}

for (const typed of [false, true]) {
  test(`ON removes all rendered lists before queued saves and ${typed ? "typed" : "legacy"} request, then keeps success refetch`, async (t) => {
    const h = setup(t, { typed, updating: true });
    const done = h.confirm();
    assertRemoved(h);
    assert.equal(h.state.requests.length, 0);
    h.queue.resolve();
    await new Promise(setImmediate);
    assert.equal(h.state.requests.length, 1, "a stale updating closure must not drop the queued delete");
    assertRemoved(h);
    const request = h.state.requests[0];
    const body = typed ? request[0] : request[1];
    if (!typed) assert.equal(request[0], "/api/section/update");
    assert.equal(body.sectionId, 2);
    assert.equal(body.newSection.deleted, true);
    h.network.resolve({ status: 204 });
    await done;
    assertRemoved(h);
    assert.deepEqual(h.state.refetches, [{ queryKey: ["projectsAll"] }]);
    assert.deepEqual(h.state.errors, []);
  });

  test(`ON ${typed ? "typed refusal" : "network failure"} restores exact snapshots and uses the error toast`, async (t) => {
    const h = setup(t, { typed });
    const done = h.confirm();
    assertRemoved(h);
    h.queue.resolve();
    await new Promise(setImmediate);
    h.network.reject(new Error("Server refused deletion"));
    await done;
    assert.deepEqual(h.state.project, h.before[0].updatedProjects[0]);
    h.keys.forEach((key, i) => assert.deepEqual(h.queryClient.getQueryData(key), h.before[i]));
    assert.deepEqual(h.state.errors, ["Column could not be deleted"]);
    assert.deepEqual(h.state.refetches, []);
  });
}

test("OFF leaves the board and modal unchanged until the old request path succeeds", async (t) => {
  const h = setup(t, { enabled: false });
  const done = h.confirm();
  assert.equal(h.state.editMode, true);
  h.keys.forEach((key, i) => assert.deepEqual(h.queryClient.getQueryData(key), h.before[i]));
  h.queue.resolve();
  await new Promise(setImmediate);
  h.keys.forEach((key, i) => assert.deepEqual(h.queryClient.getQueryData(key), h.before[i]));
  h.network.resolve({ status: 204 });
  await done;
  assert.equal(h.state.project, h.before[0].updatedProjects[0]);
  h.keys.slice(0, 3).forEach((key, i) => assert.deepEqual(h.queryClient.getQueryData(key), h.before[i]));
  assert.deepEqual(h.queryClient.getQueryData(h.keys[3]).map((s) => s.id), [1, 3]);
  assert.deepEqual(h.state.refetches, [{ queryKey: ["projectsAll"] }]);
  assert.equal(h.state.editMode, false);
  assert.equal(h.state.deleteModal, false);
});

test("OFF failure retains the old silent failure and closes confirmation only after the request", async (t) => {
  const h = setup(t, { enabled: false });
  const done = h.confirm();
  h.queue.resolve();
  await new Promise(setImmediate);
  assert.equal(h.state.deleteModal, true);
  h.network.reject(new Error("failed"));
  await done;
  h.keys.forEach((key, i) => assert.deepEqual(h.queryClient.getQueryData(key), h.before[i]));
  assert.deepEqual(h.state.errors, []);
  assert.deepEqual(h.state.refetches, []);
});
