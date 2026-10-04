const assert = require("node:assert/strict");
const test = require("node:test");
const { Prisma, PrismaClient } = require("@prisma/client");
const { ColumnTypeEnum } = require("@prisma/driver-adapter-utils");
const { load } = require("./task-route-loader.cjs");

const contracts = require("./htpr-6509-s3-baseline.json");
assert.equal(contracts.commit, "fb9ef851b6bb3a5b8ef84d2425df5a6f7d19ac3b");
const json = (value) => JSON.parse(JSON.stringify(value));

// Frozen synthetic results were captured from production modules at the pinned
// pre-change commit. Normal runs neither need Git history nor rewrite them.
function reference(name, ...args) {
  const key = JSON.stringify([name, ...args]);
  assert.ok(Object.hasOwn(contracts.cases, key), `Missing baseline case: ${key}`);
  return structuredClone(contracts.cases[key]);
}

const projectAccess = { teamId: { not: null }, OR: [{ ownerId: 7 }, { members: { some: { userId: 7, agentId: null } } }] };
const page = { id: 60, publicId: "fixture-page", taskId: 50, title: "Page", contentHtml: "<p>original</p>", version: 3, subPages: [{ id: 61, title: "Child", publicId: "child-page" }], updatedAt: "2026-08-17T00:00:00.000Z" };

async function pageRun(before, operation, options = {}) {
  if (before) return reference("page", operation, options);
  const calls = [];
  const effects = [];
  const allowed = options.allowed !== false && options.projectStatus !== "Archive" && options.teamless !== true;
  function assertTaskWhere(where, id) {
    assert.deepEqual(where, { ...(id === undefined ? {} : { id }), project: { status: "Normal", ...projectAccess } });
  }
  const prisma = {
    page: {
      findUnique: async (args) => {
        calls.push("page");
        assert.equal(args.where.publicId, "fixture-page");
        if (args.where.task) { assertTaskWhere(args.where.task); if (!allowed) return null; }
        return options.missing ? null : { ...page };
      },
      update: async (args) => { effects.push(["title", args]); return { publicId: page.publicId, id: page.id, version: page.version }; },
    },
    task: { findFirst: async ({ where }) => { calls.push("task-access"); assertTaskWhere(where, 50); return allowed ? { id: 50 } : null; } },
  };
  const service = load("src/utils/controllers/pages/pageService.ts", {
    "@/lib/prisma": { default: prisma },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
    "@/utils/helperFunctions/markdownToHtml": {},
    "@/utils/helperFunctions/sanitizeRichHtml": {},
  });
  const mutations = {
    ...service,
    listPageVersions: async (args) => { effects.push(["versions", args]); return [{ id: 91, version: 2, note: null, authorId: 7, agentId: null, createdAt: page.updatedAt, contentHtml: "not returned" }]; },
    updatePage: async (args) => {
      effects.push(["update", args]);
      if (options.conflict) throw new service.PageConflictError(4, { html: "fresh", text: "fresh" });
      return { publicId: page.publicId, id: page.id, version: 4 };
    },
    restorePageVersion: async (args) => {
      effects.push(["restore", args]);
      if (options.versionMissing) throw new Error("Version not found");
      return { publicId: page.publicId, id: page.id, version: 4 };
    },
    archivePage: async (args) => { effects.push(["archive", args]); },
  };
  const [suffix, method] = { get: ["", "GET"], patch: ["", "PATCH"], versions: ["/versions", "GET"], restore: ["/restore", "POST"], archive: ["/archive", "POST"] }[operation];
  const route = load(`src/app/api/pages/[publicId]${suffix}/route.ts`, {
    "@/lib/prisma": { default: prisma },
    "@/utils/controllers/pages/pageService": mutations,
    "next/headers": { cookies: async () => ({ get: () => options.unauthorized ? undefined : ({ value: "fixture-profile" }) }) },
    "@/utils/edgeHelpers": { isValidUser: () => ({ isValid: true, user: { id: 7 } }) },
  });
  const request = { json: async () => { if (options.malformed) throw new SyntaxError("fixture"); return options.body ?? (operation === "restore" ? { version_id: 91 } : { title: "New", content: "text" }); } };
  const response = await route[method](request, { params: Promise.resolve({ publicId: page.publicId }) });
  return { status: response.status, body: await response.json(), calls, effects: json(effects) };
}

