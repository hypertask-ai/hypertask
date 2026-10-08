const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { notificationRoutes, notificationLegacySources, notifications } = require("./htpr-6923-verify.cjs");
const sources = notificationLegacySources();
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const timestamp = "2026-10-07T12:00:00.000Z";
const archivedAt = "2026-10-06T12:00:00.000Z";
const endpoints = {
  "(un)archiveBulk": { body: { notificationIds: [{ notificationId: 20, taskId: 42, userId: 6 }, { notificationId: 24 }], userId: 6 } },
  getByTask: { body: { taskId: "42tail", userId: 6 } },
  markAsDone: { query: { id: "20", taskId: "42", userId: "6" } },
  markAsUnseen: { query: { notificationId: "20", seen: "1", userId: "6" } },
  moveTaskToInbox: { body: { taskId: 42, projectId: 15, userId: 6 } },
  sendEmailToFollower: { body: { sender: "Sender", receiver: 2343, taskTitle: "Task", taskLink: "https://example.invalid/task/42", mentionType: "mention", taskId: 42, userId: 6 } },
  unArchiveNotificationById: { body: { notificationId: 20, userId: 6 } },
  updateSeen: { body: { commentIds: [10, 11], taskId: "42", userId: 6 } },
};
function compileOriginal(source, mocks) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    assert.ok(Object.hasOwn(mocks, specifier), `Unexpected original dependency: ${specifier}`);
    const mock = mocks[specifier];
    return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
  }, mod, mod.exports);
  return mod.exports.default;
}
function fixture(name, scenario = {}, mode = false) {
  const effects = [], flags = [], loads = [], auth = [];
  const userId = scenario.userId ?? 985;
  const session = scenario.noAuth ? null : { userId, source: "better-auth" };
  const notification = (id, extra = {}) => ({ id, userId: 985, projectId: 15, taskId: 42, fromUserId: 985, fromAgentId: null, agentId: null, type: "TaskMovedToInbox", seen: false, status: "Normal", archivedAt: null, returnedFromReminders: false, createdAt: timestamp, ...extra });
  const rows = [notification(20, scenario.notification), notification(21), notification(22, { status: "Archive", archivedAt }), notification(23, { userId: 6 }), notification(24, { taskId: null, projectId: null }), notification(25, { type: "Invited" }), notification(26, { status: "Deleted" })];
  if (scenario.noRows) rows.splice(0);
  const step = (label, ...args) => {
    effects.push([label, ...clean(args)]);
    if (scenario.failAt === effects.length || scenario.failLabel === label) throw new Error(label + " unavailable");
  };
  const matches = (row, where) => Object.entries(where ?? {}).every(([key, value]) => {
    if (key === "project" || key === "task") return !scenario.tutorialDenied;
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      if (Object.hasOwn(value, "in")) return value.in.includes(row[key]);
      if (Object.hasOwn(value, "not")) return row[key] !== value.not;
    }
    return clean(row[key]) === clean(value);
  });
  const db = {
    notification: {
      findFirst: async args => {
        step("findFirst", args);
        const found = rows.filter(row => matches(row, args.where));
        if (args.orderBy) found.reverse();
        return structuredClone(found[0] ?? null);
      },
      findUnique: async args => { step("findUnique", args); return structuredClone(rows.find(row => row.id === args.where.id) ?? null); },
      findUniqueOrThrow: async args => {
        step("findUniqueOrThrow", args);
        const row = rows.find(row => row.id === args.where.id);
        if (!row) throw new Error("Notification missing");
        return structuredClone(row);
      },
      updateMany: async args => {
        step("updateMany", args);
        const found = rows.filter(row => matches(row, args.where));
        found.forEach(row => Object.assign(row, structuredClone(args.data)));
        return { count: found.length };
      },
      update: async args => {
        step("update", args);
        const found = rows.find(row => row.id === args.where.id);
        if (!found) throw new Error("Notification missing");
        Object.assign(found, structuredClone(args.data));
        return structuredClone(found);
      },
    },
    task: { findFirst: async args => { step("task-scope", args); return scenario.denied ? null : { id: Number(args.where.id) }; } },
    comment: { updateMany: async args => { step("comments", args); return { count: 2 }; } },
    $transaction: async fn => { step("transaction"); const result = await fn(db); step("commit"); return result; },
    $queryRaw: async (_strings, ...values) => { step("task-project-lock", values); return [{ projectId: scenario.wrongBoard ? 16 : 15 }]; },
  };
  const realtime = {
    socketIdFromHeader: load("src/lib/realtime/server.ts", {
      "@/lib/realtime/config": {}, "pusher": { default: class {} },
    }).socketIdFromHeader,
    broadcastInboxChange: (...args) => { step("inbox-realtime", ...args); },
  };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async headers => {
      auth.push(headers.get("cookie"));
      if (scenario.authThrows) throw new Error("Auth unavailable");
      return session;
    } },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/flags": { HTPR_6989_BULK_ARCHIVE_UNDO_FLAG: "htpr-6989-bulk-archive-undo", isFeatureEnabled: async (key, id) => {
      // Router parity keeps the independent bulk-undo bugfix off.
      if (key === "htpr-6989-bulk-archive-undo") return false;
      flags.push([key, id]);
      if (mode === "outage") throw new Error("Flag unavailable");
      return mode === true;
    } },
    "@/lib/prisma": { default: db },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: userId => ({ ownerId: userId }) },
    "@/lib/realtime/server": realtime,
    "@/utils/controllers/tasks/assertTaskAccess": { userCanAccessTaskContent: async (...args) => { step("task-access", ...args); return !scenario.denied; } },
    "@/utils/controllers/notifications/sendMentionEmail": { sendMentionEmail: async (...args) => { step("email", ...args); return !scenario.emailFailed; } },
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": { default: async (actor, project, task, payload, reminder, tx) => {
      assert.equal(tx, db);
      step("inbox-create-and-reminder", actor, project, task, payload, reminder);
      const created = notification(30, payload); rows.push(created); return created;
    } },
    "./writeLocks": { withTaskInboxWriteLock: async (taskId, fn) => { step("inbox-lock", taskId); const result = await fn(db); step("inbox-unlock", taskId); return result; } },
  };
  mocks["@/utils/controllers/notifications/getByTask"] = load("src/utils/controllers/notifications/getByTask.ts", mocks);
  mocks["@/lib/taskCardActions/inboxState"] = load("src/lib/taskCardActions/inboxState.ts", mocks);
  const { module, method, path } = notificationRoutes[name];
  const web = load(`src/lib/api/notification-writes/${module}.ts`, mocks)[method];
  mocks[`@/lib/api/notification-writes/${module}`] = { get [method]() {
    loads.push(module);
    if (scenario.loadThrows) throw new Error("Route load unavailable");
    return web;
  } };
  return { legacy: compileOriginal(sources[name], mocks), current: load(path, mocks).default, web, effects, flags, loads, auth, rows };
}
function input(name, scenario = {}) {
  return {
    method: Object.hasOwn(scenario, "method") ? scenario.method : notificationRoutes[name].method,
    body: Object.hasOwn(scenario, "body") ? scenario.body : endpoints[name].body,
    query: Object.hasOwn(scenario, "query") ? scenario.query : endpoints[name].query ?? {},
    headers: { cookie: 'ht_session=synthetic; nookies_user={"id":6}', "x-socket-id": "123.456", ...scenario.headers },
    cookies: { ht_session: "synthetic", nookies_user: '{"id":6}' },
  };
}
async function quiet(fn) {
  const saved = { log: console.log, error: console.error }, RealDate = Date;
  console.log = console.error = () => {};
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [timestamp])); } static now() { return new RealDate(timestamp).getTime(); } };
  try { return await fn(); } finally { global.Date = RealDate; Object.assign(console, saved); }
}
async function invoke(fx, name, scenario = {}, target = "current") {
  return quiet(async () => {
    const req = input(name, scenario), headers = {};
    let result;
    try {
      if (target === "web") {
        const url = new URL(`https://example.invalid/api/${name}`);
        for (const [key, value] of Object.entries(req.query)) for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(key, entry);
        const request = scenario.realWeb
          ? new Request(url, { method: notificationRoutes[name].method, headers: { ...req.headers, "content-type": "application/json" }, ...(notificationRoutes[name].method !== "GET" ? { body: JSON.stringify(req.body) } : {}) })
          : { headers: new Headers(req.headers), rawHeaders: req.headers, query: req.query, json: async () => { if (scenario.jsonThrows) throw new Error("JSON unavailable"); return req.body; } };
        const response = await fx.web(request);
        response.headers.forEach((value, key) => { if (key !== "content-type") headers[key] = value; });
        const text = await response.text();
        result = { status: response.status, body: text ? JSON.parse(text) : undefined, headers };
      } else {
        await fx[target](req, {
          setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
          status: status => ({ json: value => { result = { status, body: clean(value), headers }; return result; } }),
        });
      }
    } catch (error) { result = { throws: String(error) }; }
    return result;
  });
}
async function parity(name, scenario = {}) {
  const old = fixture(name, scenario), expected = await invoke(old, name, scenario, "legacy");
  for (const mode of [false, "outage", true, "web"]) {
    const fx = fixture(name, scenario, mode);
    assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected, `${name}: ${mode} wire`);
    assert.deepEqual(fx.effects, old.effects, `${name}: ${mode} ordered effects`);
    assert.deepEqual(clean(fx.rows), clean(old.rows), `${name}: ${mode} stored notifications`);
    assert.equal(fx.loads.length, mode === true && !scenario.noAuth && !scenario.authThrows ? 1 : 0);
    if (fx.flags.length) assert.deepEqual(fx.flags, [["htpr-6923-app-router-writes", scenario.userId ?? 985]]);
  }
  return { old, expected };
}

