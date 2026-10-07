const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-6993-quick-add-view-context";
const emptyFilters = { addedFilters: [], matchFilters: "ALL" };
const labels = [{ id: "label-a", value: "Urgent" }, { id: "label-b", value: "Phone" }];
const assignees = [{ id: 42, uid: "human-42", displayName: "Member" }, { id: "agent-a", displayName: "Agent" }];
const priority = { priority_index: 2, Priority_Value: "High" };
const estimate = { estimate_index: 2, Estimate_Value: "M" };
const filters = (entries) => ({ matchFilters: "ALL", addedFilters: Object.entries(entries).map(([type, searchPayload]) => ({ type, searchPayload, match: "ALL" })) });

function load(file, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (specifier) => Object.hasOwn(mocks, specifier) ? { __esModule: true, ...mocks[specifier] } : require(specifier),
    loaded, loaded.exports,
  );
  return loaded.exports;
}

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
const defaults = load("src/utils/helperFunctions/Views/NewTaskViewDefaults.ts", {});
const conditions = load("src/utils/helperFunctions/Views/FilterHelperFunctions.ts", {
  "@/utils/helperFunctions/helperFunctions": {},
  "./ViewsHelperFunctions": viewHelpers,
  "@/lib/staleness": {},
  "@/lib/constants/builtinViews": {},
});

async function create({ activeFilters = emptyFilters, flag = true, position = "bottom", view = "appliedView", fail = false, existing = true } = {}) {
  const project = {
    id: 15, uniqueIdentifier: "HTPR", sections: [{ sectionId: 7 }],
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
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async (body) => {
      posts.push({ url: "modal-create", body });
      if (fail) return { error: true };
      return { error: false, resposne: { newTask: {
        ...body, id: 101, section: body.section_title,
        taskLabels: (body.tags ?? []).map(label => ({ label })),
        assignees: body.assignees.map(person => "uid" in person ? { userId: person.id, user: person } : { agentId: person.id, agent: person }),
      } } };
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

test("both modal creation routes return committed assignments for immediate filter visibility", () => {
  for (const file of ["src/pages/api/tasks/createGlobally.ts", "src/lib/api/task-writes/create-global.ts"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /assignmentsCreated = created\.result\.assignments/);
    assert.match(source, /newTask: \{[\s\S]*taskLabels: tagsCreated,\s*assignees: assignmentsCreated,/);
  }
});

test("failed filtered creation neither inserts a card nor retries without labels", async () => {
  const result = await create({ activeFilters: filters({ Labels: labels }), fail: true });
  assert.equal(result.success, false);
  assert.equal(result.posts.length, 1);
  assert.equal(result.inserted, undefined);
  assert.equal(result.cached.size, 0);
});
