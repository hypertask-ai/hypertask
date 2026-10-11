const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { load } = require("./helpers/create-view-context.cjs");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-6993-quick-add-view-context";
const emptyFilters = { addedFilters: [], matchFilters: "ALL" };
const constants = load("src/lib/constants/constants.ts", {
  "../configs/general.config": { generalConfig: {} },
  "@/lib/aiModelOptions": { aiModelOptions: [], defaultAiModelOption: {} },
});
const labels = [{ id: "11111111-1111-4111-8111-111111111111", value: "Urgent" }, { id: "22222222-2222-4222-8222-222222222222", value: "Phone" }];
const assignees = [{ id: 42, uid: "human-42", displayName: "Member", photoURL: "member.png" }, { id: "33333333-3333-4333-8333-333333333333", displayName: "Agent", photoURL: "agent.png", userId: 42, revokedAt: null }];
const priority = constants.PriorityConstants.find(value => value.priority_index === 2);
const estimate = constants.EstimateConstants.find(value => value.estimate_index === 4);
const filters = (entries) => ({ matchFilters: "ALL", addedFilters: Object.entries(entries).map(([type, searchPayload]) => ({ type, searchPayload, match: "ALL" })) });

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
const defaults = load("src/utils/helperFunctions/Views/NewTaskViewDefaults.ts", { "@/lib/constants/constants": constants });
const { splitAssignees } = load("src/lib/assignees.ts", {});
const conditions = load("src/utils/helperFunctions/Views/FilterHelperFunctions.ts", {
  "@/utils/helperFunctions/helperFunctions": {},
  "./ViewsHelperFunctions": viewHelpers,
  "@/lib/staleness": {},
  "@/lib/constants/builtinViews": {},
});

async function create({ activeFilters = emptyFilters, flag = true, position = "bottom", view = "appliedView", fail = false, existing = true, sorting = "Manual" } = {}) {
  const project = {
    id: 15, uniqueIdentifier: "HTPR", sorting_mode: sorting, sections: [{ sectionId: 7 }],
    project_view: { user_project_views: [{ [view]: { board_filters: activeFilters } }] },
  };
  if (view === null) delete project.project_view;
  const previousTask = { id: 100, ranking: "a" };
  const sections = [{ sectionId: 7, items: existing ? [previousTask] : [] }];
  const allData = { updatedProjects: [{ ...project, sections }] };
  const posts = [];
  const cached = new Map();
  let inserted;
  let selected;
  const hook = load("src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx", {
    "@/store": { currentProjectAtom: "project", currentUserAtom: "user", activeSectionAtom: "section" },
    "@tanstack/react-query": { useQueryClient: () => ({ setQueryData: (key, value) => cached.set(JSON.stringify(key), value), invalidateQueries: () => assert.fail("must not need a reload") }) },
    "@/lib/state": { useRecoilValue: (atom) => atom === "project" ? project : { id: 6 } },
    "jotai": { useStore: () => ({ get: () => 0 }) },
    "@/utils/generateRank": { default: (before, after) => { assert.equal(before, position === "bottom" && existing ? "a" : undefined); assert.equal(after, position === "top" && existing ? "a" : undefined); return "rank-new"; } },
    "axios": { default: { post: async (url, body) => { posts.push({ url, body }); return { status: 200, data: { ...body, id: 101, taskLabels: [] } }; } } },
    "./useUpdateTaskInBoards": { default: () => ({
      getProjectIdxAndAllData: async () => ({ allData, projectToUpdateIndex: 0 }),
      mutationHandler: (index, next) => { assert.equal(index, 0); inserted = next[0].items; },
      updateActiveItemAndItemInView: (id) => { selected = id; },
    }) },
    "@/utils/helperFunctions/helperFunctions": {},
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flagKey); return flag; } },
    "@/lib/flags/keys": { HTPR_6993_QUICK_ADD_VIEW_CONTEXT_FLAG: flagKey },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": viewHelpers,
    "@/utils/helperFunctions/Views/NewTaskViewDefaults": defaults,
    "@/lib/constants/constants": constants,
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async (body) => {
      posts.push({ url: "modal-create", body });
      if (fail) return { error: true };
      const newTask = {
        ...body, id: 101, section: body.section_title,
        taskLabels: (body.tags ?? []).map(label => ({ label })),
      };
      delete newTask.assignees;
      return { error: false, resposne: { newTask } };
    } },
  }).default();
  const originalLog = console.log;
  console.log = () => {};
  let success;
  try {
    success = await hook.createItem({ sectionId: 7, section: "Bugs", item: { title: "Quick ticket", description: "", id: -1 }, position, createAnother: true, projectId: 15 });
  } finally { console.log = originalLog; }
  return { success, posts, cached, inserted, selected };
}