for (const operation of ["get", "patch", "versions", "restore", "archive"]) {
  test(`pages ${operation}: response, authorization and mutation arguments match baseline`, async () => {
    for (const options of [{}, { allowed: false }, { missing: true }, { unauthorized: true }, { projectStatus: "Archive" }, { teamless: true }]) {
      const before = await pageRun(true, operation, options);
      const after = await pageRun(false, operation, options);
      assert.deepEqual(json({ ...after, calls: undefined }), json({ ...before, calls: undefined }));
      assert.equal(after.calls.length, options.unauthorized ? 0 : 1);
      if (Object.keys(options).length === 0) console.log(`pages ${operation} access reads: ${before.calls.length} -> ${after.calls.length}`);
    }
  });
}
for (const [operation, options] of [["patch", { malformed: true }], ["patch", { body: [] }], ["patch", { conflict: true }], ["patch", { body: { title: "Only title" } }], ["restore", { malformed: true }], ["restore", { body: { version_id: "91" } }], ["restore", { versionMissing: true }]]) {
  test(`pages ${operation}: validation/conflict ${JSON.stringify(options)} stays identical`, async () => {
    const before = await pageRun(true, operation, options);
    const after = await pageRun(false, operation, options);
    assert.deepEqual(json({ ...after, calls: undefined }), json({ ...before, calls: undefined }));
  });
}

async function agentRun(before, method, ref, foreign = false, body = { displayName: "Renamed" }) {
  if (before) return reference("agent", method, ref, foreign, body);
  const calls = [];
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const agents = [{ id, displayName: "Same Name", createdAt: new Date("2026-01-01") }, { id: "22222222-2222-4222-8222-222222222222", displayName: "Same Name", createdAt: new Date("2026-02-01") }];
  if (ref === "uuid-slug") agents[1].displayName = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const agent = { ...agents[0], visibility: "PRIVATE", photoURL: null, revokedAt: null, archivedAt: null, permissions: { postsToImportant: false }, runtimeType: "EXTERNAL", prompt: null, modelOptionId: null, heartbeatAt: null };
  const db = { agent: {
    findMany: async ({ where }) => { calls.push("names"); assert.deepEqual(where, { userId: 7 }); return foreign ? [] : agents; },
    findFirst: async ({ where }) => { calls.push("owned-row"); assert.equal(where.userId, 7); const owned = agents.find((row) => row.id === where.id); return foreign || !owned ? null : { ...agent, ...owned }; },
    update: async ({ where, data }) => { calls.push("update"); const owned = agents.find((row) => row.id === where.id); assert.ok(owned); Object.assign(owned, data); return { ...agent, ...owned, ...data }; },
  } };
  const route = load("src/app/api/agents/[agentId]/route.ts", {
    "@/lib/prisma": { default: db },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 7 }) },
    "@/lib/mcp/auth": {},
    "@/lib/aiModelOptions": {},
    "@/lib/agents/working": {},
    "@/lib/agents/runtimeState": {},
    "@/lib/mcp/agents/ownedAgents": { deleteOwnedAgent: async (_db, userId, agentId) => { calls.push("delete-owned"); assert.equal(userId, 7); assert.equal(agentId, id); return foreign ? null : { id, deleted_board_memberships: 2, deleted_task_assignments: 3, comment_tombstones: 4 }; } },
    "@/lib/agents/boardAccess": {},
    "@/lib/agents/visibility": {},
  });
  const agentRef = { id, slug: "same-name", "spaced-id": ` ${id} `, "uppercase-id": id.toUpperCase(), "duplicate-slug": "same-name-2", "uuid-slug": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "unknown-id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "unknown-slug": "missing-agent" }[ref];
  const response = await route[method]({ headers: new Headers(), json: async () => body }, { params: Promise.resolve({ agentId: agentRef }) });
  return { status: response.status, body: await response.json(), calls };
}
for (const method of ["PATCH", "DELETE"]) for (const ref of ["id", "slug"]) {
  test(`agents ${method} by ${ref}: ownership, cleanup and renamed slugs match baseline`, async () => {
    for (const foreign of [false, true]) {
      const before = await agentRun(true, method, ref, foreign);
      const after = await agentRun(false, method, ref, foreign);
      assert.deepEqual(json({ ...after, calls: undefined }), json({ ...before, calls: undefined }));
      if (!foreign) {
        const readCount = (calls) => calls.filter((call) => ["names", "owned-row"].includes(call)).length;
        if (method === "PATCH") assert.equal(readCount(after.calls), ref === "id" ? 2 : 3);
        console.log(`agents ${method}/${ref} ownership/slug reads: ${readCount(before.calls)} -> ${readCount(after.calls)}`);
      }
    }
  });
}

