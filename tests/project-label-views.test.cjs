const test = require("node:test");
const assert = require("node:assert/strict");
const { AsyncLocalStorage } = require("node:async_hooks");
const { createRefactoredModuleRequire } = require("./refactored-module-require.cjs");
const { matches } = require("./helpers/htpr-7166-fixture.cjs");

const load = createRefactoredModuleRequire(__dirname, {});
const smartSplits = load("../src/lib/smartSplits.ts");
const helpers = load("../src/lib/projectLabelViews.ts");
const { buildSmartSplitBoardFilters } = smartSplits;
const { getProjectLabelView, isProjectLabelView, matchesProjectLabelFilters, replaceProjectLabelInBoardFilters } = helpers;
const source = { id: "source", value: "Old project", projectId: 15, ai_prompt: null };
const target = { id: "target", value: "Destination", projectId: 15, ai_prompt: null };
const defaults = {
  board_sorting_mode: "Priority",
  board_sorting_order: "Ascending",
  board_sorting_stack: [{ mode: "CreatedAt", order: "Descending" }],
  board_columns_view: [{ id: 3, section_title: "Doing" }],
  board_subtask_setting: "Flattened_Card",
  board_empty_sections: "Hide",
  board_empty_sections_staged: true,
  board_staleness: true,
  board_show_archived: false,
  table_sort_column: "title",
  table_sort_direction: "asc",
  board_layout: "Table",
};
const view = (label, overrides = {}) => ({
  id: label.id,
  title: label.value,
  slug: `bookmark-${label.id}`,
  userId: 99,
  visibility: "Public",
  project_view_id: "container",
  project_view: { projectId: 15 },
  unsaved_User_Project_View: [],
  board_filters: buildSmartSplitBoardFilters(label),
  ...overrides,
});

const contexts = new AsyncLocalStorage();
const mocks = {
  "@/lib/prisma": { __esModule: true, default: new Proxy({}, {
    get: (_object, property) => contexts.getStore().db[property],
  }) },
  "@/lib/smartSplits": smartSplits,
  "@/lib/projectLabelViews": helpers,
  "@/lib/auth/getSessionUser": { getSessionUser: async () => contexts.getStore().options.anonymous ? null : { userId: 42 } },
  "@/lib/mcp/tasks/services": {
    validateProjectMemberIds: async () => ({ invalidIds: contexts.getStore().options.forbidden ? [42] : [] }),
  },
  "@/lib/realtime/server": { broadcastBoardChange: () => contexts.getStore().events.push("broadcast") },
  "@/lib/ai/labelClassifier": { scheduleBackfillAiLabel: () => contexts.getStore().events.push("backfill") },
};
const routeLoad = createRefactoredModuleRequire(__dirname, mocks);
mocks["@/utils/controllers/projects/views/boardFilterWriteLock"] = routeLoad("../src/utils/controllers/projects/views/boardFilterWriteLock.ts");
const handler = routeLoad("../src/pages/api/labels/updateLabel.ts").default;