test("label-filter quick add inserts a matching card with labels immediately at either end", async () => {
  for (const position of ["top", "bottom"]) for (const existing of [true, false]) {
    const result = await create({ activeFilters: filters({ Labels: labels }), position, existing });
    assert.equal(result.success, true);
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].url, "modal-create");
    assert.deepEqual(result.posts[0].body.tags, labels);
    const card = position === "top" ? result.inserted[0] : result.inserted.at(-1);
    assert.equal(card.id, 101);
    assert.equal(card.projectId, 15);
    assert.equal(card.sectionId, 7);
    assert.equal(card.section, "Bugs");
    assert.equal(card.ranking, "rank-new");
    assert.equal(conditions.labelFilterCondition(card, labels, undefined, "ALL"), true);
    assert.deepEqual(result.cached.get('["taskLabels",101]'), card.taskLabels);
    assert.equal(result.selected, null);
  }
});

test("assignee filter assigns humans and agents and satisfies the real ALL predicate", async () => {
  const result = await create({ activeFilters: filters({ Labels: labels, Assignees: assignees, Priority: [priority], Size: [estimate] }) });
  assert.equal(result.success, true);
  assert.deepEqual(result.posts[0].body.assignees, assignees);
  const card = result.inserted.at(-1);
  assert.equal(conditions.assigneeFilterCondition(card, assignees, undefined, "ALL"), true);
  assert.equal(conditions.labelFilterCondition(card, labels, undefined, "ALL"), true);
  assert.deepEqual(card.priority, priority);
  assert.deepEqual(card.estimate, estimate);
  assert.deepEqual(result.cached.get('["priority",101]'), priority);
  assert.deepEqual(result.cached.get('["estimate",101]'), estimate);
});

test("unsaved filters take precedence over the applied view", async () => {
  const result = await create({ activeFilters: filters({ Labels: labels }), view: "unsavedView" });
  assert.deepEqual(result.posts[0].body.tags, labels);
  assert.deepEqual(viewHelpers.getActiveFiltersFromProject({ project_view: { user_project_views: [{ unsavedView: { board_filters: filters({ Labels: labels }) }, appliedView: { board_filters: filters({ Labels: [{ id: "old" }] }) } }] } }).addedFilters[0].searchPayload, labels);
});

test("no view, no filters and unsupported filters preserve the exact legacy request", async () => {
  for (const options of [{ view: null }, {}, { activeFilters: filters({ CreatedBy: assignees, RunningTimer: [] }) }]) {
    const result = await create(options);
    assert.equal(result.success, true);
    assert.deepEqual(result.posts, [{ url: "/api/tasks/create", body: { title: "Quick ticket", description: "", id: -1, sectionId: 7, section: "Bugs", assignees: [], userId: 6, projectId: 15, ranking: "rank-new", index: 1 } }]);
    assert.equal(result.cached.size, 0);
  }
});

test("flag off preserves the exact legacy request even in a filtered view", async () => {
  const result = await create({ activeFilters: filters({ Labels: labels, Assignees: assignees, Priority: [priority], Size: [estimate] }), flag: false });
  assert.deepEqual(result.posts, [{ url: "/api/tasks/create", body: { title: "Quick ticket", description: "", id: -1, sectionId: 7, section: "Bugs", assignees: [], userId: 6, projectId: 15, ranking: "rank-new", index: 1 } }]);
  assert.equal(result.cached.size, 0);
});

test("label-only quick add inserts an empty assignee list without response assignments", async () => {
  const result = await create({ activeFilters: filters({ Labels: labels }) });
  assert.equal(result.success, true);
  assert.deepEqual(result.posts[0].body.assignees, []);
  assert.deepEqual(result.inserted.at(-1).assignees, []);
});

