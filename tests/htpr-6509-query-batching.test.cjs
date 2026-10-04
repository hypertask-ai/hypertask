const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Prisma, PrismaClient } = require("@prisma/client");
const { ColumnTypeEnum } = require("@prisma/driver-adapter-utils");
const { load } = require("./task-route-loader.cjs");

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
const contractFile = path.join(__dirname, "htpr-6509-query-contracts.json");
const contracts = JSON.parse(fs.readFileSync(contractFile, "utf8"));
const serialize = (value) => JSON.parse(JSON.stringify(value));

function row(modelName, overrides = {}) {
  const fields = models.get(modelName).fields.filter((field) => field.kind !== "object" && !field.isIgnored);
  return Object.fromEntries(fields.map((field) => {
    let value;
    if (Object.hasOwn(overrides, field.name)) value = field.type === "String" && overrides[field.name] != null ? String(overrides[field.name]) : overrides[field.name];
    else if (field.isList) value = [];
    else if (!field.isRequired) value = null;
    else if (field.type === "Int") value = 1;
    else if (field.type === "Boolean") value = false;
    else if (field.type === "DateTime") value = "2026-08-17T00:00:00.000Z";
    else if (field.type === "Json") value = { fixture: true };
    else if (field.kind === "enum") value = Prisma.dmmf.datamodel.enums.find(({ name }) => name === field.type).values[0].name;
    else value = `fixture-${field.name}`;
    return [field.name, value];
  }));
}

const user = row("User", { id: 7, UserSettingId: 70, displayName: "Fixture User" });
const setting = row("UserSetting", { id: 70, userId: 7 });
const project = row("Project", { id: 15, ownerId: 7, status: "Normal" });
const task = row("Task", { id: 50, projectId: 15, userId: 7, status: "Normal" });
const page = row("Page", { id: 60, taskId: 50, projectId: 15, publicId: "fixture-page" });
const childPage = row("Page", { id: 61, taskId: 50, projectId: 15, parentPageId: 60, publicId: "fixture-child" });
const session = row("ChatSession", { id: 80, userId: 7 });
const message = row("ChatMessage", { id: 81, sessionId: 80, authorAgentId: "fixture-agent" });
const agent = row("Agent", { id: "fixture-agent", userId: 7, displayName: "Fixture Agent" });

function graph(name) {
  switch (name) {
    case "sessions": return [{ ...session, messages: [{ ...message, attachments: [row("Attachment", { id: 82, chatMessageId: 81 })], authorAgent: agent }] }];
    case "favorites": return [{ ...row("Favorites", { id: 90, projectId: 15, userSettingId: 70 }), project: { ...project, owner: user, members: [{ ...row("Member", { id: 91, projectId: 15, userId: 7, agentId: agent.id }), user, agent }] } }];
    case "user": return [{ ...user, UserSetting: setting }];
    case "page": return [{ ...page, task, subPages: [childPage] }];
    case "project": return [{ ...project, tasks: [{ ...task, assignees: [{ ...row("Assignees", { id: 92, taskId: 50, userId: 7 }), user }] }], section: [row("Section", { id: 93, projectId: 15, deleted: false, visibility: true })], owner: user, ai_custom_instructions: [row("AI_Custom_Instructions", { id: 94, projectId: 15 })] }];
    default: throw new Error(`Unknown fixture: ${name}`);
  }
}

function projectRow(modelName, data, args) {
  const selected = args.select ?? Object.fromEntries(models.get(modelName).fields
    .filter((field) => field.kind !== "object" && !field.isIgnored).map((field) => [field.name, true]));
  const selection = { ...selected, ...args.include };
  return Object.fromEntries(Object.entries(selection).filter(([, enabled]) => enabled).map(([key, select]) => {
    const field = models.get(modelName).fields.find((candidate) => candidate.name === key);
    const value = data[key];
    if (field.kind !== "object" || value == null) return [key, value];
    const relationArgs = select === true ? {} : select;
    return [key, Array.isArray(value)
      ? value.map((item) => projectRow(field.type, item, relationArgs))
      : projectRow(field.type, value, relationArgs)];
  }));
}