for (const ref of ["spaced-id", "uppercase-id", "duplicate-slug", "uuid-slug", "unknown-id", "unknown-slug"]) {
  test(`agents PATCH edge reference ${ref} retains the exact ID/slug matching policy`, async () => {
    const before = await agentRun(true, "PATCH", ref);
    const after = await agentRun(false, "PATCH", ref);
    assert.deepEqual(json({ ...after, calls: undefined }), json({ ...before, calls: undefined }));
  });
}
test("agents PATCH without renaming still recomputes the canonical collision-safe slug", async () => {
  const body = { photoURL: "https://fixture.invalid/photo" };
  const before = await agentRun(true, "PATCH", "id", false, body);
  const after = await agentRun(false, "PATCH", "id", false, body);
  assert.deepEqual(json({ ...after, calls: undefined }), json({ ...before, calls: undefined }));
  assert.equal(after.body.agent.slug, "same-name");
});

async function guestRun(before, ownerUid, missing = false) {
  if (before) return reference("guest", ownerUid, missing);
  let projectArgs;
  const calls = [];
  const db = new Proxy({}, { get: (_target, model) => ({
    findUnique: async (args) => { calls.push(`${model}.findUnique`); if (model === "project") projectArgs = args; return model === "project" ? missing ? null : { ownerId: 7, owner: { uid: ownerUid } } : { uid: ownerUid }; },
    findMany: async () => { calls.push(`${model}.findMany`); return [{ id: 50 }]; },
    deleteMany: async (args) => { calls.push([`${model}.deleteMany`, args]); return { count: 1 }; },
    updateMany: async (args) => { calls.push([`${model}.updateMany`, args]); return { count: 1 }; },
  }) });
  const service = load("src/lib/demo/cleanupGuest.ts", {
    "@/lib/prisma": { default: db },
    "@/lib/googleCalendar/connection": {},
    "./guest": { GUEST_UID_PREFIX: "guest_" },
  });
  let error;
  try { await service.deleteGuestProjectCascade(15); } catch (failure) { error = failure.message; }
  return { error, reads: calls.filter((call) => typeof call === "string"), writes: calls.filter((call) => typeof call !== "string"), projectArgs };
}
for (const [uid, missing] of [["guest_fixture", false], ["real-user", false], ["guest_fixture", true]]) {
  test(`guest board cascade ${uid}/${missing}: safety guard and ordered deletes are identical`, async () => {
    const before = await guestRun(true, uid, missing);
    const after = await guestRun(false, uid, missing);
    assert.deepEqual(after.writes, before.writes);
    assert.equal(after.error, before.error);
    assert.equal(after.reads.length, missing ? 1 : uid === "guest_fixture" ? 2 : 1);
    console.log(`guest board safety reads: ${before.reads.length} -> ${after.reads.length}`);
  });
}

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
function modelRow(name, overrides = {}) {
  return Object.fromEntries(models.get(name).fields.filter((field) => field.kind !== "object" && !field.isIgnored).map((field) => {
    const value = Object.hasOwn(overrides, field.name) ? overrides[field.name] : field.isList ? [] : !field.isRequired ? null : field.type === "Int" ? 1 : field.type === "Boolean" ? false : field.type === "DateTime" ? "2026-08-17T00:00:00.000Z" : field.type === "Json" ? {} : field.kind === "enum" ? Prisma.dmmf.datamodel.enums.find(({ name }) => name === field.type).values[0].name : `fixture-${field.name}`;
    return [field.name, field.type === "String" && value != null ? String(value) : value];
  }));
}
function projection(name, row, args) {
  const scalars = Object.fromEntries(models.get(name).fields.filter((field) => field.kind !== "object" && !field.isIgnored).map((field) => [field.name, true]));
  return Object.fromEntries(Object.entries({ ...(args.select ?? scalars), ...args.include }).filter(([, enabled]) => enabled).map(([key, selection]) => {
    const field = models.get(name).fields.find((candidate) => candidate.name === key);
    const value = row[key];
    if (field.kind !== "object" || value == null) return [key, value];
    return [key, Array.isArray(value) ? value.map((child) => projection(field.type, child, selection === true ? {} : selection)) : projection(field.type, value, selection === true ? {} : selection)];
  }));
}
function columnType(name, key) {
  const field = models.get(name).fields.find((candidate) => candidate.name === key);
  if (field.isList) return field.type === "Int" ? ColumnTypeEnum.Int32Array : ColumnTypeEnum.TextArray;
  return { Int: ColumnTypeEnum.Int32, Boolean: ColumnTypeEnum.Boolean, DateTime: ColumnTypeEnum.DateTime, Json: ColumnTypeEnum.Json }[field.type] ?? ColumnTypeEnum.Text;
}
async function plannedRead(name, graph, args, strategy) {
  const queries = [];
  const byModel = new Map();
  function collect(model, row) {
    byModel.set(model, [...(byModel.get(model) ?? []), row]);
    for (const field of models.get(model).fields.filter((field) => field.kind === "object")) {
      const value = row[field.name];
      if (value) for (const child of Array.isArray(value) ? value : [value]) collect(field.type, child);
    }
  }
  collect(name, graph);
  const adapter = { provider: "postgres", adapterName: "slice3-read-only", connect: async () => ({
    provider: "postgres", adapterName: "slice3-read-only", dispose: async () => {},
    executeRaw: async () => { throw new Error("No fixture writes"); },
    queryRaw: async ({ sql }) => {
      queries.push(sql);
      if (sql.includes("LATERAL")) {
        const data = projection(name, graph, args);
        const keys = Object.keys(data);
        return { columnNames: keys, columnTypes: keys.map((key) => models.get(name).fields.find((field) => field.name === key).kind === "object" ? ColumnTypeEnum.Json : columnType(name, key)), rows: [keys.map((key) => data[key])] };
      }
      const columns = [...sql.split(" FROM ")[0].matchAll(/"public"\."(\w+)"\."(\w+)"/g)];
      assert.ok(columns.length, sql);
      const model = columns[0][1];
      const keys = columns.map(([, , key]) => key);
      return { columnNames: keys, columnTypes: keys.map((key) => columnType(model, key)), rows: (byModel.get(model) ?? []).map((row) => keys.map((key) => row[key])) };
    },
  }) };
  const client = new PrismaClient({ adapter });
  try {
    const delegate = name[0].toLowerCase() + name.slice(1);
    const result = await client[delegate].findMany({ ...args, relationLoadStrategy: strategy });
    return { json: json(result), count: queries.length };
  } finally { await client.$disconnect(); }
}