test("excluded-match filters contribute no defaults, while absent, ANY and ALL matches apply", async () => {
  for (const match of ["NONE", "is not", "NOT", null, ""]) {
    const activeFilters = filters({ Labels: labels, Assignees: assignees, Priority: [priority], Size: [estimate] });
    activeFilters.addedFilters.forEach(filter => { filter.match = match; });
    assert.deepEqual(defaults.getNewTaskViewDefaults(activeFilters), { tags: undefined, assignees: [], priority: undefined, estimate: undefined });
    const result = await create({ activeFilters });
    assert.equal(result.posts[0].url, "/api/tasks/create");
  }
  for (const match of [undefined, "ANY", "ALL"]) {
    const activeFilters = filters({ Labels: labels, Assignees: assignees, Priority: [priority], Size: [estimate] });
    activeFilters.addedFilters.forEach(filter => { filter.match = match; });
    assert.deepEqual(defaults.getNewTaskViewDefaults(activeFilters), { tags: labels, assignees, priority, estimate });
  }
});

test("sentinel values never reach the create API and do not resolve me placeholders", async () => {
  const sentinels = [null, "me", {}, { id: "me" }, { id: "current-user" }, { id: "unassigned" }, { id: "no-label" }, { id: "none" }, { id: "" }, { id: 0 }, { id: -1 }, { id: 0, uid: "none" }, { id: -1, uid: "me" }, { id: "6", uid: "me" }, { id: 1.5, uid: "invalid" }];
  const revokedAgent = { ...assignees[1], revokedAt: "2026-10-01" };
  const activeFilters = filters({
    Labels: [...sentinels, ...labels],
    Assignees: [...sentinels, revokedAgent, ...assignees],
    Priority: [...sentinels, { priority_index: 0 }, { priority_index: 99 }, { priority_index: "2" }, priority],
    Size: [...sentinels, { estimate_index: 0 }, { estimate_index: 1 }, { estimate_index: "4" }, estimate],
  });
  assert.deepEqual(defaults.getNewTaskViewDefaults(activeFilters), { tags: labels, assignees, priority, estimate });
  const result = await create({ activeFilters });
  const body = result.posts[0].body;
  assert.deepEqual(body.tags, labels);
  assert.deepEqual(body.assignees, assignees);
  assert.deepEqual(body.priority, priority);
  assert.deepEqual(body.estimate, estimate);
  const onlySentinels = await create({ activeFilters: filters({ Labels: sentinels, Assignees: sentinels, Priority: [{ priority_index: 0 }], Size: [{ estimate_index: 0 }] }) });
  assert.equal(onlySentinels.posts[0].url, "/api/tasks/create");
  assert.deepEqual(onlySentinels.posts[0].body.assignees, []);
  assert.equal(Object.hasOwn(onlySentinels.posts[0].body, "tags"), false);
  // AssignedToMe passes the actual currentUser object, and the condition only compares IDs.
  const me = { id: 6, uid: "human-6", displayName: "Me" };
  const assignedToMe = await create({ activeFilters: filters({ Assignees: [me] }) });
  assert.deepEqual(assignedToMe.posts[0].body.assignees, [me]);
  assert.equal(conditions.assigneeFilterCondition(assignedToMe.inserted.at(-1), [me]), true);
});

test("multi-label ANY applies every real label to the created card", async () => {
  const activeFilters = filters({ Labels: labels });
  activeFilters.addedFilters[0].match = "ANY";
  const result = await create({ activeFilters });
  assert.deepEqual(result.posts[0].body.tags, labels);
  assert.deepEqual(result.inserted.at(-1).taskLabels.map(row => row.label), labels);
  assert.equal(conditions.labelFilterCondition(result.inserted.at(-1), labels, undefined, "ANY"), true);
});