const fixture = (options = {}) => {
  const state = {
    labels: structuredClone(options.labels ?? [source, target]),
    views: structuredClone(options.views ?? []),
    assignments: structuredClone(options.assignments ?? []),
  };
  const writes = [];
  const events = [];
  let locked = false;
  let transactionTail = Promise.resolve();
  const write = (kind, operation) => async (query) => {
    assert.equal(locked, true, `${kind} must hold the board filter lock`);
    writes.push({ kind, query: structuredClone(query) });
    events.push(kind);
    if (options.failWrite === kind) throw new Error("write failed");
    return operation(query);
  };
  const readOne = (rows) => async ({ where }) => structuredClone(rows().find((row) => matches(row, where)) ?? null);
  const db = {
    $queryRaw: async (query) => {
      if (query.strings.join("").includes('FROM "Label"')) {
        assert.match(query.strings.join(""), /FOR UPDATE/);
        assert.deepEqual(query.values, [source.id]);
        events.push("source-label-lock");
        return [{ id: source.id }];
      }
      locked = true;
      events.push("lock");
      if (options.onLock) options.onLock(state);
      return [{ id: "container" }];
    },
    label: {
      findUnique: readOne(() => state.labels),
      findMany: async ({ where }) => state.labels.filter((row) => matches(row, where)),
      update: write("label.update", ({ where, data }) => {
        const label = state.labels.find((row) => row.id === where.id);
        Object.assign(label, data);
        return { ...label };
      }),
      delete: write("label.delete", ({ where }) => {
        const label = state.labels.find((row) => row.id === where.id);
        state.labels = state.labels.filter((row) => row.id !== where.id);
        return label;
      }),
    },
    view: {
      findUnique: readOne(() => state.views),
      findFirst: readOne(() => state.views),
      findMany: async ({ where }) => {
        assert.equal(locked, true);
        events.push("views.read");
        return structuredClone(state.views.filter((row) => matches(row, where)));
      },
      create: write("view.create", ({ data }) => {
        assert.equal(state.views.some((row) => row.id === data.id), false);
        const created = { ...data, project_view: { projectId: 15 }, unsaved_User_Project_View: [] };
        state.views.push(created);
        return created;
      }),
      update: write("view.update", ({ where, data }) => {
        const saved = state.views.find((row) => row.id === where.id);
        Object.assign(saved, data);
        return saved;
      }),
    },
    project_View: {
      findUnique: async () => options.noDefault ? null : { id: "container", default_view: defaults },
    },
    myTasksView: {
      findFirst: async () => options.personalReference ? { id: 1 } : null,
    },
    taskLabel: {
      findMany: async ({ where }) => {
        events.push("assignments.read");
        assert.ok(events.includes("source-label-lock"));
        return state.assignments.filter((row) => matches(row, where));
      },
      createMany: write("taskLabel.createMany", ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true);
        for (const item of data) {
          if (!state.assignments.some((row) => row.taskId === item.taskId && row.labelId === item.labelId)) {
            state.assignments.push(item);
          }
        }
      }),
      deleteMany: write("taskLabel.deleteMany", ({ where }) => {
        state.assignments = state.assignments.filter((row) => !matches(row, where));
      }),
    },
    $transaction: (operation) => {
      const result = transactionTail.then(async () => {
        const before = structuredClone(state);
        try {
          return await operation(db);
        } catch (error) {
          Object.assign(state, before);
          throw error;
        } finally {
          locked = false;
        }
      });
      transactionTail = result.catch(() => {});
      return result;
    },
  };
  const request = async (body = {}, method = "POST") => {
    const result = {};
    const res = {
      status(code) { result.status = code; return this; },
      json(value) { result.body = value; return this; },
    };
    await contexts.run({ db, options, events }, () => handler({ method, headers: {}, query: { labelId: body.labelId ?? source.id }, body: { labelId: source.id, value: source.value, ...body } }, res));
    return result;
  };
  return { state, writes, events, request };
};

test("canonical matching accepts one public saved label filter only", () => {
  assert.equal(matchesProjectLabelFilters(buildSmartSplitBoardFilters(source), source.id), true);
  assert.equal(isProjectLabelView(view(source), source), true);
  assert.equal(isProjectLabelView(view(source, { id: "reused" }), source), true);
  assert.equal(getProjectLabelView([view(source, { id: "reused" }), view(source)], source).id, source.id);
  for (const candidate of [
    view(source, { visibility: "Private" }),
    view(source, { unsaved_User_Project_View: [{ id: "draft" }] }),
    view(source, { id: "unrelated", title: "Other" }),
    view(target),
    view(source, { board_filters: { ...buildSmartSplitBoardFilters(source), matchFilters: "ANY" } }),
    view(source, { board_filters: { matchFilters: "ALL", addedFilters: [] } }),
    view(source, { board_filters: { matchFilters: "ALL", addedFilters: [...buildSmartSplitBoardFilters(source).addedFilters, { type: "Priority", searchPayload: [{ id: 1 }] }] } }),
  ]) assert.equal(isProjectLabelView(candidate, source), false);
  for (const malformed of [null, [], {}, { matchFilters: "ALL", addedFilters: [null] }]) {
    assert.equal(matchesProjectLabelFilters(malformed, source.id), false);
  }
});

