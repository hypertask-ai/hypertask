const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { pins } = require("./helpers/htpr-6992-pins.cjs");
const rawPin = pins("a2-slice-11");
// Pins group by route so the fixture holds one digest per route.
const SPECIAL = { "matrix save": "matrix/POST", "splits save": "splits/POST", "archive meta": "getAllInbox/GET", "archived list": "getAllInbox/GET", mute: "mute/POST", unmute: "mute/POST", "304 getPushNotificationStatus": "getPushNotificationStatus/GET", "304 changePushNotificationStatus": "changePushNotificationStatus/POST" };
const groupOf = key => SPECIAL[key] ?? key.match(/([A-Za-z]+\/(?:GET|POST))/)?.[1] ?? key;
const pin = (key, value) => rawPin(groupOf(key), key, value);
const root = path.resolve(__dirname, "..");
// Route map: shared module, methods served and Pages file per endpoint; anyMethod endpoints answer every HTTP method.
const routes = {
  access: { module: "access", methods: ["GET"], anyMethod: false, path: "src/pages/api/notifications/access.ts" },
  changePushNotificationStatus: { module: "push-status-write", methods: ["POST"], anyMethod: false, path: "src/pages/api/notifications/changePushNotificationStatus.ts" },
  getAll: { module: "all-read", methods: ["GET"], anyMethod: false, path: "src/pages/api/notifications/getAll.ts" },
  getAllInbox: { module: "archived-read", methods: ["GET"], anyMethod: true, path: "src/pages/api/notifications/getAllInbox.ts" },
  getCount: { module: "count-read", methods: ["GET"], anyMethod: false, path: "src/pages/api/notifications/getCount.ts" },
  getPushNotificationStatus: { module: "push-status-read", methods: ["GET"], anyMethod: false, path: "src/pages/api/notifications/getPushNotificationStatus.ts" },
  matrix: { module: "matrix", methods: ["GET", "POST"], anyMethod: false, path: "src/pages/api/notifications/matrix.ts" },
  mute: { module: "mute", methods: ["GET", "POST"], anyMethod: false, path: "src/pages/api/notifications/mute.ts" },
  preference: { module: "preference", methods: ["POST"], anyMethod: false, path: "src/pages/api/notifications/preference.ts" },
  splits: { module: "splits", methods: ["GET", "POST"], anyMethod: false, path: "src/pages/api/notifications/splits.ts" },
};
function notificationSettings() {
  for (const entry of Object.values(routes)) {
    const page = fs.readFileSync(path.join(root, entry.path), "utf8");
    for (const method of entry.methods) {
      assert.ok(page.includes(entry.anyMethod ? '"*"' : `${method}: async`), `${entry.path} lists ${entry.anyMethod ? "every method" : method}`);
      assert.ok(page.includes(`(await import("@/lib/api/notification-writes/${entry.module}")).${method}`));
    }
    assert.ok(fs.readFileSync(path.join(root, `src/lib/api/notification-writes/${entry.module}.ts`), "utf8").includes("taskWriteRoute"));
    assert.ok(!fs.existsSync(path.join(root, entry.path.replace("src/pages/api/", "src/app/api/").replace(/\.ts$/, "/route.ts"))), "no URL twin");
  }
}
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const endpoints = Object.entries(routes).flatMap(([name, entry]) => entry.methods.map(method => ({ name, method, ...entry })));
const inputs = {
  access: {}, getAll: {}, getCount: {}, getAllInbox: { query: { cursor: "20tail", projectId: "15", q: "  Task  " } },
  getPushNotificationStatus: { query: { firebaseId: "device" } },
  changePushNotificationStatus: { body: { firebaseId: "device", newStatus: false, userId: 6 } },
  preference: { body: { notificationLevel: "direct", userId: 6 } },
  matrix: { body: { matrix: { mentions: { email: true, push: false } }, userId: 6 } },
  splits: { body: { splitsNoImportant: ["project:15", "system:Assigned", "project:15"], userId: 6 } },
  mute: { query: { taskId: "42" }, body: { taskId: "42", muted: true, userId: 6 } },
};
function fixture(endpoint, scenario = {}) {
  const effects = [], loads = [], auth = [], realtime = [];
  const userId = scenario.userId ?? 985;
  const session = scenario.noAuth ? null : { userId, source: "better-auth" };
  const state = {
    setting: scenario.noSetting ? null : {
      notificationPreference: "nothing",
      notificationMatrix: Object.hasOwn(scenario, "storedMatrix") ? scenario.storedMatrix : {
        comments: { email: false, push: true }, splitsNoImportant: ["project:15", "project:15", "invalid"], showImportantSplit: true,
      },
    },
    device: scenario.noDevice ? null : { id: 21, firebaseId: "device", userId: 985, sendNotifications: true },
    mute: scenario.noMute ? null : { id: 31, taskId: 42, userId: 985 },
  };
  const step = (label, ...args) => {
    effects.push([label, ...clean(args)]);
    if (scenario.failAt === effects.length || scenario.failLabel === label) throw new Error(label + " unavailable");
  };
  const db = {
    userSetting: {
      findUnique: async args => { step("settings-read", args); return structuredClone(state.setting); },
      update: async args => {
        step("settings-update", args);
        if (!state.setting) throw new Error("User settings missing");
        Object.assign(state.setting, structuredClone(args.data)); return structuredClone(state.setting);
      },
    },
    subscribedDevices: {
      findFirst: async args => { step("device-read", args); return structuredClone(state.device); },
      updateMany: async args => {
        step("device-update", args);
        if (!state.device || state.device.userId !== args.where.userId || state.device.firebaseId !== args.where.firebaseId) return { count: 0 };
        Object.assign(state.device, structuredClone(args.data)); return { count: 1 };
      },
    },
    taskMute: {
      findUnique: async args => { step("mute-read", args); return structuredClone(state.mute); },
      upsert: async args => { step("mute-upsert", args); state.mute = { id: 31, ...args.create }; return structuredClone(state.mute); },
      deleteMany: async args => { step("mute-delete", args); state.mute = null; return { count: 1 }; },
    },
    notification: {
      findMany: async args => { step("inbox-read", args); return scenario.noRows ? [] : [{ id: 20, taskId: 42, status: "Archive" }, { id: 19, taskId: 43, status: "Archive" }]; },
      groupBy: async args => { step("inbox-pairs", args); return scenario.noPairs ? [] : [{ type: "Comment", taskId: 42 }, { type: "Mention", taskId: 42 }, { type: "Comment", taskId: 43 }, { type: "Comment", taskId: null }, { type: "Comment", taskId: 44 }]; },
    },
    task: { findMany: async args => {
      step("inbox-task-boards", args);
      // Task 44 moved out of accessible scope between grouping and lookup.
      return [{ id: 42, projectId: 15, project: { title: "Alpha", name: "old" } }, { id: 43, projectId: 16, project: scenario.noProjectName ? null : { title: null, name: "Beta" } }];
    } },
    $transaction: async (callback) => callback(db),
    $executeRaw: async (strings, ...values) => {
      step("splits-atomic-update", [...strings], values);
      if (!state.setting) return 0;
      state.setting.notificationMatrix = { ...(state.setting.notificationMatrix ?? {}), splitsNoImportant: JSON.parse(values[0]) }; return 1;
    },
  };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async headers => {
      auth.push(headers.get("cookie"));
      if (scenario.authThrows) throw new Error("Auth unavailable");
      return session;
    } },
    "@/lib/prisma": { default: db },
    "@/lib/realtime/server": { broadcastInboxChange: (...args) => { realtime.push(args); step("inbox-realtime", ...args); }, broadcastProjectChange: (...args) => { realtime.push(args); step("project-realtime", ...args); } },
    "@/utils/controllers/notifications/getAll": {
      default: async id => { step("inbox-all", id); return { status: scenario.controllerStatus ?? 200, json: { notifications: [{ id: 20 }], tabs: ["All"] } }; },
      notificationInboxInclude: id => { step("inbox-include", id); return { task: { select: { id: true, projectId: true } } }; },
    },
    "@/utils/controllers/notifications/getCount": { default: async id => { step("inbox-count", id); return { status: scenario.controllerStatus ?? 200, json: { all: 3, unseen: 1 } }; } },
    "@/utils/controllers/notifications/getAccessibleProjectIds": { getInboxAccessibleProjectIds: async id => { step("inbox-access", id); return scenario.noRows ? [] : [15, 16]; } },
  };
  // HTPR-7092: all-read reads through the Decisions wrapper, a pass-through while its flag is off.
  mocks["@/utils/controllers/notifications/getAllWithDecisions"] = mocks["@/utils/controllers/notifications/getAll"];
  mocks["@/utils/controllers/notifications/getCountWithBoardAccessRequests"] = mocks["@/utils/controllers/notifications/getCount"];
  mocks["@/lib/inboxSplitSettings"] = load("src/lib/inboxSplitSettings.ts", mocks);
  const web = load(`src/lib/api/notification-writes/${endpoint.module}.ts`, mocks)[endpoint.method];
  const routeModule = {};
  for (const method of endpoint.methods) Object.defineProperty(routeModule, method, { get() {
    loads.push(method); if (scenario.loadThrows) throw new Error("Route load unavailable");
    return load(`src/lib/api/notification-writes/${endpoint.module}.ts`, mocks)[method];
  } });
  mocks[`@/lib/api/notification-writes/${endpoint.module}`] = routeModule;
  return { current: load(endpoint.path, mocks).default, web, effects, loads, auth, state, realtime };
}
function input(endpoint, scenario = {}) {
  return {
    method: Object.hasOwn(scenario, "method") ? scenario.method : endpoint.method,
    body: Object.hasOwn(scenario, "body") ? scenario.body : inputs[endpoint.name].body,
    query: Object.hasOwn(scenario, "query") ? scenario.query : inputs[endpoint.name].query ?? {},
    headers: { cookie: 'ht_session=synthetic; nookies_user={"id":6}', "x-socket-id": "123.456" },
    cookies: { ht_session: "synthetic", nookies_user: '{"id":6}' },
  };
}
async function quiet(fn) {
  const saved = { log: console.log, error: console.error }, now = performance.now;
  console.log = console.error = () => {};
  let tick = 100;
  performance.now = () => (tick += 1.25);
  try { return await fn(); } finally { Object.assign(console, saved); performance.now = now; }
}
async function invoke(fx, endpoint, scenario = {}, target = "current") {
  return quiet(async () => {
    const req = input(endpoint, scenario), headers = {};
    let result;
    try {
      if (target === "web") {
        const url = new URL(`https://example.invalid/api/notifications/${endpoint.name}`);
        for (const [key, value] of Object.entries(req.query)) for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(key, entry);
        const request = scenario.realWeb
          ? new Request(url, { method: endpoint.method, headers: { ...req.headers, "content-type": "application/json" }, ...(endpoint.method !== "GET" ? { body: JSON.stringify(req.body) } : {}) })
          : { headers: new Headers(req.headers), query: req.query, json: async () => { if (scenario.jsonThrows) throw new Error("JSON unavailable"); return req.body; } };
        const response = await fx.web(request);
        response.headers.forEach((value, key) => { if (key !== "content-type") headers[key] = value; });
        const text = await response.text();
        result = { status: response.status, body: text ? JSON.parse(text) : undefined, headers };
      } else await fx[target](req, {
        setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
        status: status => ({ json: value => { result = { status, body: clean(value), headers }; return result; } }),
      });
    } catch (error) { result = { throws: String(error) }; }
    return result;
  });
}
// Runs the Pages adapter, pins wire, effects and stored state, then checks the shared Web handler agrees.
async function parity(endpoint, scenario = {}, key = `${endpoint.name}/${endpoint.method}: ${JSON.stringify(scenario)}`) {
  const old = fixture(endpoint, scenario), expected = await invoke(old, endpoint, scenario, "current");
  pin(key, { expected, effects: old.effects, state: old.state, realtime: old.realtime });
  assert.equal(old.loads.length, 1, "listed method always loads the shared route");
  // The adapter passes its session on; only a missing session makes the shared route look it up again.
  assert.equal(old.auth.length, scenario.noAuth || scenario.authThrows ? 2 : 1);
  const fx = fixture(endpoint, scenario);
  assert.deepEqual(await invoke(fx, endpoint, scenario, "web"), expected, `${endpoint.name}/${endpoint.method}: web wire`);
  assert.deepEqual(fx.effects, old.effects, `${endpoint.name}: web ordered inbox/storage/realtime effects`);
  assert.deepEqual(fx.state, old.state, `${endpoint.name}: web stored state`);
  assert.deepEqual(fx.realtime, old.realtime);
  assert.equal(fx.auth.length, 1, "shared path reuses the signed session");
  return { old, expected };
}

