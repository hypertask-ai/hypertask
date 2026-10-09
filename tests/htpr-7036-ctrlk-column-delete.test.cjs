const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");

const key = "htpr-7036-ctrlk-column-delete-keeps-cards";
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const columnFile = "src/components/Modals/commands/manageColumn.tsx";
const source = read(columnFile);
const tree = ts.createSourceFile(columnFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["updateSection", "handleSectionUpdateVis"].includes(node.name.getText(tree))) {
    declarations.push(`const ${node.getText(tree)};`);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(declarations.length, 2);
const clientCode = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ enabled = true, last = false, empty = false, denied = false, noAuth = false } = {}) {
  const sections = [
    { id: 91, projectId: 15, section_title: "Removing", ranking: "A0200", deleted: false, visibility: true, isDone: null },
    ...last ? [] : [
      { id: 93, projectId: 15, section_title: "Adjacent", ranking: "A0300", deleted: false, visibility: true },
      { id: 92, projectId: 15, section_title: "First", ranking: "A0100", deleted: false, visibility: false },
      { id: 94, projectId: 15, section_title: "Already deleted", ranking: "A0000", deleted: true },
    ],
  ];
  const tasks = empty ? [] : [
    { id: 1, projectId: 15, sectionId: 91, section: "Removing", status: "Normal" },
    { id: 2, projectId: 15, sectionId: null, section: "Removing", status: "Normal" },
    { id: 3, projectId: 15, sectionId: 91, section: "Removing", status: "Archive" },
    { id: 4, projectId: 16, sectionId: 191, section: "Removing", status: "Normal" },
    { id: 5, projectId: 15, sectionId: 92, section: "First", status: "Normal" },
  ];
  const effects = [], history = [], flags = [], broadcasts = [], requests = [], refetches = [];
  const matches = (task, where) => (!where.projectId || task.projectId === where.projectId)
    && (!where.status || task.status === where.status)
    && (where.OR ? where.OR.some((match) => Object.entries(match).every(([field, value]) => task[field] === value)) : task.sectionId === where.sectionId);
  const prisma = {
    section: {
      findFirst: async ({ where }) => {
        if (where.project) {
          assert.deepEqual(where.project, { status: "Normal", ownerId: 985 });
          return denied ? null : sections.find((section) => section.id === where.id) ?? null;
        }
        return sections.filter((section) => section.projectId === where.projectId
          && (typeof where.id === "number" ? section.id === where.id : section.id !== where.id.not)
          && (where.deleted === undefined || section.deleted === where.deleted))
          .sort((a, b) => a.ranking.localeCompare(b.ranking))[0] ?? null;
      },
      findUnique: async ({ where }) => sections.find((section) => section.id === where.id),
      update: async ({ where, data }) => {
        effects.push("delete-section");
        const section = sections.find((section) => section.id === where.id);
        Object.assign(section, data);
        return { ...section };
      },
    },
    project: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { id: 15, status: "Normal", ownerId: 985 });
      return denied ? null : { id: 15 };
    } },
    task: {
      count: async ({ where }) => tasks.filter((task) => matches(task, where)).length,
      updateManyAndReturn: async ({ where, data }) => {
        effects.push("move-tasks");
        return tasks.filter((task) => matches(task, where)).map((task) => {
          Object.assign(task, data);
          return { ...task };
        });
      },
    },
    taskSectionEvent: { createMany: async ({ data }) => { history.push(...data); } },
  };
  prisma.$transaction = async (run) => run(prisma);
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": { isFeatureEnabled: async (...args) => { flags.push(args); return enabled; } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (userId) => ({ ownerId: userId }) },
    "@/utils/controllers/notifications/agentFirstTaskEmail": { scheduleAgentFirstTaskEmailBatch: () => assert.fail("No agent email for human deletion") },
    "./viewHelpers": {
      removeSectionFromAllViews: async (...args) => effects.push(["remove-views", ...args]),
      updateSectionInAllViews: async (...args) => effects.push(["update-views", ...args]),
    },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => noAuth ? null : { userId: 985 } },
    "@/lib/realtime/server": { broadcastBoardChange: (...args) => broadcasts.push(args) },
    "@/lib/api/task-writes/route": {
      withTaskWriteFlag: (handler) => handler,
      taskWriteRoute: ({ operation }) => async (req) => operation(await req.json(), { userId: 985 }),
    },
  };
  const controller = load("src/utils/controllers/section/update.ts", mocks).default;
  mocks["@/utils/controllers/section/update"] = { default: controller };
  const pages = load("src/pages/api/section/update.ts", mocks).default;
  const web = load("src/lib/api/section-writes/update.ts", mocks).POST;
  const post = async (body, typed) => {
    requests.push(body);
    let response;
    if (typed) {
      const result = await web(new Request("https://example.invalid/api/section/update", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      response = { status: result.status };
    } else {
      await pages({ method: "POST", headers: {}, body }, { status: (status) => ({ json: (data) => { response = { status, data }; } }) });
    }
    if (response.status >= 400) throw Object.assign(new Error("Refused"), { response });
    return response;
  };
  const client = (typed) => {
    const bindings = {
      sections, currentProject: { id: 15, section: sections, sections }, currentUser: { id: 6 },
      updating: false, title: "Unused", ticketsFinished: false,
      typedWrite: typed ? (body) => post(body, true) : undefined,
      axios: { post: (url, body) => { assert.equal(url, "/api/section/update"); return post(body, false); } },
      setUpdating() {}, setCurrentProject() {}, setEditSection() {}, updateCache() {},
      globalConstants: { GetAllManageColumnsPrefixKey: "manageColumns" },
      queryClient: { setQueryData() {}, refetchQueries: async (...args) => refetches.push(args), invalidateQueries: async () => {} },
      console: { log() {} }, toast: { error() {} },
    };
    return new Function(...Object.keys(bindings), `${clientCode}\nreturn handleSectionUpdateVis;`)(...Object.values(bindings));
  };
  const visibleCards = () => tasks.filter((task) => task.status === "Normal" && task.projectId === 15
    && sections.some((section) => !section.deleted && section.id === task.sectionId));
  return { sections, tasks, effects, history, flags, broadcasts, requests, refetches, controller, post, client, visibleCards };
}

for (const typed of [false, true]) {
  test(`Ctrl+K/header shared delete preserves cards after reload through ${typed ? "Web" : "Pages"} route`, async () => {
    const f = fixture();
    const beforeOthers = structuredClone(f.tasks.slice(2));
    // The client row is stale and contains an untrusted project ID: use the authorized server row.
    await f.client(typed)({ ...f.sections[0], projectId: 16, section_title: "Stale title" }, "DELETE");
    assert.equal(f.sections[0].deleted, true);
    assert.deepEqual(f.tasks.slice(0, 2).map(({ sectionId, section, status }) => ({ sectionId, section, status })), [
      { sectionId: 92, section: "First", status: "Normal" },
      { sectionId: 92, section: "First", status: "Normal" },
    ]);
    assert.deepEqual(f.tasks.slice(2), beforeOthers, "archived and other-board cards stay untouched");
    assert.deepEqual(f.visibleCards().map(({ id }) => id), [1, 2, 5]);
    assert.deepEqual(f.effects, ["move-tasks", "delete-section", ["remove-views", 91, 15]]);
    assert.deepEqual(f.flags, [[key, 985]]);
    assert.deepEqual(f.history.map(({ timestamp, ...event }) => event), [1, 2].map((taskId) => ({ taskId, from: "Removing", to: "First", userId: 985 })));
    assert.deepEqual(f.broadcasts, [[15, { originUserId: 985 }]]);
    assert.deepEqual(f.refetches, [[{ queryKey: ["projectsAll"] }]]);
    assert.equal(f.requests.length, 1);
  });

  test(`flag OFF keeps the old soft-delete and leaves recoverable Normal cards (${typed ? "Web" : "Pages"})`, async () => {
    const f = fixture({ enabled: false });
    await f.client(typed)(f.sections[0], "DELETE");
    assert.equal(f.sections[0].deleted, true);
    assert.deepEqual(f.tasks[0], { id: 1, projectId: 15, sectionId: 91, section: "Removing", status: "Normal" });
    assert.deepEqual(f.visibleCards().map(({ id }) => id), [5]);
    assert.deepEqual(f.history, []);
    assert.deepEqual(f.flags, [[key, 985]]);
    assert.deepEqual(f.broadcasts, [[15, { originUserId: 985 }]]);
  });

  test(`a populated final column is refused without losing cards (${typed ? "Web" : "Pages"})`, async () => {
    const f = fixture({ last: true });
    await assert.rejects(f.post({ sectionId: 91, newSection: { deleted: true } }, typed), (error) => error.response.status === 400);
    assert.equal(f.sections[0].deleted, false);
    assert.equal(f.tasks[0].sectionId, 91);
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.broadcasts, []);
  });

  test(`an empty final column can still be deleted (${typed ? "Web" : "Pages"})`, async () => {
    const f = fixture({ last: true, empty: true });
    assert.equal((await f.post({ sectionId: 91, newSection: { deleted: true } }, typed)).status, 204);
    assert.equal(f.sections[0].deleted, true);
    assert.deepEqual(f.effects, ["delete-section", ["remove-views", 91, 15]]);
    assert.deepEqual(f.broadcasts, [[15, { originUserId: 985 }]]);
  });
}

