const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Prisma, PrismaClient } = require("@prisma/client");
const { ColumnTypeEnum } = require("@prisma/driver-adapter-utils");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function hasInlineIdentity(source) {
  return /getSessionUser|isValidUser|cookies\(\)|nookies_user/.test(source);
}

test("every existing App Router task route uses the single loader and the shared access predicate", () => {
  assert.equal(hasInlineIdentity("const user = isValidUser(cookie)"), true);
  const routes = walk(path.join(root, "src/app/api/tasks")).filter((file) => file.endsWith("/route.ts"));
  assert.equal(routes.length, 3);
  for (const file of routes) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(hasInlineIdentity(source), false, file);
    assert.match(source, /loadCurrentUser\(/);
    assert.match(source, /taskAccessWhere\(/);
    assert.match(source, /unauthorized\(\)/);
    assert.match(source, /jsonError\(/);
    assert.doesNotMatch(source, /request\.json\(/);
    if (source.includes("export async function POST")) assert.match(source, /readJsonBody</);
  }
  assert.match(read("src/pages/api/tasks/getAll.ts"), /loadCurrentUser\(/);
});

test("there are no same-URL Pages task twins eligible for deletion", () => {
  const appPaths = new Set(walk(path.join(root, "src/app/api/tasks"))
    .filter((file) => file.endsWith("/route.ts"))
    .map((file) => path.relative(path.join(root, "src/app/api/tasks"), path.dirname(file))));
  const twins = walk(path.join(root, "src/pages/api/tasks"))
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => appPaths.has(path.relative(path.join(root, "src/pages/api/tasks"), file).replace(/\.ts$/, "")));
  assert.deepEqual(twins, []);
  assert.equal(appPaths.has("cycle"), true);
});

test("shared current-user loader preserves session-only and legacy-profile preconditions", async () => {
  let cookie;
  let session = { userId: 7 };
  let sessionCalls = 0;
  const { loadCurrentUser } = load("src/lib/auth/currentUser.ts", {
    "next/headers": { cookies: async () => ({ get: (name) => { assert.equal(name, "nookies_user"); return cookie; } }) },
    "@/lib/auth/getSessionUser": { getSessionUser: async (headers) => {
      assert.equal(headers.get("x-test"), "current-user");
      sessionCalls++;
      return session;
    } },
  });
  const headers = new Headers({ "x-test": "current-user" });
  assert.deepEqual(await loadCurrentUser(headers), { userId: 7 });
  session = null;
  assert.equal(await loadCurrentUser(headers), null);
  assert.equal(await loadCurrentUser(headers, true), null);
  session = { userId: 7 };
  for (const value of ["{", "null", "{}", '{"id":7}', '{"id":7,"displayName":"User"}']) {
    cookie = { value };
    assert.equal(await loadCurrentUser(headers, true), null);
  }
  cookie = { value: JSON.stringify({ id: 7, displayName: "User", email: "test@example.invalid", UserSetting: { notificationPreference: "all" } }) };
  assert.deepEqual(await loadCurrentUser(headers, true), { userId: 7, user: { ...JSON.parse(cookie.value), notificationPreference: "all" } });
  session = { userId: 8 };
  assert.equal(await loadCurrentUser(headers, true), null);
  session = null;
  assert.equal(await loadCurrentUser(headers, true), null);
  assert.equal(sessionCalls, 11);
});

test("positive-integer helper preserves task path, cycle range, and legacy version-number rules", () => {
  const { parsePositiveInt } = load("src/lib/parsePositiveInt.ts", {});
  for (const value of [null, undefined, true, [], {}, "", " 7", "7 ", "7x", "7.1", "-1", "1e2", 0, -1, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parsePositiveInt(value), null);
  }
  assert.equal(parsePositiveInt("007"), 7);
  assert.equal(parsePositiveInt(7), 7);
  assert.equal(parsePositiveInt("2147483647", { max: 2147483647 }), 2147483647);
  assert.equal(parsePositiveInt("2147483648", { max: 2147483647 }), null);
  assert.equal(parsePositiveInt(9007199254740992, { safe: false, max: Infinity }), 9007199254740992);
});

test("the shared access predicate does not add queries or change archived, teamless, or agent scope", async () => {
  const calls = [];
  const { taskAccessWhere, userCanAccessTask, userCanAccessTaskContent } = load("src/utils/controllers/tasks/assertTaskAccess.ts", {
    "@/lib/prisma": { default: { task: { findFirst: async (args) => { calls.push(args); return { id: 50 }; } } } },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: (userId, agentId) => ({ teamId: { not: null }, userId, agentId }),
      taskWriteAccessWhere: (userId, agentId) => ({ contentAccess: userId, agentId }),
    },
  });
  assert.deepEqual(taskAccessWhere(7, 50), { id: 50, project: { teamId: { not: null }, userId: 7, agentId: undefined } });
  assert.deepEqual(taskAccessWhere(7, 50, { scope: "content", taskStatus: "Normal", projectStatus: "Normal" }), { id: 50, status: "Normal", project: { status: "Normal", contentAccess: 7, agentId: undefined } });
  assert.equal(calls.length, 0);
  assert.equal(await userCanAccessTask(7, 0), false);
  assert.equal(await userCanAccessTaskContent(7, -1), false);
  assert.equal(calls.length, 0);
  assert.equal(await userCanAccessTask(7, 50, "agent-1"), true);
  assert.equal(await userCanAccessTaskContent(7, 50), true);
  assert.deepEqual(calls.map(({ select }) => select), [{ id: true }, { id: true }]);
  assert.deepEqual(calls[0].where.project, { teamId: { not: null }, userId: 7, agentId: "agent-1" });
  assert.deepEqual(calls[1].where.project, { contentAccess: 7, agentId: undefined });
});

// Exercise Prisma's actual SQL planner without connecting to any database.
const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
function scalarRow(modelName, overrides) {
  const row = Object.fromEntries(models.get(modelName).fields.filter((field) => field.kind !== "object" && !field.isIgnored).map((field) => {
    let value;
    if (field.isList) value = [];
    else if (!field.isRequired) value = null;
    else if (field.type === "Int") value = 1;
    else if (field.type === "Boolean") value = false;
    else if (field.type === "DateTime") value = "2026-08-17T00:00:00.000Z";
    else if (field.kind === "enum") value = Prisma.dmmf.datamodel.enums.find(({ name }) => name === field.type).values[0].name;
    else value = "fixture";
    return [field.name, value];
  }));
  return { ...row, ...overrides };
}

function fixtureAdapter() {
  const queries = [];
  const task = scalarRow("Task", { id: 50, projectId: 15, userId: 7, parentTaskId: 49, status: "Normal" });
  const child = scalarRow("Task", { id: 51, parentTaskId: 50, status: "Normal" });
  const parent = scalarRow("Task", { id: 49, parentTaskId: null, status: "Normal" });
  const user = scalarRow("User", { id: 7 });
  const joined = {
    ...Object.fromEntries(["id", "title", "uniqueIndex", "ranking", "userId", "projectId", "section", "sectionId", "createdAt", "sectionChangedAt", "lastCommentAt"].map((key) => [key, task[key]])),
    assignees: [{ user }],
    comments: [{ id: 21, notifications: [{ id: 22 }] }],
    subTasks: [child],
    parentTask: { ...parent, subTasks: [task] },
  };
  const adapter = {
    provider: "postgres",
    adapterName: "synthetic-task-fixture",
    connect: async () => ({
      provider: "postgres",
      adapterName: "synthetic-task-fixture",
      dispose: async () => {},
      executeRaw: async () => { throw new Error("Writes are forbidden in this fixture"); },
      queryRaw: async ({ sql }) => {
        queries.push(sql);
        if (sql.includes("LATERAL")) {
          const keys = Object.keys(joined);
          return { columnNames: keys, columnTypes: keys.map((key) => typeof joined[key] === "object" && joined[key] !== null ? ColumnTypeEnum.Json : ColumnTypeEnum.Text), rows: [keys.map((key) => joined[key])] };
        }
        const select = sql.split(" FROM ")[0];
        const columns = [...select.matchAll(/"public"\."(\w+)"\."(\w+)"/g)];
        assert.ok(columns.length > 0, sql);
        const modelName = columns[0][1];
        let row;
        if (modelName === "Task") {
          if (sql.includes('"parentTaskId" IN')) row = sql.includes('ORDER BY') ? child : task;
          else if (sql.includes('"id" IN')) row = parent;
          else row = task;
        } else if (modelName === "Assignees") row = scalarRow("Assignees", { id: 20, taskId: 50, userId: 7 });
        else if (modelName === "User") row = user;
        else if (modelName === "Comment") row = { id: 21, taskId: 50 };
        else if (modelName === "Notification") row = { id: 22, commentId: 21 };
        else throw new Error(`Unexpected fixture model: ${modelName}`);
        const names = columns.map(([, , name]) => name);
        const fields = models.get(modelName).fields;
        const types = names.map((name) => {
          const field = fields.find((candidate) => candidate.name === name);
          if (field.isList) return ColumnTypeEnum.Int32Array;
          if (field.type === "Int") return ColumnTypeEnum.Int32;
          if (field.type === "Boolean") return ColumnTypeEnum.Boolean;
          if (field.type === "DateTime") return ColumnTypeEnum.DateTime;
          if (field.type === "Json") return ColumnTypeEnum.Json;
          return ColumnTypeEnum.Text;
        });
        return { columnNames: names, columnTypes: types, rows: [names.map((name) => row[name])] };
      },
    }),
  };
  return { adapter, queries };
}

test("getAll batches nested relations into one SQL call and retains every response field", async () => {
  async function run(strategy) {
    const { adapter, queries } = fixtureAdapter();
    const client = new PrismaClient({ adapter });
    const controller = load("src/utils/controllers/tasks/getAll.ts", {
      "@/lib/prisma": { default: { task: { findMany: (args) => {
        assert.deepEqual(Object.keys(args.select), ["id", "title", "uniqueIndex", "ranking", "userId", "projectId", "section", "sectionId", "createdAt", "sectionChangedAt", "lastCommentAt", "assignees", "comments", "subTasks", "parentTask"]);
        assert.deepEqual(args.select.subTasks, { where: { status: { not: "Deleted" } }, orderBy: { createdAt: "asc" } });
        assert.deepEqual(args.select.parentTask, { include: { subTasks: { where: { status: { not: "Deleted" } } } } });
        assert.deepEqual(args.select.assignees.select, { user: true });
        assert.deepEqual(args.select.comments, { select: { id: true, notifications: { select: { id: true }, where: { seen: false, userId: 7 } } } });
        assert.deepEqual(args.orderBy, { ranking: "asc" });
        return client.task.findMany({ ...args, ...(strategy ? { relationLoadStrategy: strategy } : {}) });
      } } } },
      "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({ ownerId: 7 }) },
      "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({ userId: 7 }) },
    }).default;
    try {
      const result = await controller(15, 7);
      assert.equal(result.status, 200);
      assert.equal(result.json.length, 1, "Prisma planner errors must not be masked by the controller's empty-list fallback");
      return { json: JSON.parse(JSON.stringify(result.json)), queries };
    } finally {
      await client.$disconnect();
    }
  }
  const before = await run("query");
  const after = await run();
  assert.deepEqual(after.json, before.json);
  assert.ok(before.queries.length > after.queries.length);
  assert.equal(after.queries.length, 1);
  assert.match(after.queries[0], /LEFT JOIN LATERAL/);
  assert.match(after.queries[0], /"ownerId" =/);
  assert.match(after.queries[0], /"status" <>/);
  console.log(`getAll synthetic SQL round trips: ${before.queries.length} -> ${after.queries.length}; JSON identical`);
});