// The generated Prisma planner runs against a read-only synthetic adapter.
// No connection string, database connection, or real row is used.
function fixtureAdapter(name, queryArgs, empty = false) {
  const queries = [];
  const roots = empty ? [] : graph(name);
  const modelName = { sessions: "ChatSession", favorites: "Favorites", user: "User", page: "Page", project: "Project" }[name];
  const byModel = new Map();
  function collect(model, data) {
    const list = byModel.get(model) ?? [];
    if (!list.some((candidate) => candidate.id === data.id)) list.push(data);
    byModel.set(model, list);
    for (const field of models.get(model).fields.filter((field) => field.kind === "object")) {
      const value = data[field.name];
      if (value) for (const item of Array.isArray(value) ? value : [value]) collect(field.type, item);
    }
  }
  roots.forEach((data) => collect(modelName, data));
  const adapter = {
    provider: "postgres",
    adapterName: "synthetic-relation-fixture",
    connect: async () => ({
      provider: "postgres",
      adapterName: "synthetic-relation-fixture",
      dispose: async () => {},
      executeRaw: async () => { throw new Error("Fixture writes are forbidden"); },
      queryRaw: async ({ sql }) => {
        queries.push(sql);
        if (sql.includes("LATERAL")) {
          const projected = graph(name).map((data) => projectRow(modelName, data, queryArgs()));
          const names = Object.keys(projected[0]);
          return { columnNames: names, columnTypes: names.map((key) => models.get(modelName).fields.find((field) => field.name === key).kind === "object" ? ColumnTypeEnum.Json : columnType(modelName, key)), rows: empty ? [] : projected.map((data) => names.map((key) => data[key])) };
        }
        const columns = [...sql.split(" FROM ")[0].matchAll(/"public"\."(\w+)"\."(\w+)"/g)];
        assert.ok(columns.length > 0, sql);
        const model = columns[0][1];
        const names = columns.map(([, , key]) => key);
        let rows = byModel.get(model) ?? [];
        if (name === "page" && model === "Page") rows = rows.filter((data) => /WHERE "public"\."Page"\."parentPageId" (?:IN|=)/.test(sql) ? data.id === 61 : data.id === 60);
        return { columnNames: names, columnTypes: names.map((key) => columnType(model, key)), rows: rows.map((data) => names.map((key) => data[key])) };
      },
    }),
  };
  return { adapter, queries };
}

function columnType(model, key) {
  const field = models.get(model).fields.find((candidate) => candidate.name === key);
  if (field.isList) return field.type === "Int" ? ColumnTypeEnum.Int32Array : ColumnTypeEnum.TextArray;
  if (field.type === "Int") return ColumnTypeEnum.Int32;
  if (field.type === "Boolean") return ColumnTypeEnum.Boolean;
  if (field.type === "DateTime") return ColumnTypeEnum.DateTime;
  if (field.type === "Json") return ColumnTypeEnum.Json;
  return ColumnTypeEnum.Text;
}

async function run(name, strategy, empty = false) {
  let args;
  const fixture = fixtureAdapter(name, () => args, empty);
  const client = new PrismaClient({ adapter: fixture.adapter });
  const delegate = { sessions: "chatSession", favorites: "favorites", user: "user", page: "page", project: "project" }[name];
  const method = { sessions: "findMany", favorites: "findMany", user: "findUnique", page: "findUnique", project: "findFirst" }[name];
  const database = { [delegate]: { [method]: (input) => {
    args = input;
    return client[delegate][method]({ ...input, relationLoadStrategy: strategy ?? input.relationLoadStrategy ?? "query" });
  } } };
  const profile = { id: 7, displayName: "Fixture User", email: "fixture@example.invalid", UserSetting: {} };
  const mocks = {
    "@/lib/prisma": { default: database },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 7 }) },
    "next/headers": { cookies: async () => ({ get: () => ({ value: JSON.stringify(profile) }) }) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
    "@/utils/helperFunctions/markdownToHtml": {},
    "@/utils/helperFunctions/sanitizeRichHtml": {},
  };
  try {
    let result;
    if (name === "sessions") {
      const route = load("src/app/api/ai-chat/all-sessions/route.ts", mocks);
      result = await route.GET({ headers: new Headers() });
      assert.equal(result.status, 200);
      result = await result.json();
    } else if (name === "favorites") result = await load("src/utils/controllers/favorites/getAll.ts", mocks).getFavoritesForUser(7);
    else if (name === "user") result = await load("src/utils/controllers/users/getById.ts", mocks).default(7);
    else if (name === "page") result = await load("src/utils/controllers/pages/pageService.ts", mocks).getPage({ publicId: "fixture-page" });
    else result = await load("src/utils/controllers/projects/detail.ts", mocks).default(15);
    if (!empty && name === "user") {
      assert.equal(result.status, 200);
      assert.equal(result.res.id, 7, "query errors must not pass as the controller fallback");
    }
    if (!empty && name === "project") {
      assert.equal(result.status, 200, "query errors must not pass as the controller fallback");
      assert.equal(result.json.id, 15);
    }
    assert.ok(args, "the production query must be reached");
    const { relationLoadStrategy: ignored, ...contractArgs } = args;
    return { json: serialize(result), args: serialize(contractArgs), queries: fixture.queries };
  } finally {
    await client.$disconnect();
  }
}

