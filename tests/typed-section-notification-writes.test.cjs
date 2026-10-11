const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const axios = require("axios");
const { load } = require("./task-route-loader.cjs");
const root = path.resolve(__dirname, "..");
const wrappedAxios = load("src/utils/axiosClient.ts", {}).default;
const client = load("src/lib/api/typedClient.ts", { "@/utils/axiosClient": { default: wrappedAxios } });
const section = { id: 12, projectId: 15, section_title: "Next", visibility: true, deleted: false, ranking: "A0150", isDone: null };
const notification = { id: 20, userId: 985, taskId: 12, projectId: 15, type: "TaskMovedToInbox", status: "Normal", seen: true, archivedAt: null, createdAt: "2026-10-06T09:00:00.000Z" };
const operations = [
  ["createSection", "sectionCreateRoute", { projectId: 15, title: "Next" }, { message: "Section created successfully", section, project_view: null }],
  ["updateSection", "sectionUpdateRoute", { userId: 985, sectionId: 12, newSection: { ranking: "A0150" } }, section],
  ["setNotificationSeen", "notificationSeenRoute", { notificationId: 20, seen: 0 }, notification],
  ["unarchiveNotification", "notificationUnarchiveRoute", { notificationId: 20 }, notification],
  ["archiveNotifications", "notificationBulkArchiveRoute", { notificationIds: [{ notificationId: 20, taskId: null, userId: 985 }], status: "Archive" }, { message: "Notifications processed successfully", archivedCount: 1, deletedCount: 0 }],
];
const originalAdapter = axios.defaults.adapter;
const originalWrappedAdapter = wrappedAxios.instance.defaults.adapter;
test.beforeEach(() => { axios.defaults.adapter = wrappedAxios.instance.defaults.adapter = async () => assert.fail("No live HTTP allowed"); });
test.afterEach(() => { axios.defaults.adapter = originalAdapter; wrappedAxios.instance.defaults.adapter = originalWrappedAdapter; });

for (const [name, descriptor, input, good] of operations) {
  test(`${name}: caller contract, transport parity, header, drift and no retry`, async (t) => {
    const route = client[descriptor];
    const isGet = name === "setNotificationSeen";
    assert.deepEqual((isGet ? route.query : route.body).parse(input), input);
    assert.deepEqual(route.success.parse(good), good);
    assert.equal(route.method, isGet ? "GET" : "POST");
    assert.equal(route.success.safeParse({ broken: true }).success, false);
    assert.equal(route.errors[401].safeParse({ message: 123 }).success, false);
    assert.equal(route.pathParams.safeParse({}).success, false);
    assert.equal((isGet ? route.body : route.query).safeParse({}).success, false);
    const calls = [], warnings = [];
    let data = good, failure;
    const adapter = async (config) => {
      calls.push(config);
      if (failure) throw failure;
      return { data: typeof data === "string" ? data : JSON.stringify(data), status: data === "" ? 204 : 200, statusText: "OK", headers: {}, config };
    };
    t.mock.method(axios.defaults, "adapter", adapter);
    t.mock.method(wrappedAxios.instance.defaults, "adapter", adapter);
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    const echo = { "X-Socket-Id": "123.456" };
    const write = () => client[name](input, echo);
    assert.deepEqual((await write()).data, good);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.get("X-Hypertask-Client"), "htpr-6925");
    assert.equal(calls[0].method, isGet ? "get" : "post");
    assert.equal(calls[0].url, name === "archiveNotifications" ? route.path().slice(4) : isGet ? `${route.path()}?notificationId=20&seen=0` : route.path());
    assert.equal(calls[0].baseURL, name === "archiveNotifications" ? "/api" : undefined);
    assert.equal(calls[0].timeout, name === "archiveNotifications" ? 30000 : 0);
    if (!isGet) assert.deepEqual(JSON.parse(calls[0].data), input);
    if (name === "archiveNotifications") assert.equal(calls[0].headers.get("X-Socket-Id"), "123.456");
    assert.equal(warnings.length, 0);
    if (name === "updateSection") {
      data = "";
      assert.equal((await write()).data, "");
      assert.equal(warnings.length, 0, "empty 204 is not drift");
    }
    data = { schemaDrift: true };
    assert.deepEqual((await write()).data, data);
    assert.equal(warnings.length, 1);
    failure = new axios.AxiosError("denied", "ERR_BAD_REQUEST", {}, null, { status: 403, data: { message: "Forbidden" } });
    const before = calls.length;
    await assert.rejects(write(), (error) => error === failure);
    assert.equal(calls.length, before + 1, "never retry a write");
  });
}