test("filter rename and merge keep modes, constraints, metadata and input untouched", () => {
  for (const matchFilters of ["ALL", "ANY"]) {
    for (const match of ["ALL", "ANY"]) {
      const filters = {
        matchFilters,
        extraSetting: "preserve",
        addedFilters: [
          { type: "Labels", match, extra: 9, searchPayload: [{ id: source.id, value: source.value, custom: true }, target, { id: "third", value: "Other" }] },
          { type: "Labels", match: "ANY", searchPayload: [{ id: source.id, value: source.value }] },
          { type: "Priority", searchPayload: [{ id: 1 }] },
        ],
      };
      const original = structuredClone(filters);
      const merged = replaceProjectLabelInBoardFilters(filters, source.id, target);
      assert.equal(merged.matchFilters, matchFilters);
      assert.equal(merged.extraSetting, "preserve");
      assert.equal(merged.addedFilters[0].match, match);
      assert.equal(merged.addedFilters[0].extra, 9);
      assert.deepEqual(merged.addedFilters[0].searchPayload.map((item) => item.id), [target.id, "third"]);
      assert.equal(merged.addedFilters[0].searchPayload[0].custom, true);
      assert.deepEqual(merged.addedFilters[1].searchPayload, [{ id: target.id, value: target.value }]);
      assert.equal(merged.addedFilters.length, 3);
      assert.deepEqual(merged.addedFilters[2], filters.addedFilters[2]);
      assert.deepEqual(filters, original);
      const renamed = replaceProjectLabelInBoardFilters(filters, source.id, { ...source, value: "Renamed" });
      assert.equal(renamed.addedFilters[0].searchPayload[0].value, "Renamed");
      assert.equal(renamed.addedFilters[1].searchPayload[0].value, "Renamed");
      assert.equal(replaceProjectLabelInBoardFilters(filters, "absent", target), filters);
    }
  }
});