async function reportRun(before) {
  if (before) return reference("report");
  let args;
  const graph = { ...modelRow("TimeEntry", { id: 1, taskId: 50, userId: 7, startedAt: "2026-08-17T00:00:00.000Z", endedAt: "2026-08-17T00:01:00.000Z" }), task: { ...modelRow("Task", { id: 50, projectId: 15 }), project: modelRow("Project", { id: 15 }) }, user: modelRow("User", { id: 7 }) };
  const service = load("src/lib/timeTracking.ts", {
    "@/lib/prisma": { default: { timeEntry: { findMany: async (input) => { args = input; return json([graph]).map((row) => ({ ...row, startedAt: new Date(row.startedAt), endedAt: new Date(row.endedAt) })); } } } },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/pusher": {},
    "@/lib/timeTrackingInvalidation": {},
  });
  const body = await service.listReport(7);
  const planned = await plannedRead("TimeEntry", graph, args, args.relationLoadStrategy ?? "query");
  return { body: json(body), planned, args: { ...args, relationLoadStrategy: undefined } };
}
test("time report: exact query, JSON and real Prisma SQL count survive relation batching", async () => {
  const before = await reportRun(true);
  const after = await reportRun(false);
  assert.deepEqual(after.body, before.body);
  assert.deepEqual(json(after.args), before.args);
  assert.deepEqual(after.planned.json, before.planned.json);
  assert.equal(before.planned.count, 4);
  assert.equal(after.planned.count, 1);
  console.log(`time report SQL adapter calls: ${before.planned.count} -> ${after.planned.count}`);
});

