const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const axios = require("axios");
const { load } = require("./task-route-loader.cjs");

const message = "This is the board's last column. Move or delete its cards first.";
const code = "LAST_COLUMN_HAS_CARDS";
const key = "htpr-7040-last-column-delete-message";
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const source = read("src/components/Modals/commands/manageColumn.tsx");
const tree = ts.createSourceFile("manageColumn.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["updateSection", "handleSectionUpdateVis", "confirmDelete"].includes(node.name.getText(tree))) {
    declarations.push(`const ${node.getText(tree)};`);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.length, 3);
const clientCode = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function serverFixture() {
  const section = { id: 91, projectId: 15, section_title: "Todo", deleted: false };
  const cards = [{ id: 42, sectionId: 91, status: "Normal" }];
  const effects = [];
  const mocks = {
    "@/lib/prisma": { default: {
      section: { findFirst: async ({ where }) => where.id?.not ? null : section },
      project: { findFirst: async () => ({ id: 15 }) },
      task: { count: async () => cards.length },
    } },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({ ownerId: 985 }) },
    "@/utils/controllers/notifications/agentFirstTaskEmail": {},
    "./viewHelpers": {},
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/realtime/server": { broadcastBoardChange: (...args) => effects.push(args) },
    "@/lib/api/task-writes/route": {
      withTaskWriteFlag: (handler) => handler,
      taskWriteRoute: ({ operation }) => async (req) => operation(await req.json(), { userId: 985 }),
    },
  };
  const service = load("src/utils/controllers/section/sectionService.ts", mocks);
  const controller = load("src/utils/controllers/section/update.ts", mocks).default;
  mocks["@/utils/controllers/section/update"] = { default: controller };
  const pages = load("src/pages/api/section/update.ts", mocks).default;
  const web = load("src/lib/api/section-writes/update.ts", mocks).POST;
  const post = async (typed) => {
    const body = { sectionId: 91, newSection: { deleted: true } };
    if (typed) {
      const response = await web(new Request("https://example.invalid/api/section/update", {
        method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
      }));
      return { status: response.status, data: await response.json() };
    }
    let response;
    await pages({ method: "POST", headers: {}, body }, {
      status: (status) => ({ json: (data) => { response = { status, data }; } }),
    });
    return response;
  };
  return { service, post, section, cards, effects };
}

function clientFixture({ enabled = true, instant = false, typed = false, response, succeeds = false } = {}) {
  const section = { id: 91, section_title: "Todo", deleted: false };
  const cards = [{ id: 42, sectionId: 91 }];
  const project = { id: 15, section: [section], sections: [section], filteredSections: [section], tasks: cards };
  let current = project;
  const columnsKey = ["manageColumns", 15, 985];
  const cache = new Map([
    [JSON.stringify(["projectsAll"]), { updatedProjects: [project] }],
    [JSON.stringify(["projectsAllMinimal"]), [project]],
    [JSON.stringify(columnsKey), [section]],
  ]);
  const toasts = [], requests = [], observedColumns = [], refetches = [];
  const setQueryData = (key, update) => {
    const id = JSON.stringify(key);
    cache.set(id, typeof update === "function" ? update(cache.get(id)) : update);
  };
  const post = async (body) => {
    requests.push(body);
    observedColumns.push(current.sections.length);
    if (succeeds) return { status: 204 };
    const error = new Error("Refused");
    error.isAxiosError = true;
    error.response = response ?? { status: 400, data: { message, code } };
    throw error;
  };
  const bindings = {
    sections: [section], currentProject: project, currentUser: { id: 985 },
    updating: false, title: "Todo", ticketsFinished: false, editSection: section,
    instantColumnDelete: instant, lastColumnDeleteMessage: enabled,
    typedWrite: typed ? post : undefined,
    axios: { isAxiosError: axios.isAxiosError, post: (url, body) => {
      assert.equal(url, "/api/section/update"); return post(body);
    } },
    setUpdating() {}, setEditMode() {}, setDeleteModal() {}, setEditSection() {}, updateCache() {},
    setCurrentProject: (update) => { current = typeof update === "function" ? update(current) : update; },
    queueSave: async (save) => save(),
    globalConstants: { GetAllManageColumnsPrefixKey: "manageColumns" },
    queryClient: {
      cancelQueries: async () => {},
      getQueryData: (key) => cache.get(JSON.stringify(key)),
      getQueriesData: () => [[["projectsAllMinimal"], cache.get(JSON.stringify(["projectsAllMinimal"]))]],
      setQueryData,
      setQueriesData: (_, update) => setQueryData(["projectsAllMinimal"], update),
      refetchQueries: async (...args) => refetches.push(args),
    },
    console: { log() {} }, toast: { error: (text) => toasts.push(text) },
  };
  const confirmDelete = new Function(...Object.keys(bindings), `${clientCode}\nreturn confirmDelete;`)(...Object.values(bindings));
  return { confirmDelete, toasts, requests, observedColumns, refetches, cache, columnsKey, cards, current: () => current };
}