test("promotion creates one canonical same-id public view inheriting defaults and a unique slug", async () => {
  const f = fixture({ views: [view(target, { slug: "old-project" })] });
  const result = await f.request({ projectView: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.id, source.id);
  assert.equal(result.body.projectViewId, source.id);
  const saved = f.state.views.find((row) => row.id === source.id);
  assert.equal(saved.visibility, "Public");
  assert.equal(saved.userId, 42);
  assert.equal(saved.slug, "old-project-2");
  assert.deepEqual(saved.board_filters, buildSmartSplitBoardFilters(source));
  for (const [key, expected] of Object.entries(defaults)) assert.deepEqual(saved[key], expected);
  assert.equal(f.events[0], "lock");
  assert.equal((await f.request({ projectView: true })).body.projectViewId, source.id);
  assert.equal(f.writes.filter((row) => row.kind === "view.create").length, 1);
});

test("concurrent repeated promotions converge to one public view", async () => {
  const f = fixture();
  const results = await Promise.all([f.request({ projectView: true }), f.request({ projectView: true })]);
  assert.deepEqual(results.map((row) => row.status), [200, 200]);
  assert.equal(f.state.views.length, 1);
  assert.equal(f.writes.filter((row) => row.kind === "view.create").length, 1);
});

test("promotion reuses canonical differently-id public view and keeps its bookmark", async () => {
  const existing = view(source, { id: "existing-public", slug: "old-bookmark" });
  const f = fixture({ views: [existing] });
  const result = await f.request({ projectView: true });
  assert.equal(result.body.projectViewId, existing.id);
  assert.equal(f.state.views.length, 1);
  assert.equal(f.state.views[0].slug, "old-bookmark");
  assert.equal(f.writes.some((row) => row.kind === "view.create"), false);
});

for (const id of [source.id, "reused-view"]) {
  test(`rename follows ${id} designation without changing view id or slug`, async () => {
    const saved = view(source, { id });
    const ownPrivate = view(source, { id: "own-private", userId: 42, visibility: "Private", title: "My queue" });
    const f = fixture({ views: [saved, ownPrivate] });
    const result = await f.request({ value: "Renamed" });
    assert.equal(result.status, 200);
    assert.equal(result.body.projectViewId, id);
    assert.equal(f.state.views[0].title, "Renamed");
    assert.equal(f.state.views[0].id, id);
    assert.equal(f.state.views[0].slug, saved.slug);
    assert.equal(f.state.views[1].title, "My queue");
    assert.equal(f.state.views[1].board_filters.addedFilters[0].searchPayload[0].value, "Renamed");
    assert.equal(isProjectLabelView(f.state.views[0], result.body), true);
  });
}

for (const projectViewKind of ["none", "target", "source", "reused-source", "both"]) {
  test(`merge preserves assignments, filters and bookmarks with ${projectViewKind} projects`, async () => {
    const sourceProject = view(source, { id: projectViewKind === "reused-source" ? "legacy-source" : source.id });
    const targetProject = view(target);
    const mixed = view(source, { id: "mixed", title: "Constrained", board_filters: {
      matchFilters: "ANY",
      addedFilters: [
        { type: "Labels", match: "ALL", searchPayload: [source, target] },
        { type: "Priority", searchPayload: [{ id: 1 }] },
      ],
    } });
    const views = [mixed];
    if (["source", "reused-source", "both"].includes(projectViewKind)) views.push(sourceProject);
    if (["target", "both"].includes(projectViewKind)) views.push(targetProject);
    const f = fixture({ views, assignments: [
      { taskId: 1, labelId: source.id },
      { taskId: 1, labelId: target.id },
      { taskId: 2, labelId: source.id },
      { taskId: 3, labelId: "other" },
    ] });
    const result = await f.request({ mergeIntoLabelId: target.id });
    assert.equal(result.status, 200);
    assert.equal(result.body.id, target.id);
    const expectedViewId = ["target", "both"].includes(projectViewKind) ? target.id
      : ["source", "reused-source"].includes(projectViewKind) ? sourceProject.id : undefined;
    assert.equal(result.body.projectViewId, expectedViewId);
    assert.deepEqual(f.state.assignments, [
      { taskId: 1, labelId: target.id },
      { taskId: 3, labelId: "other" },
      { taskId: 2, labelId: target.id },
    ]);
    assert.equal(f.state.labels.some((row) => row.id === source.id), false);
    assert.equal(f.state.views[0].board_filters.matchFilters, "ANY");
    assert.equal(f.state.views[0].board_filters.addedFilters[0].match, "ALL");
    assert.deepEqual(f.state.views[0].board_filters.addedFilters[0].searchPayload.map((row) => row.id), [target.id]);
    assert.deepEqual(f.state.views[0].board_filters.addedFilters[1], mixed.board_filters.addedFilters[1]);
    if (expectedViewId) {
      const project = f.state.views.find((row) => row.id === expectedViewId);
      assert.equal(project.slug, expectedViewId === target.id ? targetProject.slug : sourceProject.slug);
      assert.equal(project.title, target.value);
      assert.equal(isProjectLabelView(project, target), true);
      const deleted = await f.request({ labelId: target.id }, "DELETE");
      assert.equal(deleted.status, 409);
    }
    if (projectViewKind === "both") assert.deepEqual(f.state.views.find((row) => row.id === target.id), targetProject);
  });
}

for (const kind of ["Private", "draft"]) {
  test(`other member's ${kind} reference rejects merge before any write`, async () => {
    const privateView = view(source, kind === "Private" ? { visibility: "Private" } : { unsaved_User_Project_View: [{ id: "draft" }] });
    const f = fixture({ views: [view(source, { id: "public" }), privateView] });
    const before = structuredClone(f.state);
    const result = await f.request({ mergeIntoLabelId: target.id });
    assert.equal(result.status, 409);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.state, before);
  });
}

test("own private reference can merge while unrelated foreign private views remain untouched", async () => {
  const own = view(source, { id: "own", userId: 42, visibility: "Private" });
  const foreign = view(target, { id: "foreign", visibility: "Private" });
  const f = fixture({ views: [own, foreign] });
  assert.equal((await f.request({ mergeIntoLabelId: target.id })).status, 200);
  assert.equal(f.state.views[0].board_filters.addedFilters[0].searchPayload[0].id, target.id);
  assert.deepEqual(f.state.views[1], foreign);
});

for (const id of [source.id, "reused-public"]) {
  test(`project tag deletion refuses ${id} without writes`, async () => {
    const f = fixture({ views: [view(source, { id })] });
    assert.equal((await f.request({}, "DELETE")).status, 409);
    assert.deepEqual(f.writes, []);
  });
}

test("ordinary tag deletion still removes references before assignments and label", async () => {
  const f = fixture({ views: [view(source, { id: "ordinary", title: "Queue" })] });
  assert.equal((await f.request({}, "DELETE")).status, 200);
  assert.deepEqual(f.state.views[0].board_filters.addedFilters, []);
  assert.deepEqual(f.writes.map((row) => row.kind), ["view.update", "taskLabel.deleteMany", "label.delete"]);
});