test("nested section rows, read switches, nullable notifications and future fields", () => {
  assert.equal(client.sectionCreateRoute.success.safeParse({ message: "Section created successfully", section: { ...section, ranking: 123 }, project_view: null }).success, false);
  assert.deepEqual(client.sectionCreateRoute.success.parse({ message: "Section created successfully", section, project_view: { id: "view", projectId: 15, allViews: [] } }).project_view.allViews, []);
  assert.equal(client.sectionUpdateRoute.body.safeParse({ sectionId: "12", newSection: {} }).success, false);
  assert.equal(client.notificationSeenRoute.query.safeParse({ notificationId: 20, seen: true }).success, false);
  assert.equal(client.notificationArchiveRoute.success.safeParse({ ...notification, seen: "true" }).success, false);
  assert.deepEqual(client.notificationSeenRoute.success.parse({ ...notification, taskId: null, projectId: null, future: true }).future, true);
  assert.deepEqual(client.sectionUpdateRoute.body.parse({ sectionId: 12, newSection: { ...section, deleted: true, items: [] } }).newSection.items, []);
});

test("archive keeps fetch status, original body and echo header, even with malformed JSON", async (t) => {
  const calls = [], warnings = [];
  let response = Response.json(notification);
  t.mock.method(global, "fetch", async (...args) => { calls.push(args); return response; });
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const query = { id: "20", taskId: null, userId: 985, type: "TaskMovedToInbox", tutorial: 1 };
  assert.deepEqual(client.notificationArchiveRoute.query.parse(query), query);
  assert.equal(await client.toggleNotificationArchive(query, { "X-Socket-Id": "123.456" }), response);
  assert.deepEqual(calls[0], ["/api/notifications/markAsDone?id=20&taskId=null&userId=985&type=TaskMovedToInbox&tutorial=1", { method: "GET", headers: { "X-Socket-Id": "123.456", "X-Hypertask-Client": "htpr-6925" } }]);
  assert.deepEqual(await response.json(), notification, "diagnostics never consume the caller's body");
  assert.equal(warnings.length, 0);
  response = Response.json({ drift: true });
  assert.equal(await client.toggleNotificationArchive(query, {}), response);
  assert.deepEqual(await response.json(), { drift: true });
  response = new Response("not JSON");
  assert.equal(await client.toggleNotificationArchive(query, {}), response);
  assert.equal(await response.text(), "not JSON");
  assert.equal(warnings.length, 2);
  response = Response.json({ message: "Forbidden" }, { status: 403 });
  assert.equal((await client.toggleNotificationArchive(query, {})).status, 403);
  assert.deepEqual(await response.json(), { message: "Forbidden" });
  assert.equal(warnings.length, 2, "do not diagnose failed writes as success");
  const error = new Error("network failed");
  t.mock.method(global, "fetch", async () => { throw error; });
  await assert.rejects(client.toggleNotificationArchive(query, {}), (caught) => caught === error);
});

