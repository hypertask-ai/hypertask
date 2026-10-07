const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const hookPath = "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts";
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const source = ts.createSourceFile(hookPath, read(hookPath), ts.ScriptTarget.Latest, true);
const flagKey = "htpr-6997-new-task-window-view-context";
const emptyFilters = { addedFilters: [], matchFilters: "ALL" };

function load(file, mocks) {
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    specifier => Object.hasOwn(mocks, specifier) ? { __esModule: true, ...mocks[specifier] } : require(specifier),
    loaded, loaded.exports,
  );
  return loaded.exports;
}

function initializer(file, name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) result = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(result, `${name} must exist`);
  return result;
}

function evaluate(expression, context) {
  const compiled = ts.transpileModule(`return (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(context), compiled)(...Object.values(context));
}

const constants = load("src/lib/constants/constants.ts", {
  "../configs/general.config": { generalConfig: {} },
  "@/lib/aiModelOptions": { aiModelOptions: [], defaultAiModelOption: {} },
});
const viewHelpers = load("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts", {
  "@/lib/firstScreen/boardView": {},
  "@/models/Views/model": {},
  "@/utils/helperFunctions/helperFunctions": { deepCopy: structuredClone },
  "./FilterHelperFunctions": { defaultFilterSettings: emptyFilters },
  "@/utils/sortByParam": {},
  "./TableColumnsHelperFunctions": {},
  "./SubtaskHelperFunction": {},
  "./EmptySectionsHelperFunction": {},
  "@/lib/sectionAutoAssign": {},
});
const { getNewTaskViewDefaults } = load("src/utils/helperFunctions/Views/NewTaskViewDefaults.ts", {
  "@/lib/constants/constants": constants,
});
const labels = [{ id: "11111111-1111-4111-8111-111111111111", value: "Urgent" }];
const assignees = [
  { id: 42, uid: "human-42", displayName: "Member", photoURL: "member.png" },
  { id: "33333333-3333-4333-8333-333333333333", displayName: "Agent", userId: 42, revokedAt: null },
];
const priority = constants.PriorityConstants.find(value => value.priority_index === 2);
const estimate = constants.EstimateConstants.find(value => value.estimate_index === 4);
const filters = entries => ({ matchFilters: "ALL", addedFilters: Object.entries(entries).map(([type, searchPayload]) => ({ type, searchPayload, match: "ALL" })) });
const allFilters = () => filters({ Labels: labels, Assignees: assignees, Priority: [priority], Size: [estimate] });
const project = (activeFilters = allFilters(), id = 15) => ({ id, project_view: { user_project_views: [{ appliedView: { board_filters: activeFilters } }] } });

function modal({ flag = true, quickFlag = true, board = project(), payload, duplicate } = {}) {
  let helperCalls = 0;
  const context = {
    createTaskModal: { column_payload: payload, duplicate },
    _currentProject: board,
    quickAddViewContextEnabled: quickFlag,
    newTaskWindowViewContextEnabled: flag,
    getActiveFiltersFromProject: viewHelpers.getActiveFiltersFromProject,
    getNewTaskViewDefaults: activeFilters => { helperCalls++; return getNewTaskViewDefaults(activeFilters); },
    normalizeCreateTaskFormDate: value => value,
  };
  const form = evaluate(initializer(source, "defaultFormValues").arguments[0].getText(source), context)();
  const formValuesRef = { current: form };
  const editedViewFieldsRef = { current: {} };
  const switchContext = {
    ...context, formValuesRef, editedViewFieldsRef,
    saveEpochRef: { current: 0 }, setIsGeneratingTitle() {},
    generatedTitleTrackerRef: { current: { reset() {} } },
    autoTitleCoordinator: { boardChanged: () => false, manualTitleChanged() {} },
    pathname: "/kanban", router: { replace() {} }, localStorage: { setItem() {} },
    setFormValues: next => { formValuesRef.current = typeof next === "function" ? next(formValuesRef.current) : next; },
  };
  return {
    get form() { return formValuesRef.current; },
    get helperCalls() { return helperCalls; },
    change: evaluate(initializer(source, "handleChange").getText(source), switchContext),
    switchBoard: evaluate(initializer(source, "handleProjectChange").getText(source), switchContext),
  };
}

for (const [name, entries, field, expected] of [
  ["assignees", { Assignees: assignees }, "assignees", assignees],
  ["priority", { Priority: [priority] }, "priority", priority],
  ["size", { Size: [estimate] }, "estimate", estimate],
]) {
  test(`flag on prefills ${name} using the modal state shape`, () => {
    const result = modal({ board: project(filters(entries)) });
    assert.deepEqual(result.form[field], expected);
    assert.equal(result.helperCalls, 1);
  });
}

test("all view defaults share one helper call independently of the quick-add flag", () => {
  for (const quickFlag of [false, true]) {
    const result = modal({ quickFlag });
    assert.deepEqual([result.form.tags, result.form.assignees, result.form.priority, result.form.estimate], [labels, assignees, priority, estimate]);
    assert.equal(result.helperCalls, 1);
  }
});

test("prefilled picker values reach the existing create payload unchanged", async () => {
  const form = modal().form;
  let payload;
  const create = evaluate(initializer(source, "CreateNewTask").arguments[0].getText(source), {
    formValues: form, currentUser: { id: 6 }, parentTaskInfo: undefined, createTaskFromComment: undefined,
    createNewTaskGloballyAPIHandler: async body => { payload = body; return { error: false, resposne: { newTask: { id: 101 } } }; },
  });
  assert.deepEqual(await create({ description: "<p>Ticket</p>", urlsToAdd: [], relationsToAdd: [] }), { id: 101 });
  assert.deepEqual([payload.tags, payload.assignees, payload.priority, payload.estimate], [labels, assignees, priority, estimate]);
});

test("a caller priority overrides only priority, leaving other view defaults available", () => {
  const callerPriority = constants.PriorityConstants[1];
  const form = modal({ payload: { priority: callerPriority } }).form;
  assert.deepEqual([form.assignees, form.priority, form.estimate], [assignees, callerPriority, estimate]);
});

test("excluded matches and placeholder-only filters do not prefill fields", () => {
  for (const match of ["NONE", "NOT", "is not", null, ""]) {
    const active = allFilters();
    active.addedFilters.forEach(filter => { filter.match = match; });
    const form = modal({ board: project(active) }).form;
    assert.deepEqual([form.tags, form.assignees, form.priority, form.estimate], [undefined, [], undefined, undefined]);
  }
  const active = filters({ Labels: [{ id: "no-label" }], Assignees: [{ id: "me" }, { id: 0, uid: "none" }, { ...assignees[1], revokedAt: "2026-10-01" }], Priority: [{ priority_index: 0 }], Size: [{ estimate_index: 0 }, { estimate_index: 1 }] });
  const form = modal({ board: project(active) }).form;
  assert.deepEqual([form.tags, form.assignees, form.priority, form.estimate], [[], [], undefined, undefined]);
});

test("explicit caller values including empty selections win initially and during board resolution", () => {
  for (const payload of [
    { assignees: [assignees[0]], priority: constants.PriorityConstants[1], estimate: constants.EstimateConstants.at(-1) },
    { assignees: [], priority: constants.PriorityConstants[0], estimate: constants.EstimateConstants[0] },
  ]) {
    const result = modal({ payload });
    for (const field of ["assignees", "priority", "estimate"]) assert.deepEqual(result.form[field], payload[field]);
    result.switchBoard(project());
    for (const field of ["assignees", "priority", "estimate"]) assert.deepEqual(result.form[field], payload[field]);
  }
});

test("duplicate values win over caller and view defaults", () => {
  const duplicate = { title: "Copy", taskLabels: [{ label: labels[0] }], assignees: [{ user: assignees[0] }, { agent: assignees[1] }], priority: constants.PriorityConstants[1], estimate: constants.EstimateConstants.at(-1) };
  const result = modal({ duplicate, payload: { priority, estimate, assignees: [] } });
  assert.deepEqual(result.form.assignees, assignees);
  assert.deepEqual(result.form.priority, duplicate.priority);
  assert.deepEqual(result.form.estimate, duplicate.estimate);
});

test("user values and deliberate clearing survive later board defaults", () => {
  for (const values of [
    { assignees: [assignees[0]], priority: constants.PriorityConstants[1], estimate: constants.EstimateConstants.at(-1) },
    { assignees: [], priority: undefined, estimate: undefined },
  ]) {
    const result = modal({ board: { id: 15 } });
    for (const [field, value] of Object.entries(values)) result.change(field, value);
    result.switchBoard(project());
    for (const [field, value] of Object.entries(values)) assert.deepEqual(result.form[field], value);
  }
});

test("caller board resolution fills defaults from the target view, not the current board", () => {
  const result = modal({ board: project(), payload: { projectId: 16 } });
  assert.deepEqual([result.form.assignees, result.form.priority, result.form.estimate], [[], undefined, undefined]);
  const calls = result.helperCalls;
  result.switchBoard(project(allFilters(), 16));
  assert.deepEqual([result.form.tags, result.form.assignees, result.form.priority, result.form.estimate], [labels, assignees, priority, estimate]);
  assert.equal(result.helperCalls - calls, 1);
});

test("flag off matches the production form and board-switch behavior byte for byte", () => {
  for (const quickFlag of [false, true]) {
    const rawLabels = [{ id: "no-label" }, ...labels];
    const board = project(filters({ Labels: rawLabels, Assignees: assignees, Priority: [priority], Size: [estimate] }));
    const payload = { priority, estimate, assignees };
    const result = modal({ flag: false, quickFlag, board, payload });
    const expected = {
      title: "", description: "<p></p>", assignees: [], attachments: [], status: payload,
      priority, estimate: undefined, dueDate: undefined, startDate: undefined,
      tags: quickFlag ? labels : rawLabels, currentProject: board,
    };
    assert.deepEqual(result.form, expected);
    assert.equal(JSON.stringify(result.form), JSON.stringify(expected));
    result.switchBoard(board);
    expected.status = undefined;
    assert.deepEqual(result.form, expected);
    assert.equal(JSON.stringify(result.form), JSON.stringify(expected));
  }
});

test("no view stays unchanged with the flag on", () => {
  for (const board of [null, { id: 15 }, project(emptyFilters)]) {
    const on = modal({ board }).form;
    const off = modal({ board, flag: false }).form;
    assert.deepEqual(on, off);
  }
});

test("C and Ctrl+J route through the same global modal with only edit focus differing", () => {
  const sections = ts.createSourceFile("sections.ts", read("src/hooks/Homepage/useSections.ts"), ts.ScriptTarget.Latest, true);
  const createTaskAt = initializer(sections, "createTaskAt").getText(sections);
  const calls = [];
  const open = evaluate(createTaskAt, { isMbl: false, aiFirstTaskWriterEnabled: false, quickEntryCardsEnabled: true, toggleCreateTaskGlobally: (...args) => calls.push(args) });
  const context = { e: { preventDefault() {} }, sectionId: 7, title: "Bugs", createTaskAt: open, setKeypressed: callback => callback({}) };
  let shortcuts = 0;
  function visit(node) {
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(sections);
      if ((condition.includes("e.keyCode === KeyCodes.C") && condition.includes("!(e.altKey || e.shiftKey || e.ctrlKey || e.metaKey)")) || condition.includes("e.keyCode === KeyCodes.J")) {
        evaluate(`() => ${node.thenStatement.getText(sections)}`, context)();
        shortcuts++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sections);
  assert.equal(shortcuts, 2);
  assert.deepEqual(calls[0][0], calls[1][0]);
  assert.equal(calls[0][1], undefined);
  assert.deepEqual(calls[1][1], { defaultEditMode: "Description-ai", defaultFocus: "Description" });
  for (const [payload] of calls) assert.deepEqual(modal({ payload }).form.assignees, assignees);
  assert.match(read(hookPath), /newTaskWindowViewContextEnabled = useFlag\(HTPR_6997_NEW_TASK_WINDOW_VIEW_CONTEXT_FLAG\)/);
  assert.equal(flagKey, "htpr-6997-new-task-window-view-context");
});