for (const typed of [false, true]) {
  test(`${typed ? "Web" : "Pages"} refusal includes the clear server body and preserves cards`, async () => {
    const f = serverFixture();
    const result = await f.service.deleteSection({ sectionId: 91, projectId: 15, userId: 985 });
    assert.equal(result.status, 400);
    assert.deepEqual(result.json, { message, code });
    assert.deepEqual(await f.post(typed), { status: 400, data: { projectId: 15, message, code } });
    assert.equal(f.section.deleted, false);
    assert.deepEqual(f.cards, [{ id: 42, sectionId: 91, status: "Normal" }]);
    assert.deepEqual(f.effects, []);
  });
  for (const instant of [false, true]) {
    test(`${typed ? "typed" : "legacy"} ${instant ? "optimistic" : "queued"} confirmation shows one toast and restores every cache`, async () => {
      const f = clientFixture({ typed, instant });
      await f.confirmDelete();
      assert.deepEqual(f.toasts, [message]);
      assert.equal(f.requests.length, 1);
      assert.deepEqual(f.observedColumns, [instant ? 0 : 1]);
      for (const field of ["section", "sections", "filteredSections"]) {
        assert.deepEqual(f.current()[field].map((s) => s.id), [91]);
        assert.deepEqual(f.cache.get(JSON.stringify(["projectsAll"])).updatedProjects[0][field].map((s) => s.id), [91]);
        assert.deepEqual(f.cache.get(JSON.stringify(["projectsAllMinimal"]))[0][field].map((s) => s.id), [91]);
      }
      assert.deepEqual(f.cache.get(JSON.stringify(f.columnsKey)).map((s) => s.id), [91]);
      assert.deepEqual(f.current().tasks, f.cards);
      assert.deepEqual(f.refetches, []);
    });
    test(`flag OFF preserves ${instant ? "generic optimistic" : "silent queued"} failure behavior (${typed ? "typed" : "legacy"})`, async () => {
      const f = clientFixture({ enabled: false, instant, typed });
      await f.confirmDelete();
      assert.deepEqual(f.toasts, instant ? ["Column could not be deleted"] : []);
      assert.equal(f.current().sections.length, 1);
    });
    test(`successful delete is unaffected (${typed ? "typed" : "legacy"}, instant ${instant})`, async () => {
      const f = clientFixture({ succeeds: true, instant, typed });
      await f.confirmDelete();
      assert.deepEqual(f.toasts, []);
      assert.deepEqual(f.cache.get(JSON.stringify(f.columnsKey)), []);
      assert.deepEqual(f.refetches, [[{ queryKey: ["projectsAll"] }]]);
    });
  }
}

for (const response of [
  { status: 403, data: { message, code } },
  { status: 500, data: { message, code } },
  { status: 400, data: { message: "Other error", code: "OTHER" } },
  { status: 400, data: { code } },
  undefined,
]) test(`unrelated or malformed refusal keeps generic rollback toast: ${JSON.stringify(response)}`, async () => {
  const f = clientFixture({ instant: true, response: response ?? { status: 400 } });
  await f.confirmDelete();
  assert.deepEqual(f.toasts, ["Column could not be deleted"]);
  assert.equal(f.current().sections.length, 1);
});

test("header and Ctrl+K use the shared flagged toast handler", () => {
  assert.match(source, /useFlag\(HTPR_7040_LAST_COLUMN_DELETE_MESSAGE_FLAG\)/);
  assert.equal(load("src/lib/flags/keys.ts", {}).HTPR_7040_LAST_COLUMN_DELETE_MESSAGE_FLAG, key);
  assert.match(read("src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx"), /setShowCommands\(\{ show: true, mode: CommandMode\.ManageColumn \}\)/);
  assert.match(read("src/components/commandModalPanels2.tsx"), /commandMode === CommandMode\.ManageColumn \|\|\s*commandMode === CommandMode\.DeleteColumn \|\|\s*commandMode === CommandMode\.RenameColumn\) && \(\s*<ManageColumns/);
  assert.match(read("src/components/Modals/commands/HTC/AllCommands.ts"), /name: "Delete board column",\s*commandMode: CommandMode\.DeleteColumn/);
});