function declaration(file, name, env) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) found ??= node;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(found, `${file}: ${name}`);
  const compiled = ts.transpileModule(`const ${found.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(env), `${compiled}\nreturn ${name};`)(...Object.values(env));
}
for (const flag of [false, undefined, true]) {
  test(`read helpers ${flag}: identical switches, null guards and swallowed rejection`, async () => {
    const calls = []; let failure = false;
    const write = async (...args) => { calls.push(args); if (failure) throw new Error("denied"); return { data: notification }; };
    const api = load("src/utils/api/Inbox/index.ts", { axios: { default: { get: (...args) => write("legacy", ...args) } } });
    const selected = flag ? (...args) => write("typed", ...args) : undefined;
    await api.markNotificationSeen(20, selected);
    assert.deepEqual(calls.pop(), flag ? ["typed", { notificationId: 20, seen: 0 }] : ["legacy", "/api/notifications/markAsUnseen?notificationId=20&seen=0"]);
    for (const seen of [false, true]) {
      await api.markAsUnseen(20, seen, undefined, selected);
      assert.deepEqual(calls.pop(), flag ? ["typed", { notificationId: 20, seen: seen ? 1 : 0 }] : ["legacy", `/api/notifications/markAsUnseen?notificationId=20&seen=${seen ? 1 : 0}`]);
    }
    await api.markNotificationSeen(null, selected);
    assert.equal(calls.length, 0);
    failure = true;
    const oldLog = console.log; console.log = () => {};
    try { assert.equal(await api.markNotificationSeen(20, selected), undefined); } finally { console.log = oldLog; }
  });
  test(`section reorder ${flag}: optimistic first, canonical rank before view, same failed persistence handling`, async () => {
    const calls = []; let failure = false;
    const write = async (...args) => { calls.push(["write", ...args]); if (failure) throw new Error("denied"); };
    const updatedSection = { ...section, ranking: "A0050" };
    const fn = declaration("src/components/Modals/commands/manageColumn.tsx", "onDragEndHandler", {
      typedWrite: flag ? (...args) => write("typed", ...args) : undefined, axios: { post: (...args) => write("legacy", ...args) },
      sections: [section], currentUser: { id: 985 },
      reorderSectionsWithRank: () => ({ reorderedSections: [updatedSection], updatedSection, ranking: "A0050" }),
      updateCache: async (...args) => calls.push(["cache", ...args]), synchronizeBoardSectionOrder: async (...args) => calls.push(["sync", ...args]),
      console: { log() {} }, toast: { error: (...args) => calls.push(["error", ...args]) },
    });
    const input = { source: { index: 0 }, destination: { index: 1 } };
    await fn(input);
    const body = { userId: 985, sectionId: 12, newSection: { ranking: "A0050" } };
    assert.deepEqual(calls.map(([kind]) => kind), ["cache", "write", "sync", "cache"]);
    assert.deepEqual(calls[1], flag ? ["write", "typed", body] : ["write", "legacy", "/api/section/update", body]);
    assert.equal(calls[0][2], false); assert.equal(calls[3][2], true);
    failure = true; calls.length = 0; await fn(input);
    assert.deepEqual(calls.map(([kind]) => kind), ["cache", "write", "error"]);
    assert.equal(calls[2][1], "Column order could not be saved");
  });
  test(`notification archive ${flag}: tutorial query, echo headers and unchanged task archive order`, async () => {
    const calls = [];
    const request = async (...args) => { calls.push(args); return { ok: true }; };
    const fn = declaration("src/hooks/Inbox/useGlobalFocusHandler.tsx", "archiveHandler", {
      searchParams: { get: () => "1" }, currentUser: { id: 985 },
      typedArchive: flag ? (...args) => request("typed", ...args) : undefined, fetch: (...args) => request("legacy", ...args), realtimeEchoHeaders: () => ({ "X-Socket-Id": "123.456" }),
    });
    const row = { ...notification, id: "20", taskId: null };
    assert.equal(await fn(row, 0, "Notification"), true);
    assert.deepEqual(calls[0], flag ? ["typed", { id: "20", taskId: null, userId: 985, type: notification.type, tutorial: 1 }, { "X-Socket-Id": "123.456" }] : ["legacy", "/api/notifications/markAsDone?id=20&taskId=null&userId=985&type=TaskMovedToInbox&tutorial=1", { method: "GET", headers: { "X-Socket-Id": "123.456" } }]);
    calls.length = 0; assert.equal(await fn({ ...row, taskId: 12 }, 0, "Task"), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], ["legacy", "/api/tasks/single", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newTask: { id: 12, status: "Archive" } }) }]);
  });
}

test("leaf flag selection and legacy wire expressions remain present", () => {
  for (const file of ["src/components/commands.tsx", "src/components/Modals/commands/manageColumn.tsx", "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx", "src/components/notifications/inboxSplit/index.tsx", "src/hooks/Inbox/useGlobalFocusHandler.tsx", "src/app/archived/ArchivedInboxComp.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /useFlag\(HTPR_6979_TYPED_WRITES_FLAG\)/, file);
    assert.match(source, /if \(typedWrites\)/, file);
  }
  const general = fs.readFileSync(path.join(root, "src/components/generalCommandActions.ts"), "utf8");
  assert.match(general, /createSectionWriter \? await createSectionWriter/);
  assert.match(general, /await axios.post\("\/api\/section\/create", \{\s*projectId: _currentProject.id,\s*title,\s*ranking,\s*\}\)/);
});

for (const flag of [false, undefined, true]) {
  test(`rename and delete ${flag}: exact patches, same cache behavior and failure settling`, async () => {
    const calls = []; let failure = false;
    const write = async (...args) => { calls.push(["write", ...args]); if (failure) throw new Error("denied"); };
    const fn = declaration("src/components/Modals/commands/manageColumn.tsx", "handleSectionUpdateVis", {
      typedWrite: flag ? (...args) => write("typed", ...args) : undefined, axios: { post: (...args) => write("legacy", ...args) },
      sections: [section], updating: false, lastColumnDeleteMessage: false, noEmptyBoardFlash: false, title: "Renamed", ticketsFinished: true, currentUser: { id: 985 }, currentProject: { id: 15, section: [section], sections: [section] },
      setUpdating: (value) => calls.push(["updating", value]),
      updateSection: (rows, updated, mode) => mode === "Delete" ? [] : rows.map((row) => ({ ...row, ...updated })),
      globalConstants: { GetAllManageColumnsPrefixKey: "manageColumns" },
      queryClient: { setQueryData: (...args) => calls.push(["cache", ...args]), refetchQueries: async (...args) => calls.push(["refetch", ...args]), invalidateQueries: async (...args) => calls.push(["invalidate", ...args]) },
      updateCache: (...args) => calls.push(["updateCache", ...args]), setCurrentProject: (...args) => calls.push(["project", ...args]), setEditSection() {}, console: { log() {} },
    });
    for (const mode of ["RENAME", "DELETE"]) {
      calls.length = 0; await fn(section, mode);
      const body = { userId: 985, sectionId: 12, newSection: mode === "RENAME" ? { section_title: "Renamed", isDone: true } : { ...section, deleted: true } };
      assert.deepEqual(calls.find(([kind]) => kind === "write"), flag ? ["write", "typed", body] : ["write", "legacy", "/api/section/update", body]);
      assert.equal(calls.filter(([kind]) => kind === "write").length, 1);
      assert.deepEqual(calls.at(-1), ["updating", false]);
      assert.ok(calls.some(([kind]) => kind === (mode === "DELETE" ? "refetch" : "project")));
      failure = true; calls.length = 0; await fn(section, mode);
      assert.deepEqual(calls.map(([kind]) => kind), ["updating", "write", "updating"]);
      failure = false;
    }
  });
  test(`unarchive ${flag}: unchanged refetches and error handling`, async () => {
    const calls = []; let failure = false;
    const write = async (...args) => { calls.push(["write", ...args]); if (failure) throw new Error("denied"); };
    const fn = declaration("src/app/archived/ArchivedInboxComp.tsx", "markAsUnarchive", {
      typedWrite: flag ? (...args) => write("typed", ...args) : undefined, axios: { post: (...args) => write("legacy", ...args) },
      queryClient: { refetchQueries: (...args) => calls.push(["refetch", ...args]) },
    });
    await fn(notification);
    assert.deepEqual(calls[0], flag ? ["write", "typed", { notificationId: 20 }] : ["write", "legacy", "/api/notifications/unArchiveNotificationById", { notificationId: 20 }]);
    assert.deepEqual(calls.slice(1), [["refetch", { queryKey: ["archivedInbox"] }], ["refetch", { queryKey: ["archivedInboxMeta"] }]]);
    failure = true; calls.length = 0; await fn(notification);
    assert.equal(calls.length, 1);
  });
  test(`bulk archive ${flag}: same filtered IDs and socket header`, async () => {
    const calls = [];
    const fn = declaration("src/hooks/Inbox/useGlobalFocusHandler.tsx", "bulkArchiveHandler", {
      typedBulkArchive: flag ? (...args) => calls.push(["typed", ...args]) : undefined,
      axiosClient: { post: (...args) => calls.push(["legacy", ...args]) }, realtimeEchoHeaders: () => ({ "X-Socket-Id": "123.456" }),
    });
    const entries = [{ notificationId: 20, taskId: null, userId: 985 }];
    await fn([...entries, { notificationId: null, taskId: 12, userId: 985 }, { notificationId: -1, taskId: 12, userId: 985 }], "Notification");
    const body = { notificationIds: entries, status: "Archive" };
    assert.deepEqual(calls, [flag ? ["typed", body, { "X-Socket-Id": "123.456" }] : ["legacy", "/notifications/(un)archiveBulk", body, { headers: { "X-Socket-Id": "123.456" } }]]);
  });
}

for (const flag of [false, undefined, true]) {
  test(`create ${flag}: same body, section reveal/cache patch and error close`, async () => {
    const calls = []; let failure = false;
    const write = async (...args) => { calls.push(["write", ...args]); if (failure) throw new Error("denied"); return { status: 200, data: { section, project_view: null } }; };
    const fn = declaration("src/components/generalCommandActions.ts", "createColumn", {
      createSectionWriter: flag ? (...args) => write("typed", ...args) : undefined,
      axios: { post: (...args) => write("legacy", ...args) }, _currentProject: { id: 15 },
      window: { dispatchEvent: (...args) => calls.push(["event", ...args]) }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      LEARN_TUTORIAL_COLUMN_CREATED_EVENT: "created", toast: { success: (...args) => calls.push(["success", ...args]), error: (...args) => calls.push(["error", ...args]) },
      getProjectIdxAndAllData: () => ({ projectToUpdateIndex: 0 }), updateProjectView: (...args) => calls.push(["patch", ...args]),
      boardCloseHandler: () => calls.push(["close"]), console: { log() {} },
    });
    assert.deepEqual(await fn("Next", undefined), { ...section, items: [] });
    const body = { projectId: 15, title: "Next", ranking: undefined };
    assert.deepEqual(calls[0], flag ? ["write", "typed", body] : ["write", "legacy", "/api/section/create", body]);
    assert.deepEqual(calls.find(([kind]) => kind === "patch"), ["patch", 0, null, { ...section, items: [] }]);
    assert.deepEqual(calls.at(-1), ["close"]);
    failure = true; calls.length = 0;
    assert.equal(await fn("Next", undefined), undefined);
    assert.deepEqual(calls.map(([kind]) => kind), ["write", "error", "close"]);
  });
}

test("captured disposable-local ON/OFF wire answers satisfy all adopted descriptors", () => {
  const fixtures = require("./fixtures/typed-section-notification-writes.json");
  for (const [name, descriptor] of [...operations.map(([name, descriptor]) => [name, descriptor]), ["toggleNotificationArchive", "notificationArchiveRoute"]]) {
    const route = client[descriptor];
    assert.ok(fixtures[name]?.length, name);
    for (const fixture of fixtures[name]) {
      const input = route.method === "GET" ? name === "setNotificationSeen"
        ? { notificationId: Number(fixture.query.notificationId), seen: Number(fixture.query.seen) }
        : { id: fixture.query.id, taskId: fixture.query.taskId === "null" ? null : Number(fixture.query.taskId), userId: Number(fixture.query.userId), type: fixture.query.type, ...(fixture.query.tutorial ? { tutorial: Number(fixture.query.tutorial) } : {}) }
        : fixture.body;
      assert.deepEqual((route.method === "GET" ? route.query : route.body).parse(input), input);
      assert.deepEqual(route.success.parse(fixture.data), fixture.data, `${name}: ${fixture.phase}`);
      assert.equal(route.path(), fixture.path);
      assert.equal(route.method, fixture.method);
    }
  }
  assert.ok(fixtures.updateSection.some(fixture => fixture.status === 204 && fixture.data === ""));
  assert.ok(fixtures.toggleNotificationArchive.some(fixture => fixture.data.status === "Archive"));
  assert.ok(fixtures.unarchiveNotification.some(fixture => fixture.data.status === "Normal"));
});
