const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const axios = require("axios");
const { QueryClient } = require("@tanstack/react-query");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const source = read("src/components/Modals/commands/manageColumn.tsx");
const tree = ts.createSourceFile("manageColumn.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["refuseLastColumnDelete", "updateSection", "handleSectionUpdateVis", "confirmDelete"]);
const declarations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(tree))) {
    declarations.push(`const ${node.getText(tree)};`);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.length, names.size);
const code = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const message = "This is the board's last column. Move or delete its cards first.";
const refusal = Object.assign(new Error("Refused"), {
  isAxiosError: true,
  response: { status: 400, data: { code: "LAST_COLUMN_HAS_CARDS", message } },
});

function fixture(t, { enabled = true, instant = true, typed = false, project, queued = false } = {}) {
  const column = { id: 91, section_title: "Todo", deleted: false, items: [] };
  const card = { id: 42, sectionId: 91, section: "Todo", status: "Normal" };
  project ??= { id: 15, section: [column], sections: [column], filteredSections: [column], tasks: [card] };
  const editSection = project.section?.find((section) => (section.id ?? section.sectionId) === 91) ?? column;
  const queryClient = new QueryClient();

  const columnsKey = ["manageColumns", 15, 985];
  const keys = [["projectsAll"], ["projectsAllMinimal"], ["projectsAllMinimal", "owner"], columnsKey];
  keys.forEach((key, i) => queryClient.setQueryData(key,
    i === 0 ? { updatedProjects: [project] } : i === 3 ? project.sections : [project]));
  const initial = keys.map((key) => queryClient.getQueryData(key));
  let resolve, reject, releaseQueue;
  const network = new Promise((yes, no) => { resolve = yes; reject = no; });
  const queue = queued ? new Promise((yes) => { releaseQueue = yes; }) : Promise.resolve();
  const state = { project, requests: [], toasts: [], refetches: [], frames: [] };
  function observe() {
    const projects = [state.project, queryClient.getQueryData(keys[0]).updatedProjects[0],
      ...keys.slice(1, 3).map((key) => queryClient.getQueryData(key)[0])];
    state.frames.push(projects.flatMap((board) => ["section", "sections", "filteredSections"]
      .filter((field) => board[field]).map((field) => board[field].length))
      .concat(queryClient.getQueryData(columnsKey).length));
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(observe);
  t.after(() => { unsubscribe(); queryClient.clear(); });
  queryClient.refetchQueries = async (...args) => state.refetches.push(args);
  const post = (body) => { state.requests.push(body); observe(); return network; };
  const bindings = {
    noEmptyBoardFlash: enabled, instantColumnDelete: instant, lastColumnDeleteMessage: false,
    sections: project.sections, currentProject: project, editSection, currentUser: { id: 985 },
    updating: false, queryClient, globalConstants: { GetAllManageColumnsPrefixKey: "manageColumns" },
    typedWrite: typed ? post : undefined,
    axios: { isAxiosError: axios.isAxiosError, post: (url, body) => {
      assert.equal(url, "/api/section/update"); return post(body);
    } },
    queueSave: async (save) => { await queue; await save(); },
    setCurrentProject: (update) => { state.project = typeof update === "function" ? update(state.project) : update; observe(); },
    setUpdating() {}, setEditMode() {}, setDeleteModal() {},
    toast: { error: (text) => state.toasts.push(text) }, console: { log() {} },
  };
  const actions = new Function(...Object.keys(bindings), `${code}\nreturn {
    confirmDelete, directDelete: () => handleSectionUpdateVis(editSection, "DELETE"),
  };`)(...Object.values(bindings));
  return { ...actions, state, queryClient, keys, initial, resolve, reject, releaseQueue };
}

function neverEmpty(f) {
  assert.ok(f.state.frames.length > 0);
  assert.ok(f.state.frames.every((frame) => frame.every((count) => count > 0)), "every emitted board/cache snapshot must retain a column");
}
function untouched(f) {
  assert.equal(f.state.project, f.initial[0].updatedProjects[0]);
  f.keys.forEach((key, i) => assert.equal(f.queryClient.getQueryData(key), f.initial[i]));
  assert.deepEqual(f.state.refetches, []);
}

for (const typed of [false, true]) {
  for (const instant of [false, true]) {
    test(`populated last column is refused before any mutation or ${typed ? "typed" : "legacy"} request, instant ${instant}`, async (t) => {
      const f = fixture(t, { typed, instant });
      await f.confirmDelete();
      assert.deepEqual(f.state.requests, []);
      assert.deepEqual(f.state.toasts, [message]);
      untouched(f);
      assert.deepEqual(f.state.frames, []);
    });

    test(`OFF preserves the existing ${typed ? "typed" : "legacy"} refusal behavior, instant ${instant}`, async (t) => {
      const f = fixture(t, { enabled: false, typed, instant });
      const done = f.confirmDelete();
      await new Promise(setImmediate);
      assert.equal(f.state.requests.length, 1);
      assert.equal(f.state.project.sections.length, instant ? 0 : 1);
      if (instant) assert.ok(f.state.frames.some((frame) => frame.includes(0)), "positive control reproduces the empty frame");
      f.reject(refusal);
      await done;
      assert.deepEqual(f.state.toasts, instant ? ["Column could not be deleted"] : []);
      assert.equal(f.state.project.sections.length, 1);
    });
  }

  test(`unseen cards keep the last column in every frame until the ${typed ? "typed" : "legacy"} server refusal`, async (t) => {
    const column = { id: 91, section_title: "Todo", items: [] };
    const project = { id: 15, section: [column], sections: [column], filteredSections: [column], tasks: [] };
    const f = fixture(t, { typed, project });
    const done = f.confirmDelete();
    await new Promise(setImmediate);
    assert.equal(f.state.requests.length, 1);
    untouched(f);
    f.reject(refusal);
    await done;
    assert.deepEqual(f.state.toasts, [message]);
    untouched(f);
    neverEmpty(f);
  });

  test(`an actually empty last column waits for ${typed ? "typed" : "legacy"} success before removal`, async (t) => {
    const column = { id: 91, section_title: "Todo", items: [] };
    const f = fixture(t, { typed, project: { id: 15, section: [column], sections: [column], filteredSections: [column], tasks: [] } });
    const done = f.confirmDelete();
    await new Promise(setImmediate);
    untouched(f);
    neverEmpty(f);
    f.resolve({ status: 204 });
    await done;
    assert.deepEqual(f.queryClient.getQueryData(f.keys[3]), []);
    assert.deepEqual(f.state.refetches, [[{ queryKey: ["projectsAll"] }]]);
    assert.deepEqual(f.state.toasts, []);
  });
}

for (const cards of ["items", "legacy-title", "deleted-other-column", "sectionId-alias"]) {
  test(`guard handles ${cards} without relying on visible task counts`, async (t) => {
    const column = { [cards === "sectionId-alias" ? "sectionId" : "id"]: 91, section_title: "Todo", items: cards === "items" ? [{ id: 42, status: "Normal" }] : [] };
    const tasks = cards === "items" ? [] : [{ id: 42, sectionId: cards === "legacy-title" ? 0 : 91, section: "Todo", status: "Normal" }];
    const f = fixture(t, { project: { id: 15, section: [column, ...(cards === "deleted-other-column" ? [{ id: 92, deleted: true }] : [])], sections: [column], filteredSections: [column], tasks } });
    await f.confirmDelete();
    assert.deepEqual(f.state.requests, []);
    assert.deepEqual(f.state.toasts, [message]);
    untouched(f);
  });
}

test("a view hiding other canonical columns does not falsely refuse and does not empty on failure", async (t) => {
  const column = { id: 91, section_title: "Todo", items: [] };
  const project = { id: 15, section: [column, { id: 92 }], sections: [column], filteredSections: [column], tasks: [{ sectionId: 91, status: "Normal" }] };
  const f = fixture(t, { project });
  const done = f.confirmDelete();
  await new Promise(setImmediate);
  assert.equal(f.state.requests.length, 1);
  untouched(f);
  f.reject(refusal);
  await done;
  neverEmpty(f);
});

test("queued deletion checks the latest canonical cache, not its stale closure", async (t) => {
  const columns = [{ id: 91, section_title: "Todo", items: [] }, { id: 92, items: [] }];
  const project = { id: 15, section: columns, sections: columns, filteredSections: columns, tasks: [{ sectionId: 91, status: "Normal" }] };
  const f = fixture(t, { project, queued: true });
  const done = f.confirmDelete();
  const latest = { ...project, section: [columns[0]], sections: [columns[0]], filteredSections: [columns[0]] };
  f.queryClient.setQueryData(f.keys[0], { updatedProjects: [latest] });
  f.releaseQueue();
  await done;
  assert.deepEqual(f.state.requests, []);
  assert.deepEqual(f.state.toasts, [message]);
  neverEmpty(f);
});

test("multi-column optimistic failure rolls back while every snapshot retains a column", async (t) => {
  const columns = [{ id: 91, section_title: "Todo", items: [] }, { id: 92, items: [] }];
  const f = fixture(t, { project: { id: 15, section: columns, sections: columns, filteredSections: columns, tasks: [{ sectionId: 91, status: "Normal" }] } });
  const done = f.confirmDelete();
  await new Promise(setImmediate);
  assert.deepEqual(f.state.project.section.map((column) => column.id), [92]);
  f.reject(refusal);
  await done;
  assert.deepEqual(f.state.project.section.map((column) => column.id), [91, 92]);
  neverEmpty(f);
});

test("a stale minimal-cache variant never empties during an optimistic rollback", async (t) => {
  const columns = [{ id: 91, section_title: "Todo", items: [] }, { id: 92, items: [] }];
  const project = { id: 15, section: columns, sections: columns, filteredSections: columns, tasks: [{ sectionId: 91, status: "Normal" }] };
  const f = fixture(t, { project });
  f.queryClient.setQueryData(f.keys[2], [{ ...project, section: [columns[0]], sections: [columns[0]], filteredSections: [columns[0]] }]);
  const done = f.confirmDelete();
  await new Promise(setImmediate);
  assert.equal(f.state.requests.length, 1);
  assert.deepEqual(f.state.project.section.map((column) => column.id), [92]);
  assert.equal(f.queryClient.getQueryData(f.keys[2])[0].section.length, 1);
  f.reject(refusal);
  await done;
  neverEmpty(f);
});

test("the direct nonoptimistic delete handler also refuses before sending", async (t) => {
  const f = fixture(t);
  await f.directDelete();
  assert.deepEqual(f.state.requests, []);
  assert.deepEqual(f.state.toasts, [message]);
  untouched(f);
});

test("all column-delete UI routes share the flagged confirmation", () => {
  assert.match(source, /useFlag\(HTPR_7043_NO_EMPTY_BOARD_FLASH_FLAG\)/);
  assert.match(source, /onConfirm=\{confirmDelete\}/);
  assert.match(read("src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx"), /setShowCommands\(\{ show: true, mode: CommandMode\.ManageColumn \}\)/);
  assert.match(read("src/components/commandModalPanels2.tsx"), /commandMode === CommandMode\.ManageColumn \|\|\s*commandMode === CommandMode\.DeleteColumn \|\|\s*commandMode === CommandMode\.RenameColumn\) && \(\s*<ManageColumns/);
  assert.match(read("src/components/Modals/commands/HTC/AllCommands.ts"), /name: "Delete board column",\s*commandMode: CommandMode\.DeleteColumn/);
});