test("slice-10 inventory, independent fixtures, legacy byte pins and no App URL twins", notifications);
const cases = [
  ["success", {}], ["unauthenticated", { noAuth: true }], ["auth before invalid body/query", { noAuth: true, body: null, query: {} }],
  ["null body", { body: null }], ["absent body", { body: undefined }], ["primitive body", { body: "unchanged" }],
  ["missing fields", { body: {}, query: {} }], ["auth outage", { authThrows: true }],
  ["signed identity ignores spoofed inputs", { userId: 2343 }], ["invalid socket", { headers: { "x-socket-id": "invalid" } }],
  ["array socket preserves first tab exclusion", { headers: { "x-socket-id": ["123.456", "789.012"] } }],
  ["literal comma socket remains invalid", { headers: { "x-socket-id": "123.456,789.012" } }],
];
for (const name of Object.keys(endpoints)) {
  for (const [label, scenario] of cases) test(`${name}: ${label} original/Off/outage/On/Web`, () => parity(name, scenario));
  test(`${name}: real Web Request preserves wire and effects`, async () => {
    const old = fixture(name), fx = fixture(name);
    assert.deepEqual(await invoke(fx, name, { realWeb: true }, "web"), await invoke(old, name, {}, "legacy"));
    assert.deepEqual(fx.effects, old.effects);
  });
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", undefined]) {
    if (method === notificationRoutes[name].method) continue;
    test(`${name}: other method ${method} retains legacy contract`, async () => {
      const scenario = { method }, old = fixture(name), fx = fixture(name, {}, true);
      assert.deepEqual(await invoke(fx, name, scenario), await invoke(old, name, scenario, "legacy"));
      assert.deepEqual(fx.effects, old.effects);
      if (!notificationRoutes[name].anyMethod || method === undefined) {
        assert.deepEqual(fx.flags, []); assert.deepEqual(fx.loads, []); assert.deepEqual(fx.auth, old.auth);
      } else assert.equal(fx.loads.length, 1, "legacy's every-method write must remain every-method");
    });
  }
  test(`${name}: import failure never retries legacy`, async () => {
    const fx = fixture(name, { loadThrows: true }, true);
    assert.deepEqual(await invoke(fx, name), { throws: "Error: Route load unavailable" });
    assert.deepEqual(fx.effects, []); assert.equal(fx.loads.length, 1);
  });
  test(`${name}: every success-path failure boundary has no duplicate writes/fan-out`, async () => {
    const success = fixture(name); await invoke(success, name, {}, "legacy");
    for (let failAt = 1; failAt <= success.effects.length; failAt++) await parity(name, { failAt });
  });
  if (notificationRoutes[name].method !== "GET") test(`${name}: malformed Web JSON retains route-specific catch body`, async () => {
    const old = fixture(name, { body: null }), fx = fixture(name);
    assert.deepEqual(await invoke(fx, name, { jsonThrows: true }, "web"), await invoke(old, name, { body: null }, "legacy"));
    assert.deepEqual(fx.effects, []);
  });
}
const branchCases = {
  "(un)archiveBulk": [
    { body: { notificationIds: [] } }, { body: { notificationIds: "wrong" } }, { body: { notificationIds: [{}] } },
    { body: { notificationIds: [null] } }, { body: { notificationIds: [{ notificationId: 23, taskId: 42 }] } },
    { body: { notificationIds: [{ notificationId: 20, taskId: 42 }], status: "Normal" } },
    { body: { notificationIds: [{ notificationId: 26, taskId: 42 }] } },
    { body: { notificationIds: [{ notificationId: 999 }] } },
    { body: { notificationIds: [{ notificationId: 20, taskId: 42 }, { notificationId: 21, taskId: 42 }] } },
  ],
  markAsDone: [
    { query: { taskId: "42" } }, { query: { taskId: "not-a-number" } }, { query: { id: "24", taskId: "null" } },
    { query: { id: "25" } }, { query: { id: "26", taskId: "42" } }, { query: { id: "23", taskId: "42" } },
    { query: { id: "999" } }, { query: { id: "20", taskId: "42", tutorial: "1" } },
    { query: { taskId: "42", tutorial: "1" } }, { query: { id: "24", tutorial: "1" } },
    { query: { id: "20", taskId: "42", tutorial: "1" }, tutorialDenied: true },
    { query: { id: "20", tutorial: "1" }, notification: { status: "Archive", archivedAt } },
    { query: { id: "20", taskId: "42" }, notification: { status: "Archive", archivedAt } },
    { query: { id: "20", taskId: "42" }, notification: { status: "Archive", archivedAt: null } },
    { query: { id: ["20", "21"], taskId: ["42", "43"], tutorial: ["1", "0"] } },
    { query: { id: "20tail", taskId: "42tail" } }, { query: { id: "20", taskId: "" } },
  ],
  markAsUnseen: [
    { query: { taskId: "42tail" } }, { query: { taskId: "invalid" } }, { query: { taskId: "999" } },
    { query: { notificationId: "invalid" } }, { query: { notificationId: "23", seen: "0" } },
    { query: { notificationId: "20", seen: "0" } }, { query: { seen: "1" } },
    { query: { notificationId: ["20", "21"], seen: ["1", "0"] } },
    { query: { taskId: "42", notificationId: "23", seen: "0" } }, { notification: { seen: true }, query: { taskId: "42" } },
  ],
  getByTask: [{ body: { taskId: ["42", "43"], userId: 6 } }, { body: { taskId: "invalid" } }, { noRows: true }],
  moveTaskToInbox: [{ noRows: true }, { wrongBoard: true }, { body: { taskId: 42 } }, { failLabel: "inbox-create-and-reminder", noRows: true }],
  sendEmailToFollower: [
    { body: { receiver: "985" } }, { body: { ...endpoints.sendEmailToFollower.body, taskId: "42" } },
    { body: { ...endpoints.sendEmailToFollower.body, taskId: 0 } }, { body: { ...endpoints.sendEmailToFollower.body, taskId: "42tail" } },
    { denied: true }, { emailFailed: true }, { body: { ...endpoints.sendEmailToFollower.body, mentionType: undefined } },
  ],
  unArchiveNotificationById: [{ body: { notificationId: 23 } }, { body: { notificationId: 999 } }, { body: { notificationId: "20" } }, { notification: { status: "Deleted" } }],
  updateSeen: [{ body: { commentIds: [] } }, { body: { commentIds: [10, 11] } }, { failLabel: "updateMany" }],
};
for (const [name, scenarios] of Object.entries(branchCases)) for (const [index, scenario] of scenarios.entries()) {
  test(`${name}: branch ${index} preserves wire, signed scope and ordered fan-out`, () => parity(name, scenario));
}