for (const operation of ["promote", "rename", "merge", "delete"]) {
  test(`managed smart split rejects ${operation} without writes`, async () => {
    const smart = { ...source, ai_prompt: "Classify design" };
    const f = fixture({ labels: [smart, target], views: [view(smart)] });
    const body = operation === "promote" ? { projectView: true }
      : operation === "rename" ? { value: "Renamed" }
        : operation === "merge" ? { mergeIntoLabelId: target.id } : {};
    assert.equal((await f.request(body, operation === "delete" ? "DELETE" : "POST")).status, 409);
    assert.deepEqual(f.writes, []);
  });
}

test("smart target and cross-board target reject ordinary merges without writes", async () => {
  for (const other of [{ ...target, ai_prompt: "Classify" }, { ...target, projectId: 16 }]) {
    const f = fixture({ labels: [source, other], views: [view(other)] });
    assert.ok([400, 409].includes((await f.request({ mergeIntoLabelId: target.id })).status));
    assert.deepEqual(f.writes, []);
  }
});

test("private references reject rename and delete without writes", async () => {
  for (const method of ["POST", "DELETE"]) {
    const f = fixture({ views: [view(source, { visibility: "Private" })] });
    assert.equal((await f.request({ value: "Renamed" }, method)).status, 409);
    assert.deepEqual(f.writes, []);
  }
});

test("fresh locked label state wins over the initial lookup", async () => {
  const f = fixture({ onLock: (state) => { state.labels = state.labels.filter((row) => row.id !== source.id); } });
  assert.equal((await f.request({ projectView: true })).status, 404);
  assert.deepEqual(f.writes, []);
});

test("invalid body, missing session and missing board access never write", async () => {
  for (const [options, body, status] of [
    [{}, { value: "" }, 400],
    [{}, { projectView: "true" }, 400],
    [{ anonymous: true }, {}, 401],
    [{ forbidden: true }, {}, 403],
  ]) {
    const f = fixture(options);
    assert.equal((await f.request(body)).status, status);
    assert.deepEqual(f.writes, []);
    assert.equal(f.events.includes("lock"), false);
  }
});

test("rename plus promotion reuses a matching view under the new name", async () => {
  const existing = view(source, { id: "existing-public", title: "Renamed" });
  const f = fixture({ views: [existing] });
  const result = await f.request({ value: "Renamed", projectView: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.projectViewId, existing.id);
  assert.equal(f.state.views.length, 1);
  assert.equal(f.state.views[0].board_filters.addedFilters[0].searchPayload[0].value, "Renamed");
});

test("promotion never reuses private, unsaved or constrained views", async () => {
  const privateView = view(source, { id: "private", visibility: "Private" });
  const draft = view(source, { id: "draft", unsaved_User_Project_View: [{ id: "owner-state" }] });
  const constrained = view(source, { id: "constrained", board_filters: {
    matchFilters: "ALL", addedFilters: [...buildSmartSplitBoardFilters(source).addedFilters, { type: "Priority", searchPayload: [{ id: 1 }] }],
  } });
  const f = fixture({ views: [privateView, draft, constrained] });
  const result = await f.request({ projectView: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.projectViewId, source.id);
  assert.deepEqual(f.state.views.slice(0, 3), [privateView, draft, constrained]);
  assert.equal(f.state.views.length, 4);
});

test("missing board defaults roll back the label rename", async () => {
  const f = fixture({ noDefault: true });
  const before = structuredClone(f.state);
  assert.equal((await f.request({ value: "Renamed", projectView: true })).status, 409);
  assert.deepEqual(f.state, before);
});


test("saved personal references refuse a merge without changing tags or views", async () => {
  const f = fixture({ personalReference: true, views: [view(source)] });
  const before = structuredClone(f.state);
  assert.equal((await f.request({ mergeIntoLabelId: target.id })).status, 409);
  assert.deepEqual(f.state, before);
  assert.deepEqual(f.writes, []);
});

test("a failed source deletion rolls back copied assignments and retargeted views", async () => {
  const f = fixture({ views: [view(source)], assignments: [{ taskId: 7, labelId: source.id }], failWrite: "label.delete" });
  const before = structuredClone(f.state);
  assert.equal((await f.request({ mergeIntoLabelId: target.id })).status, 500);
  assert.deepEqual(f.state, before);
});