test("slice-11 structure: each Pages file is a thin adapter to its shared route and there are no App twins", notificationSettings);
const cases = [
  ["success", {}], ["unauthenticated", { noAuth: true }], ["auth precedes invalid input", { noAuth: true, body: null, query: {} }],
  ["auth outage", { authThrows: true }], ["null body", { body: null }], ["undefined body", { body: undefined }],
  ["primitive body", { body: "unchanged" }], ["array body", { body: [] }], ["empty input", { body: {}, query: {} }],
  ["signed identity ignores spoofed actor", { userId: 2343 }], ["missing settings", { noSetting: true }], ["missing device", { noDevice: true }],
  ["empty inbox", { noRows: true }], ["empty matrix", { storedMatrix: null }],
];
for (const endpoint of endpoints) {
  const label = `${endpoint.name}/${endpoint.method}`;
  for (const [name, scenario] of cases) test(`${label}: ${name} matches pinned wire, effects and Web handler`, () => parity(endpoint, scenario, `${label}: ${name}`));
  test(`${label}: real Web Request preserves wire and effects`, async () => {
    const { old, expected } = await parity(endpoint, {}, `${label}: real web success`);
    const fx = fixture(endpoint);
    assert.deepEqual(await invoke(fx, endpoint, { realWeb: true }, "web"), expected);
    assert.deepEqual(fx.effects, old.effects);
  });
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", undefined]) {
    if (endpoint.methods.includes(method)) continue;
    test(`${label}: other method ${method} ${endpoint.anyMethod ? "reaches the shared route" : "answers 405"}`, async () => {
      const scenario = { method }, fx = fixture(endpoint);
      const result = await invoke(fx, endpoint, scenario);
      if (endpoint.anyMethod) {
        assert.deepEqual(fx.loads, ["GET"]);
        pin(`${label}: other method ${method}`, { result, effects: fx.effects });
      } else {
        assert.equal(result.status, 405);
        pin(`${label}: other method ${method}`, result);
        assert.deepEqual(fx.effects, []); assert.deepEqual(fx.loads, []); assert.deepEqual(fx.auth, []);
      }
    });
  }
  test(`${label}: route load failure surfaces without running the operation`, async () => {
    const fx = fixture(endpoint, { loadThrows: true });
    assert.deepEqual(await invoke(fx, endpoint), { throws: "Error: Route load unavailable" });
    assert.deepEqual(fx.effects, []); assert.equal(fx.loads.length, 1);
  });
  test(`${label}: every success-path failure boundary has no duplicate effects`, async () => {
    const success = fixture(endpoint); await invoke(success, endpoint, {}, "current");
    for (let failAt = 1; failAt <= success.effects.length; failAt++) await parity(endpoint, { failAt }, `${label}: failAt ${failAt}`);
  });
  if (endpoint.method === "POST") test(`${label}: malformed Web JSON retains historical 500 catch`, async () => {
    const fx = fixture(endpoint);
    assert.equal((await invoke(fx, endpoint, { jsonThrows: true }, "web")).status, 500);
    assert.deepEqual(fx.effects, []);
  });
}
const branches = {
  "preference/POST": ["all", "nothing", "invalid", 1, false, ["all"]].map(notificationLevel => ({ body: { notificationLevel } })),
  "matrix/GET": [{ noSetting: true }, { storedMatrix: {} }],
  "matrix/POST": [
    { body: { matrix: {} } }, { body: { matrix: null } }, { body: { matrix: [] } },
    { body: { matrix: { invites: { email: true, push: true } } } }, { body: { matrix: { comments: { email: true } } } },
    { body: { matrix: { comments: { email: true, push: "false" } } } }, { body: { matrix: { comments: { email: true, push: false, extra: true } } } },
    { storedMatrix: { splitsNoImportant: ["system:All"], showImportantSplit: false } },
  ],
  "splits/GET": [{ storedMatrix: { splitsNoImportant: ["project:0", "system:", "project:15", "project:15", 42] } }],
  "splits/POST": [
    { body: { splitsNoImportant: [] } }, { body: { splitsNoImportant: ["project:0"] } }, { body: { splitsNoImportant: ["system:"] } },
    { body: { splitsNoImportant: ["system:" + "x".repeat(201)] } }, { body: { splitsNoImportant: Array(201).fill("project:15") } },
    { body: { splitsNoImportant: ["system:Any custom split", "project:2343"] } },
  ],
  "mute/GET": [{ noMute: true }, ...["42tail", "0", "-1", "1.5", "invalid", ["42", "43"]].map(taskId => ({ query: { taskId } }))],
  "mute/POST": [
    { body: { taskId: 42, muted: false } }, { body: { taskId: "42tail", muted: true } }, { body: { taskId: 42, muted: "true" } },
    { body: { taskId: [], muted: true } }, { body: { taskId: 0, muted: true } },
  ],
  "changePushNotificationStatus/POST": [{ body: { firebaseId: "device", newStatus: true } }, { body: { firebaseId: "foreign", newStatus: true } }, { body: { firebaseId: "device" } }],
  "getPushNotificationStatus/GET": [{ query: { firebaseId: ["device", "foreign"] } }],
  "getAll/GET": [{ controllerStatus: 500 }], "getCount/GET": [{ controllerStatus: 500 }],
  "getAllInbox/GET": [
    { query: { mode: "meta", projectId: "15", boardScope: "all", q: "ignored" } },
    { query: { mode: "meta" }, noPairs: true }, { query: { mode: "meta" }, noProjectName: true },
    { query: { mode: "meta" }, failLabel: "inbox-pairs" }, { query: { mode: "meta" }, failLabel: "inbox-task-boards" },
    { query: { cursor: ["20tail", "30"], projectId: ["15", "16"], q: [" TASK ", "ignored"], boardScope: ["archived", "all"] } },
    { query: { mode: ["meta"], cursor: "0", projectId: "invalid", q: "  ", boardScope: "invalid" } },
    ...["active", "archived", "all"].map(boardScope => ({ query: { boardScope } })),
  ],
};
for (const endpoint of endpoints) for (const [index, scenario] of (branches[`${endpoint.name}/${endpoint.method}`] ?? []).entries()) {
  test(`${endpoint.name}/${endpoint.method}: branch ${index} preserves signed scope and ordered effects`, () => parity(endpoint, scenario, `${endpoint.name}/${endpoint.method}: branch ${index}`));
}