async function loginRun(before, missing = false) {
  if (before) return reference("login", missing);
  let args;
  const effects = [];
  const graph = { ...modelRow("User", { id: 7, email: "fixture@example.invalid", UserSettingId: 70 }), UserSetting: modelRow("UserSetting", { id: 70, userId: 7, isVerified: true }), userPicture: modelRow("UserPicture", { id: 71, userId: 7 }) };
  const route = load("src/app/api/auth/verify-code/route.ts", {
    "@/lib/prisma": { default: {
      user: {
        findFirst: async () => ({ uid: "fixture", displayName: "Fixture" }),
        update: async (input) => { effects.push(["user", input]); },
        findUnique: async (input) => { args = input; return missing ? null : graph; },
      },
      userSetting: { update: async (input) => { effects.push(["setting", input]); } },
    } },
    "@/lib/services/verificationCodeService": { VerificationCodeService: { verifyCode: async () => "fixture@example.invalid" } },
    "@/utils/controllers/users/update_or_create_user": { default: async () => ({ status: 200, res: { user: { id: 7, email: "fixture@example.invalid", UserSetting: { id: 70 } }, isNewUser: false } }) },
    "@/lib/configs/auth.config": { default: { onboarding: { skipOnboarding: false } } },
    "@/utils/controllers/users/autoJoinByEmailDomain": { default: async (...input) => { effects.push(["auto-join", input]); } },
    "@/utils/controllers/users/completeOnboardingStep": {},
    "@/lib/constants/constants": {},
    "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => "https://fixture.invalid" },
    "@/lib/auth/session": { SESSION_COOKIE: "fixture-session", SESSION_TTL_SECONDS: 1, clearBetterAuthSessionCookies: () => {}, sessionCookieOptions: () => ({}), signSession: () => "synthetic-session" },
    "@/utils/controllers/demo/adoptGuestBoards": { adoptGuestBoards: async (...input) => { effects.push(["adopt", input]); } },
    "@/lib/auth/slimUserCookie": { slimUserForCookie: (user) => ({ id: user.id }) },
    "@/lib/auth/themeCookie": { seedResponseThemeCookie: () => {} },
    "@/lib/auth/emailCodeRateLimit": { getEmailCodeClientIp: () => "198.51.100.4", claimEmailCodeAttempt: async () => ({ ipAllowed: true, emailAllowed: true }) },
    "@/lib/telemetry/signupAnalytics": { signupAttributionFromHeaders: () => ({}) },
  });
  const originalFetch = global.fetch;
  const originalLog = console.log;
  global.fetch = async (url, input) => { effects.push(["self-fetch", url, input]); return { ok: false, status: 401 }; };
  console.log = () => {};
  let response;
  try {
    response = await route.POST({ json: async () => ({ code: "synthetic", email: "fixture@example.invalid" }), headers: new Headers(), cookies: { get: () => undefined } });
  } finally { global.fetch = originalFetch; console.log = originalLog; }
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(Object.hasOwn(body, "prevBoard"), false, "the legacy unauthenticated self-fetch must still yield no board");
  const planned = await plannedRead("User", graph, args, args.relationLoadStrategy ?? "query");
  return { body, cookies: response.headers.get("set-cookie").replace(/; Expires=[^;]+/g, "; Expires=<relative>"), effects: json(effects), planned, args: { ...args, relationLoadStrategy: undefined } };
}
for (const missing of [false, true]) test(`login refreshed user ${missing}: response, cookies and side-effect order match baseline`, async () => {
  const before = await loginRun(true, missing);
  const after = await loginRun(false, missing);
  assert.deepEqual(json({ ...after, planned: undefined }), json({ ...before, planned: undefined }));
  assert.deepEqual(after.planned.json, before.planned.json);
  assert.equal(before.planned.count, 3);
  assert.equal(after.planned.count, 1);
  console.log(`login refresh SQL adapter calls: ${before.planned.count} -> ${after.planned.count}`);
});