test("priority-top position preserves ranking and legacy Urgent unless a view priority is explicit", async () => {
  for (const sorting of ["Priority", "Manual"]) for (const position of ["top", "bottom"]) for (const existing of [true, false]) {
    const result = await create({ activeFilters: filters({ Labels: labels }), sorting, position, existing });
    const urgent = constants.PriorityConstants.find(value => value.priority_index === 1);
    const expectedPriority = sorting === "Priority" && position === "top" && existing ? urgent : undefined;
    assert.deepEqual(result.posts[0].body.priority, expectedPriority);
    const card = position === "top" ? result.inserted[0] : result.inserted.at(-1);
    assert.equal(card.id, 101);
    assert.equal(card.ranking, "rank-new");
    assert.deepEqual(card.priority, expectedPriority);
  }
  const explicit = await create({ activeFilters: filters({ Labels: labels, Priority: [priority] }), sorting: "Priority", position: "top" });
  assert.deepEqual(explicit.posts[0].body.priority, priority);
  const disabled = await create({ activeFilters: filters({ Labels: labels }), sorting: "Priority", position: "top", flag: false });
  assert.equal(disabled.posts[0].body.index, 0);
  assert.equal(disabled.posts[0].url, "/api/tasks/create");
  for (const file of ["src/pages/api/tasks/createGlobally.ts", "src/lib/api/task-writes/create-global.ts"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /const body = \{[\s\S]*?\branking,[\s\S]*?const task = await tx\.task\.create\(\{\s*data: \{\s*\.\.\.body,/);
    assert.match(source, /priority_index: priority\.priority_index/);
  }
});

test("client defaults render human and agent avatars without response assignments or counting the agent owner twice", async () => {
  for (const people of [[assignees[0]], [assignees[1]], assignees]) for (const position of ["top", "bottom"]) {
    const result = await create({ activeFilters: filters({ Assignees: people }), position });
    assert.equal(result.success, true);
    assert.deepEqual(result.posts[0].body.assignees, people);
    const card = position === "top" ? result.inserted[0] : result.inserted.at(-1);
    assert.deepEqual(card.assignees, people.map(person => "uid" in person
      ? { userId: person.id, user: person }
      : { userId: person.userId, agentId: person.id, agent: person }
    ));
    const rendered = splitAssignees(card.assignees);
    assert.deepEqual(rendered.humanAssignees, people.filter(person => "uid" in person));
    assert.deepEqual(rendered.agentAssignees, people.filter(person => !("uid" in person)));
    assert.equal(conditions.assigneeFilterCondition(card, people, undefined, "ALL"), true);
  }
});

test("modal stays tags-only with flag off preserving raw legacy defaults and board switches", () => {
  const source = fs.readFileSync(path.join(root, "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts"), "utf8");
  assert.match(source, /quickAddViewContextEnabled = useFlag\(HTPR_6993_QUICK_ADD_VIEW_CONTEXT_FLAG\)/);
  const parsed = ts.createSourceFile("modal.ts", source, ts.ScriptTarget.Latest, true);
  let expression;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "defaultFormValues") {
      expression = node.initializer.arguments[0].getText(parsed);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(expression);
  const switchExpression = source.match(/const tags = ([\s\S]*?);/)[1];
  const activeFilters = filters({ Labels: [{ id: "no-label" }, ...labels], Assignees: assignees, Priority: [priority], Size: [estimate] });
  const project = { project_view: { user_project_views: [{ appliedView: { board_filters: activeFilters } }] } };
  for (const flag of [false, true]) {
    const evaluate = new Function("createTaskModal", "_currentProject", "quickAddViewContextEnabled", "getNewTaskViewDefaults", "getActiveFiltersFromProject", "normalizeCreateTaskFormDate", ts.transpileModule(`const newTaskWindowViewContextEnabled = false; return (${expression})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
    const form = evaluate({}, project, flag, defaults.getNewTaskViewDefaults, viewHelpers.getActiveFiltersFromProject, value => value);
    const expectedTags = flag ? labels : activeFilters.addedFilters[0].searchPayload;
    assert.deepEqual(form.tags, expectedTags);
    assert.deepEqual(form.assignees, []);
    assert.equal(form.priority, undefined);
    assert.equal(form.estimate, undefined);
    const switchTags = new Function("project", "quickAddViewContextEnabled", "getNewTaskViewDefaults", "getActiveFiltersFromProject", `const newTaskWindowViewContextEnabled = false; const viewDefaults = getNewTaskViewDefaults(getActiveFiltersFromProject(project)); return (${switchExpression});`);
    assert.deepEqual(switchTags(project, flag, defaults.getNewTaskViewDefaults, viewHelpers.getActiveFiltersFromProject), expectedTags);
    const duplicate = { taskLabels: [{ label: labels[0] }], priority, estimate };
    const duplicateForm = evaluate({ duplicate }, project, flag, defaults.getNewTaskViewDefaults, viewHelpers.getActiveFiltersFromProject, value => value);
    assert.deepEqual(duplicateForm.tags, [labels[0]]);
    assert.deepEqual(duplicateForm.priority, priority);
    assert.deepEqual(duplicateForm.estimate, estimate);
  }
});

test("failed filtered creation neither inserts a card nor retries without labels", async () => {
  const result = await create({ activeFilters: filters({ Labels: labels }), fail: true });
  assert.equal(result.success, false);
  assert.equal(result.posts.length, 1);
  assert.equal(result.inserted, undefined);
  assert.equal(result.cached.size, 0);
});