const endpoint = (name, method) => endpoints.find(row => row.name === name && row.method === method);
test("matrix saves category choices while retaining important-split metadata", async () => {
  const { old, expected } = await parity(endpoint("matrix", "POST"), {}, "matrix save");
  assert.equal(expected.status, 200);
  assert.deepEqual(old.effects.map(([label]) => label), ["settings-read", "settings-update"]);
  assert.deepEqual(old.effects[1][1].where, { userId: 985 });
  assert.deepEqual(expected.body.matrix, { mentions: { email: true, push: false }, splitsNoImportant: ["project:15"], showImportantSplit: true });
  assert.deepEqual(old.realtime, [], "settings save has no realtime fan-out");
});
test("split save deduplicates and performs one atomic update without overwriting categories", async () => {
  const { old } = await parity(endpoint("splits", "POST"), {}, "splits save");
  assert.deepEqual(old.effects.map(([label]) => label), ["splits-atomic-update"]);
  assert.deepEqual(old.effects[0][2], ['["project:15","system:Assigned"]', 985]);
  assert.deepEqual(old.state.setting.notificationMatrix.comments, { email: false, push: true });
  assert.equal(old.state.setting.notificationMatrix.showImportantSplit, true);
});
test("archive metadata de-duplicates pairs, rechecks board access and excludes moved/null tasks", async () => {
  const { old, expected } = await parity(endpoint("getAllInbox", "GET"), { query: { mode: "meta" } }, "archive meta");
  assert.deepEqual(expected.body, { total: 3, byProject: [{ projectId: 15, name: "Alpha", count: 2 }, { projectId: 16, name: "Beta", count: 1 }] });
  assert.deepEqual(old.effects.map(([label]) => label), ["inbox-pairs", "inbox-task-boards"]);
  assert.deepEqual(old.effects[1][1].where.id, { in: [42, 43, 44] });
  assert.deepEqual(old.effects[1][1].where.project.OR[0], { ownerId: 985 });
});
test("archived list retains query parsing, cursor, access, reminders, order and distinct rows", async () => {
  const { old } = await parity(endpoint("getAllInbox", "GET"), {}, "archived list");
  const args = old.effects.at(-1)[1];
  assert.deepEqual(old.effects.map(([label]) => label), ["inbox-include", "inbox-read"]);
  assert.equal(args.take, 50); assert.deepEqual(args.cursor, { id: 20 }); assert.equal(args.skip, 1);
  assert.deepEqual(args.distinct, ["type", "taskId"]);
  assert.deepEqual(args.orderBy, [{ archivedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }]);
  assert.deepEqual(args.where, { userId: 985, status: "Archive", agentId: null, task: { project: { status: "Normal", OR: [{ ownerId: 985 }, { members: { some: { userId: 985, agentId: null } } }] }, projectId: 15, title: { contains: "task", mode: "insensitive" }, Reminders: { every: { status: { not: "Normal" } } } } });
});
test("mute retains upsert and unmute delete scoped to signed actor with no new authorization or broadcast", async () => {
  const muted = await parity(endpoint("mute", "POST"), {}, "mute");
  assert.deepEqual(muted.old.effects, [["mute-upsert", { where: { taskId_userId: { taskId: 42, userId: 985 } }, update: {}, create: { taskId: 42, userId: 985 } }]]);
  const unmuted = await parity(endpoint("mute", "POST"), { body: { taskId: 42, muted: false } }, "unmute");
  assert.deepEqual(unmuted.old.effects, [["mute-delete", { where: { taskId: 42, userId: 985 } }]]);
});
test("304 bodies remain available to Pages until its HTTP boundary", async () => {
  for (const row of [endpoint("getPushNotificationStatus", "GET"), endpoint("changePushNotificationStatus", "POST")]) {
    const { expected } = await parity(row, { body: {}, query: {} }, `304 ${row.name}`);
    assert.equal(expected.status, 304); assert.ok(expected.body.message);
  }
});
async function wire(fx, endpoint, scenario, target) {
  const req = input(endpoint, scenario);
  const server = http.createServer((request, response) => apiResolver(request, response, req.query, { default: fx[target] }, {}, false));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications/${endpoint.name}`, {
      method: req.method, headers: { ...req.headers, "content-type": "application/json" },
      ...(req.method !== "GET" ? { body: JSON.stringify(req.body) } : {}),
    });
    return { status: response.status, body: await response.text(), headers: Object.fromEntries([...response.headers].filter(([key]) => !["date", "connection", "keep-alive"].includes(key))) };
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}
for (const row of endpoints) for (const scenario of [{}, { noAuth: true }, { body: {}, query: {} }, { failAt: 1 }]) {
  test(`${row.name}/${row.method}: actual Pages HTTP bytes and headers ${JSON.stringify(scenario)}`, async () => {
    const fx = fixture(row, scenario), actual = await quiet(() => wire(fx, row, scenario, "current"));
    if (actual.status === 304) { assert.equal(actual.body, ""); assert.equal(actual.headers["content-type"], undefined); }
    pin(`http ${row.name}/${row.method} ${JSON.stringify(scenario)}`, { actual, effects: fx.effects });
  });
}