function treeDb(rows) {
  const calls = [];
  const selectRow = (row, select) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
  const matches = (row, where) => {
    assert.deepEqual(where.project, projectAccess);
    return row.accessible !== false && (typeof where.id !== "number" || row.id === where.id) && (!where.id?.in || where.id.in.includes(row.id)) && (typeof where.parentTaskId !== "number" || where.parentTaskId === row.parentTaskId) && (!where.parentTaskId?.in || where.parentTaskId.in.includes(row.parentTaskId)) && (!where.status?.not || row.status !== where.status.not);
  };
  return { calls, task: {
    findFirst: async ({ where, select }) => { calls.push("root"); const row = rows.find((candidate) => matches(candidate, where)); return row ? selectRow(row, select) : null; },
    findMany: async ({ where, select, orderBy }) => { calls.push("batch"); const result = rows.filter((row) => matches(row, where)); if (orderBy) result.sort((a, b) => (a.uniqueIndex ?? Infinity) - (b.uniqueIndex ?? Infinity)); return result.map((row) => selectRow(row, select)); },
  }, project: { findMany: async ({ where }) => { calls.push("project-access"); assert.deepEqual(where, projectAccess); return [{ id: 15 }]; } }, $queryRaw: async (sql) => {
    calls.push("subtree-ids");
    assert.match(sql.text, /WITH RECURSIVE/);
    const [rootId, maxDepth] = sql.values;
    const result = [];
    let level = [rootId];
    let hop = 0;
    while (level.length && (maxDepth === null || hop < maxDepth)) {
      const children = rows.filter((row) => row.status !== "Deleted" && row.accessible !== false && level.includes(row.parentTaskId));
      result.push(...children);
      level = children.map(({ id }) => id);
      hop++;
    }
    return result.sort((a, b) => (a.uniqueIndex ?? Infinity) - (b.uniqueIndex ?? Infinity));
  } };
}
for (const depth of [0, 1, 2, 2147483648, undefined]) test(`tree depth ${depth}: exact serialized shape, pruning and sibling order match baseline`, async () => {
  const rows = [
    { id: 1, parentTaskId: null, title: "Root", ticketNumber: null, uniqueIndex: 0, status: "Deleted" },
    { id: 3, parentTaskId: 1, title: "Later", ticketNumber: "T-3", uniqueIndex: 3, status: "Archive" },
    { id: 2, parentTaskId: 1, title: "First", ticketNumber: "T-2", uniqueIndex: 2, status: "Normal" },
    { id: 4, parentTaskId: 1, title: "Hidden", ticketNumber: null, uniqueIndex: 1, status: "Normal", accessible: false },
    { id: 5, parentTaskId: 4, title: "Behind hidden", ticketNumber: null, uniqueIndex: 5, status: "Normal" },
    { id: 6, parentTaskId: 2, title: "Deleted", ticketNumber: null, uniqueIndex: 6, status: "Deleted" },
    { id: 7, parentTaskId: 6, title: "Behind deleted", ticketNumber: null, uniqueIndex: 7, status: "Normal" },
    { id: 8, parentTaskId: 2, title: "Leaf", ticketNumber: "T-8", uniqueIndex: null, status: "Normal" },
  ];
  const results = [];
  for (const before of [true, false]) {
    if (before) { results.push(reference("tree", depth)); continue; }
    const db = treeDb(rows);
    const tree = load("src/lib/aiChat/taskTree.ts", { "@/lib/prisma": {} });
    results.push({ body: JSON.stringify(await tree.buildTaskTree(1, 7, depth, db)), count: db.calls.length });
    await assert.rejects(tree.buildTaskTree(999, 7, depth, db), { message: "Task not found in tree build" });
  }
  assert.equal(results[1].body, results[0].body);
  assert.equal(results[1].count, depth === 0 ? 1 : 2);
  console.log(`tree depth ${depth} delegate calls: ${results[0].count} -> ${results[1].count}`);
});
test("50-node deep tree retains JSON and has a constant read budget", async () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, parentTaskId: index ? index : null, title: `Task ${index}`, ticketNumber: null, uniqueIndex: index, status: "Normal" }));
  const results = [];
  for (const before of [true, false]) {
    if (before) { results.push(reference("deepTree")); continue; }
    const db = treeDb(rows);
    const tree = load("src/lib/aiChat/taskTree.ts", { "@/lib/prisma": {} });
    results.push({ body: JSON.stringify(await tree.buildTaskTree(1, 7, undefined, db)), count: db.calls.length });
  }
  assert.equal(results[1].body, results[0].body);
  assert.equal(results[0].count, 51);
  assert.equal(results[1].count, 2);
  console.log(`50-node chain delegate calls: ${results[0].count} -> ${results[1].count}`);
});