for (const name of ["sessions", "favorites", "user", "page", "project"]) {
  test(`${name}: exact baseline selection and JSON survive relation batching`, async () => {
    const before = await run(name, "query");
    const after = await run(name);
    assert.deepEqual(before.args, contracts[name].args);
    assert.deepEqual(after.args, contracts[name].args);
    assert.deepEqual(before.json, contracts[name].json);
    assert.deepEqual(after.json, contracts[name].json);
    assert.equal(before.queries.length, contracts[name].queryCount);
    assert.ok(before.queries.length > 1);
    assert.equal(after.queries.length, 1);
    assert.match(after.queries[0], /LEFT JOIN LATERAL/);
    console.log(`${name} SQL adapter calls: ${before.queries.length} -> ${after.queries.length}; JSON identical`);
  });
}

test("empty and missing relation roots keep the legacy return values", async () => {
  assert.deepEqual((await run("favorites", undefined, true)).json, []);
  assert.deepEqual((await run("user", undefined, true)).json, { status: 200, res: null });
  assert.equal((await run("page", undefined, true)).json, null);
  assert.deepEqual((await run("project", undefined, true)).json, { status: 400, json: { message: "Project not found" } });
});

function sessionRoute({ cookie, rows = [], fail = false, sessionUserId = 7 } = {}) {
  const calls = [];
  const created = { id: "new-session", userId: 7, messages: [] };
  const profile = { id: 7, displayName: "Fixture User", email: "fixture@example.invalid", UserSetting: {} };
  const route = load("src/app/api/ai-chat/all-sessions/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => cookie === undefined ? { value: JSON.stringify(profile) } : cookie }) },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => sessionUserId == null ? null : ({ userId: sessionUserId }) },
    "@/lib/prisma": { default: { chatSession: {
      findMany: async (args) => { calls.push({ operation: "findMany", args }); if (fail) throw new Error("fixture failure"); return [...rows]; },
      create: async (args) => { calls.push({ operation: "create", args }); return created; },
    } } },
  });
  return { route, calls, created };
}

for (const cookie of [null, { value: "" }, { value: "{" }, { value: "{}" }]) {
  test(`session list unauthorized cookie ${JSON.stringify(cookie)} keeps its 401 body and makes no query`, async () => {
    const { route, calls } = sessionRoute({ cookie });
    const response = await route.GET({ headers: new Headers() });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
    assert.deepEqual(calls, []);
  });
}

for (const sessionUserId of [null, 8]) {
  test(`shared session loader enforces the existing proxy identity invariant for ${sessionUserId}`, async () => {
    const { route, calls } = sessionRoute({ sessionUserId });
    const response = await route.GET({ headers: new Headers() });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
    assert.deepEqual(calls, []);
  });
}

test("empty session list still creates and returns one session with the same include", async () => {
  const { route, calls, created } = sessionRoute();
  const response = await route.GET({ headers: new Headers() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, sessions: [created] });
  assert.deepEqual(calls.map(({ operation }) => operation), ["findMany", "create"]);
  assert.deepEqual(calls[1].args, {
    data: { userId: 7 },
    include: contracts.sessions.args.include,
  });
});

test("session database failure retains the 500 response", async () => {
  const { route, calls } = sessionRoute({ fail: true });
  const response = await route.GET({ headers: new Headers() });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: "Internal server error" });
  assert.equal(calls.length, 1);
});
