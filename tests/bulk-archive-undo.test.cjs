const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { QueryClient } = require("@tanstack/react-query");
const { refreshTaskDetailReadAfterWrite } = require("jiti")(__filename, { alias: { "@": path.resolve(__dirname, "../src") }, interopDefault: true })(path.resolve(__dirname, "../src/lib/taskDetailReads.ts"));
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const boardFile = "src/hooks/MultiPages/useUpdateTaskInBoards.tsx";
const bulkFile = "src/lib/contexts/Kanban/BulkSelectionContext.tsx";
const homepageFile = "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx";

function load(file, names, env) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && names.includes(node.name?.getText(source))) {
      declarations.set(node.name.getText(source), ts.isFunctionDeclaration(node) ? node.getText(source) : `const ${node.getText(source)};`);
    } else if (ts.isJsxAttribute(node) && names.includes(node.name.getText(source))) {
      declarations.set(node.name.getText(source), `const ${node.name.getText(source)} = ${node.initializer.expression.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(declarations.size, names.length, "every requested production declaration exists");
  const compiled = ts.transpileModule(names.map(name => declarations.get(name)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const bindings = Object.entries(env).filter(([name]) => !names.includes(name));
  return new Function("exports", ...bindings.map(([name]) => name), `${compiled}\nreturn {${names.join(",")}};`)({}, ...bindings.map(([, value]) => value));
}

function fixture(enabled = true, { archiveFailure, restoreFailure, subtasks = false } = {}) {
  const tasks = [1, 2].map(id => ({ id, projectId: 15, sectionId: id + 10, status: "Normal", subTasks: subtasks ? [{ id: id + 100 }] : [] }));
  const sections = tasks.map(task => ({ sectionId: task.sectionId, items: [task] }));
  const project = { id: 15, sections, filteredSections: sections, tasks };
  const store = new Map(tasks.map(task => [task.id, structuredClone(task)]));
  const undos = [], requests = [], reconciliations = [], messages = [];
  let selectedIds, failedIds;
  const env = {
    useCallback: fn => fn, isProcessing: false, selectedTasks: tasks,
    useFlag: key => { assert.equal(key, "htpr-7137-bulk-archive-undo-all"); return enabled; },
    HTPR_7137_BULK_ARCHIVE_UNDO_ALL_FLAG: "htpr-7137-bulk-archive-undo-all", refreshTaskDetailReadAfterWrite,
    _currentProject: project, _currentUser: { id: 985 },
    toast: Object.assign(() => {}, { dismiss() {}, success: text => messages.push(text), error: text => messages.push(text) }),
    queryClient: new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
    getProjectIdxAndAllData: async () => ({ allData: { updatedProjects: [project] }, projectToUpdateIndex: 0 }),
    returnSortedItems: items => items, reAdjustFocusFromCurrContext() {},
    mutationHandler: (_index, nextSections, _data, nextTasks) => { project.sections = nextSections; project.filteredSections = nextSections; project.tasks = nextTasks; },
    globalAPIHandlers: { archiveTask: async (id, status) => {
      requests.push([id, status]);
      if ((status === "Archive" && id === archiveFailure) || (status === "Normal" && id === restoreFailure)) throw new Error("Fixture API failure");
      store.get(id).status = status;
    } },
    performActionAndStoreUndoData: (data, text, handler) => undos.push({ data, text, handler }),
    undoAction: async (_mode, data) => env.globalAPIHandlers.archiveTask(data.id, "Normal"),
    reconcileActiveBoardTasks: async (_client, projectId, userId) => {
      reconciliations.push([projectId, userId]);
      project.tasks = [...store.values()].filter(task => task.status === "Normal").map(task => structuredClone(task));
      project.sections = sections.map(section => ({ ...section, items: project.tasks.filter(task => task.sectionId === section.sectionId) }));
    },
    router: { replace() {} },
    setIsProcessing() {}, setSelectedIds: ids => { selectedIds = ids; }, setFailedIds: ids => { failedIds = ids; },
    getBulkSourceSectionId: task => task.sectionId,
  };
  Object.assign(env, load(boardFile, ["undoHandler", "deleteTodo", "removeFromListWithStatus"], env));
  Object.assign(env, load(homepageFile, ["archiveTaskForBulk"], env));
  env.onArchiveTask = env.archiveTaskForBulk;
  env.registerArchiveUndo = env.deleteTodo;
  Object.assign(env, load(homepageFile, ["onArchiveUndo"], env));
  Object.assign(env, load(bulkFile, ["bulkArchiveUndoAll", "runTaskOperation"], env));
  Object.assign(env, load(bulkFile, ["archiveSelected"], env));
  return { ...env, tasks, store, project, undos, requests, reconciliations, messages,
    selection: () => ({ selectedIds, failedIds }),
    undo: async () => { const entry = undos.at(-1); assert.ok(entry, "archive exposes Undo"); await entry.handler(entry.data, "fixture-toast"); },
  };
}

for (const enabled of [true, false]) {
  test(`two-ticket bulk archive Undo ${enabled ? "restores both with one reconciliation" : "keeps today's one-ticket behavior with flag off"}`, async () => {
    const f = fixture(enabled);
    await f.archiveSelected();
    assert.deepEqual([...f.store.values()].map(task => task.status), ["Archive", "Archive"]);
    await f.undo();
    assert.deepEqual([...f.store.values()].map(task => task.status), enabled ? ["Normal", "Normal"] : ["Archive", "Normal"]);
    assert.equal(f.undos.length, enabled ? 1 : 2);
    assert.deepEqual(f.reconciliations, [[15, 985]]);
    assert.deepEqual(f.project.tasks.map(task => task.id), enabled ? [1, 2] : [2], "fresh board reads include every persisted restore");
    if (enabled) assert.deepEqual(f.project.sections.map(section => section.items.map(task => task.id)), [[1], [2]], "original columns are preserved");
  });

  test(`single archive Undo stays unchanged with flag ${enabled ? "on" : "off"}`, async () => {
    const f = fixture(enabled);
    assert.equal(await f.removeFromListWithStatus(11, 15, 1, "Archive", undefined, { undoRedirectPath: "/detail/project-15/1" }), true);
    assert.equal(f.undos.length, 1);
    assert.equal(f.undos[0].text, "Undo task archive");
    assert.deepEqual(f.undos[0].data, { id: 1, projectId: 15, status: "Archive", undoRedirectPath: "/detail/project-15/1" });
    await f.undo();
    assert.deepEqual(f.requests, [[1, "Archive"], [1, "Normal"]]);
    assert.deepEqual(f.reconciliations, [[15, 985]]);
  });
}

test("partial archive failure keeps failed selection and Undo restores only successful tickets", async () => {
  const f = fixture(true, { archiveFailure: 2 });
  await f.archiveSelected();
  assert.deepEqual([...f.selection().failedIds], [2]);
  assert.deepEqual([...f.selection().selectedIds], [2]);
  assert.equal(f.undos.length, 1);
  await f.undo();
  assert.deepEqual(f.requests.filter(([, status]) => status === "Normal"), [[1, "Normal"]]);
  assert.deepEqual([...f.store.values()].map(task => task.status), ["Normal", "Normal"]);
});

test("restore failure still attempts every ticket, reconciles once, and remains retryable", async () => {
  const f = fixture(true, { restoreFailure: 1 });
  await f.archiveSelected();
  await assert.rejects(f.undo(), /restore|Fixture API failure/i);
  assert.deepEqual(f.requests.filter(([, status]) => status === "Normal").map(([id]) => id).sort(), [1, 2]);
  assert.deepEqual(f.reconciliations, [[15, 985]]);
  f.globalAPIHandlers.archiveTask = async (id, status) => { f.requests.push([id, status]); f.store.get(id).status = status; };
  await f.undo();
  assert.deepEqual(f.requests.filter(([, status]) => status === "Normal"), [[1, "Normal"], [2, "Normal"], [1, "Normal"]], "retry only restores the failed ticket");
  assert.deepEqual([...f.store.values()].map(task => task.status), ["Normal", "Normal"]);
});

test("bulk archives with subtasks get one Undo while single parent archives retain their existing behavior", async () => {
  const f = fixture(true, { subtasks: true });
  await f.archiveSelected();
  assert.equal(f.undos.length, 1);
  await f.undo();
  assert.deepEqual([...f.store.values()].map(task => task.status), ["Normal", "Normal"]);
  const single = fixture(true, { subtasks: true });
  assert.equal(await single.removeFromListWithStatus(11, 15, 1, "Archive"), false);
  assert.equal(single.undos.length, 0);
});

test("ticket bugfix registry defaults to Everyone, respects Off and gates at the provider's top level", () => {
  const jiti = require("jiti")(__filename);
  const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, "src/lib/flags/definitions.ts"));
  const key = "htpr-7137-bulk-archive-undo-all";
  const definition = FEATURE_FLAG_DEFINITIONS.find(flag => flag.key === key);
  assert.ok(definition, "generated registry contains the ticket flag");
  assert.equal(definition.kind, "bugfix");
  assert.equal(Object.hasOwn(definition, "defaultMode"), false);
  assert.equal(definition.releaseRisk.risk, "small");
  const flags = load("src/lib/flags.ts", ["defaultFeatureFlagMode", "featureFlagModeEnabled"], {
    FEATURE_FLAG_DEFINITIONS, DEFAULT_BUGFIX_FLAG_MODE: "EVERYONE", DEFAULT_FEATURE_FLAG_MODE: "OWNER_AND_QA",
  });
  assert.equal(flags.defaultFeatureFlagMode(key), "EVERYONE");
  assert.equal(flags.featureFlagModeEnabled("EVERYONE", false, false), true);
  assert.equal(flags.featureFlagModeEnabled("OFF", true, true), false);
  const source = ts.createSourceFile(bulkFile, fs.readFileSync(path.join(root, bulkFile), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const provider = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "KanbanBulkSelectionProvider"));
  assert.ok(provider.declarationList.declarations[0].initializer.body.statements.some(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "bulkArchiveUndoAll")), "useFlag runs unconditionally at provider top level");
});