test("guest safety join uses one real Prisma SQL statement instead of two scalar reads", async () => {
  const before = await guestRun(true, "guest_fixture");
  const after = await guestRun(false, "guest_fixture");
  const owner = modelRow("User", { id: 7, uid: "guest_fixture" });
  const graph = { ...modelRow("Project", { id: 15, ownerId: 7 }), owner };
  const original = await plannedRead("Project", graph, before.projectArgs, "query");
  const originalOwner = await plannedRead("User", owner, { select: { uid: true } }, "query");
  const batched = await plannedRead("Project", graph, after.projectArgs, after.projectArgs.relationLoadStrategy);
  assert.equal(original.count + originalOwner.count, 2);
  assert.equal(batched.count, 1);
  assert.equal(batched.json[0].owner.uid, originalOwner.json[0].uid);
  console.log("guest project ownership SQL adapter calls: 2 -> 1");
});

async function agentDetailRead(before) {
  if (before) return reference("agentDetail");
  let args;
  const stop = new Error("fixture captured selected read");
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const route = load("src/app/api/agents/[agentId]/route.ts", {
    "@/lib/prisma": { default: { agent: {
      findMany: async () => [{ id, displayName: "Fixture", createdAt: new Date("2026-01-01") }],
      findFirst: async (input) => { args = input; throw stop; },
    } } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 7 }) },
    "@/lib/mcp/auth": {}, "@/lib/aiModelOptions": {}, "@/lib/agents/working": {},
    "@/lib/agents/runtimeState": {}, "@/lib/mcp/agents/ownedAgents": {},
    "@/lib/agents/boardAccess": {}, "@/lib/agents/visibility": {},
  });
  await assert.rejects(route.GET({ headers: new Headers() }, { params: Promise.resolve({ agentId: id }) }), stop);
  const graph = { ...modelRow("Agent", { id, userId: 7 }), members: [{ ...modelRow("Member", { id: 90, agentId: id, projectId: 15 }), project: { ...modelRow("Project", { id: 15, teamId: "fixture-team" }), team: modelRow("Team", { id: "fixture-team" }) } }] };
  return { args: { ...args, relationLoadStrategy: undefined }, planned: await plannedRead("Agent", graph, args, args.relationLoadStrategy ?? "query") };
}
test("agent detail: identical projected membership/board/team JSON uses one Prisma SQL read", async () => {
  const before = await agentDetailRead(true);
  const after = await agentDetailRead(false);
  assert.deepEqual(json(after.args), before.args);
  assert.deepEqual(after.planned.json, before.planned.json);
  assert.equal(before.planned.count, 4);
  assert.equal(after.planned.count, 1);
  console.log("agent detail selected SQL adapter calls: 4 -> 1");
});