test("unauthenticated and foreign-board deletion remain forbidden before flag lookup or mutation", async () => {
  const unauthenticated = fixture({ noAuth: true });
  await assert.rejects(unauthenticated.post({ sectionId: 91, newSection: { deleted: true }, userId: 6 }, false), (error) => error.response.status === 401);
  assert.deepEqual(unauthenticated.flags, []);
  assert.deepEqual(unauthenticated.effects, []);
  const denied = fixture({ denied: true });
  assert.equal((await denied.controller(985, 91, { deleted: true })).status, 403);
  assert.deepEqual(denied.flags, []);
  assert.deepEqual(denied.effects, []);
});

test("renaming a column does not consult the delete flag or move its cards", async () => {
  const f = fixture();
  assert.equal((await f.controller(985, 91, { section_title: "Renamed" })).status, 200);
  assert.equal(f.sections[0].section_title, "Renamed");
  assert.equal(f.sections[0].deleted, false);
  assert.equal(f.tasks[0].sectionId, 91);
  assert.equal(f.tasks[0].section, "Renamed");
  assert.deepEqual(f.flags, []);
  assert.deepEqual(f.effects.at(-1), ["update-views", 15, 91, { section_title: "Renamed" }]);
});

test("the normal column-header and Ctrl+K entry points reuse ManageColumns, without a separate destination picker", () => {
  assert.match(read("src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx"), /setShowCommands\(\{ show: true, mode: CommandMode\.ManageColumn \}\)/);
  assert.match(read("src/components/commandModalPanels2.tsx"), /commandMode === CommandMode\.ManageColumn \|\|\s*commandMode === CommandMode\.DeleteColumn \|\|\s*commandMode === CommandMode\.RenameColumn\) && \(\s*<ManageColumns/);
  assert.match(read("src/components/Modals/commands/HTC/AllCommands.ts"), /name: "Delete board column",\s*commandMode: CommandMode\.DeleteColumn/);
});