test("bulk archive scopes representative and siblings, never another user or Deleted; undo skips sibling writes", async () => {
  const { old, expected } = await parity("(un)archiveBulk");
  assert.equal(expected.status, 200); assert.equal(expected.body.archivedCount, 2);
  assert.deepEqual(old.effects.map(([label]) => label), ["findFirst", "transaction", "updateMany", "updateMany", "updateMany", "commit", "inbox-realtime"]);
  assert.deepEqual(old.effects.at(-1), ["inbox-realtime", 985, { originUserId: 985 }, "123.456"]);
  assert.equal(old.rows.find(row => row.id === 23).status, "Normal"); assert.equal(old.rows.find(row => row.id === 26).status, "Deleted");
  assert.equal(clean(old.rows[0].archivedAt), timestamp); assert.equal(clean(old.rows[1].archivedAt), timestamp);
  const undo = await parity("(un)archiveBulk", branchCases["(un)archiveBulk"][5]);
  assert.equal(undo.old.effects.filter(([label]) => label === "updateMany").length, 1);
});
test("archive undo restores only same-batch siblings before realtime; tutorial archives only representative", async () => {
  const scenario = { notification: { status: "Archive", archivedAt } };
  const { old } = await parity("markAsDone", scenario);
  assert.deepEqual(old.effects.map(([label]) => label), ["findUnique", "update", "updateMany", "inbox-realtime"]);
  assert.deepEqual(old.effects[2][1].where, { id: { not: 20 }, taskId: 42, userId: 985, status: "Archive", archivedAt });
  assert.equal(old.rows.find(row => row.id === 22).status, "Normal"); assert.equal(old.rows.find(row => row.id === 21).status, "Normal");
  const tutorial = await parity("markAsDone", { query: { id: "20", taskId: "42", tutorial: "1" } });
  assert.deepEqual(tutorial.old.effects.map(([label]) => label), ["findUnique", "findFirst", "update", "inbox-realtime"]);
  assert.equal(tutorial.old.effects[1][1].where.project.ownerId, 985);
});
test("task-seen keeps signed user, Normal-only selection and comment write after notification result", async () => {
  const { old, expected } = await parity("getByTask");
  assert.deepEqual(expected.body, { count: 3 });
  assert.deepEqual(old.effects, [["updateMany", { data: { seen: true }, where: { userId: 985, taskId: 42, status: "Normal" } }]]);
  const comments = await parity("updateSeen", { failLabel: "updateMany" });
  assert.equal(comments.expected.status, 200, "legacy proceeds when the seen controller returns its caught 500");
  assert.deepEqual(comments.old.effects.map(([label]) => label), ["task-scope", "updateMany", "comments"]);
  assert.deepEqual(comments.old.effects[2][1], { where: { id: { in: [10, 11] }, taskId: 42, NOT: { seen: { has: 985 } } }, data: { seen: { push: 985 } } });
});
test("inbox creation retains task lock, dedupe/reminder path and exactly one realtime after unlock", async () => {
  const { old } = await parity("moveTaskToInbox", { noRows: true });
  assert.deepEqual(old.effects.map(([label]) => label), ["inbox-lock", "task-project-lock", "findFirst", "inbox-create-and-reminder", "inbox-unlock", "inbox-realtime"]);
  assert.deepEqual(old.effects[3], ["inbox-create-and-reminder", 985, 15, 42, { taskId: 42, userId: 985, projectId: 15, type: "TaskMovedToInbox", fromUserId: 985 }, true]);
  const existing = await parity("moveTaskToInbox");
  assert.ok(!existing.old.effects.some(([label]) => label === "inbox-create-and-reminder"));
});
test("follower email checks signed task access before exact original send arguments", async () => {
  const { old } = await parity("sendEmailToFollower");
  assert.deepEqual(old.effects, [["task-access", 985, 42], ["email", 2343, "Sender", "Task", "https://example.invalid/task/42", "mention", null, 42]]);
});

async function wire(fx, name, scenario, target) {
  const req = input(name, scenario);
  const server = http.createServer((request, response) => apiResolver(request, response, req.query, { default: fx[target] }, {}, false));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${name}`, {
      method: req.method, headers: { ...req.headers, "content-type": "application/json" },
      ...(req.method !== "GET" ? { body: JSON.stringify(req.body) } : {}),
    });
    return { status: response.status, body: await response.text(), headers: Object.fromEntries([...response.headers].filter(([key]) => !["date", "connection", "keep-alive"].includes(key))) };
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}
for (const name of Object.keys(endpoints)) for (const scenario of [{}, { noAuth: true }, { body: {}, query: {} }, { failAt: 1 }]) {
  test(`${name}: actual Pages HTTP status/body bytes/headers ${JSON.stringify(scenario)}`, async () => {
    const old = fixture(name, scenario), expected = await quiet(() => wire(old, name, scenario, "legacy"));
    assert.ok(expected.headers["content-type"].includes("application/json"));
    for (const mode of [false, "outage", true]) {
      const fx = fixture(name, scenario, mode);
      assert.deepEqual(await quiet(() => wire(fx, name, scenario, "current")), expected);
      assert.deepEqual(fx.effects, old.effects);
    }
  });
}
