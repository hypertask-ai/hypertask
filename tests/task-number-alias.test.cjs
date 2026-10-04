const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const oldSlug = { projectId: 15, uniqueIndex: 6641 };
const currentTask = {
  id: 44769, projectId: 20, uniqueIndex: 6814, ticketNumber: "NEW-6814", status: "Normal",
  project: { id: 20, status: "Normal", ownerId: 6, members: [] },
};

function load(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (Object.hasOwn(stubs, request)) return stubs[request];
    if (["@prisma/client", "react", "react/jsx-runtime"].includes(request)) return require(request);
    throw new Error(`Unexpected dependency: ${request}`);
  };
  loaded._compile(javascript, filename);
  return loaded.exports;
}

function fixture({ tasks = [currentTask], visibleProjects = [20], agentId = null, aliases } = {}) {
  aliases ??= [{ ...oldSlug, ticketNumber: "HTPR-6641", task: tasks[0] }];
  let aliasQueries = 0;
  function matches(row, where) {
    if (!row) return false;
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some(condition => matches(row, condition));
      if (key === "project") {
        if (value.visibleProjects) return value.visibleProjects.includes(row.projectId);
        return matches(row.project, value);
      }
      if (key === "members") return row.members.some(member => matches(member, value.some));
      if (key === "task") return matches(row.task, value);
      if (value && typeof value === "object") {
        if (value.in) return value.in.includes(row[key]);
        if (Object.hasOwn(value, "equals")) return value.mode === "insensitive" ? row[key]?.toUpperCase() === value.equals.toUpperCase() : row[key] === value.equals;
        if (value.not) return row[key] !== value.not;
      }
      return row[key] === value;
    });
  }
  const prisma = {
    task: {
      findMany: async ({ where, select, take }) => {
        const rows = tasks.filter(task => matches(task, where));
        return (take ? rows.slice(0, take) : rows).map(task => select
          ? Object.fromEntries(Object.keys(select).map(key => [key, task[key]])) : task);
      },
      findFirst: async ({ where }) => tasks.find(task => matches(task, where)) ?? null,
    },
    projectPrefixAlias: { findMany: async () => [] },
    taskNumberAlias: {
      findMany: async ({ where, select }) => {
        aliasQueries++;
        return aliases.filter(alias => matches(alias, where)).map(alias => ({
          ...alias,
          task: Object.fromEntries(Object.keys(select.task.select).map(key => [key, alias.task[key]])),
        }));
      },
      findUnique: async ({ where }) => {
        aliasQueries++;
        return aliases.find(alias => matches(alias, where.projectId_uniqueIndex)) ?? null;
      },
    },
  };
  const base = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: (userId, requestedAgentId) => {
        assert.equal(userId, 6);
        assert.equal(requestedAgentId ?? null, agentId);
        return { visibleProjects };
      },
    },
  };
  base["@/utils/controllers/projects/findPrefixAliasTasks"] = load("src/utils/controllers/projects/findPrefixAliasTasks.ts", base);
  const resolver = load("src/lib/mcp/tasks/resolveTask.ts", {
    ...base,
    "@/lib/flags": { HTPR_6868_TICKET_PREFIX_FLAG: "htpr-6868-ticket-prefix", isFeatureEnabled: async () => true },
  });
  base["@/lib/mcp/tasks/resolveTask"] = resolver;
  const detail = load("src/utils/controllers/taskDetail/load.ts", {
    ...base,
    "@vercel/functions": {},
    "@/lib/realtime/server": {},
    "@/lib/cycles": {},
    "@/lib/pullRequests/taskPullRequests": {},
    "@/lib/agents/publicAgent": {},
    "@/lib/flags": {},
    "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
  });
  const { GET } = load("src/lib/mcp/operations/tasks/operation.ts", {
    ...base,
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId }),
    },
    "@/lib/mcp/agents": {},
    "@/lib/agents/visibility": {},
    "@/lib/mcp/tasks/mappers": {
      taskMcpGetInclude: () => ({}),
      mapTaskToMcpGetResponse: task => ({ id: task.id, projectId: task.projectId, ticketNumber: task.ticketNumber }),
    },
    "@/lib/mcp/tasks/resolveTask": resolver,
    "@/lib/mcp/pagination/cursor": {},
    "@/lib/flags": {},
    "@/lib/mcp/listQuery": {},
    "@/lib/mcp/readListQuery": {},
    "@/lib/mcp/priorityFilter": {},
  });
  const page = load("src/app/detail/[...slug]/page.tsx", {
    ...base,
    "./TaskDetailComp": {},
    "@/utils/controllers/taskDetail/load": {
      ...detail, fetchTaskDetail: async () => null, fetchCommentsForSlug: async () => [],
    },
    "@/lib/auth/serverUser": { requireServerCookieUser: async () => ({ id: 6 }) },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "next/navigation": { redirect: url => { throw new Error(`REDIRECT ${url}`); } },
    "@/lib/contexts/TaskDetail/TaskProvider": {},
    "@/lib/contexts/TaskDetail/FollowersProvider": {},
    "@/utils/helperFunctions/TaskDetail": {},
    "@/utils/controllers/users/fetch_preferences": { fetchUserPreferenceController: async () => ({}) },
    "@/utils/controllers/tasks/markRead": {},
    "@/utils/controllers/comments/readReceipts": {},
    "@/lib/agentRuns/service": {},
    "../../unauthorized/page": { __esModule: true, default: "Unauthorized" },
  }).default;
  return {
    resolver, detail, page, aliasQueries: () => aliasQueries,
    get: query => GET({ nextUrl: { searchParams: new URLSearchParams(query) } }),
  };
}

test("old ticket and project/index identifiers resolve the task in its current board", async () => {
  const { resolver } = fixture();
  for (const options of [
    { ticket_number: "HTPR-6641" },
    { ticket_number: "HTPR-6641", project_id: 15 },
    { unique_index: 6641, project_id: 15 },
  ]) {
    assert.deepEqual(await resolver.findTaskByIdentifier({ id: 6 }, options), { id: 44769, projectId: 20 });
  }
});

test("a live task with the old number wins over its alias", async () => {
  const live = { ...currentTask, id: 99, ...oldSlug, ticketNumber: "HTPR-6641" };
  const f = fixture({ tasks: [currentTask, live], visibleProjects: [15, 20] });
  assert.equal((await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" })).id, 99);
  assert.equal(f.aliasQueries(), 0);
  assert.equal(await f.detail.findTaskNumberAlias(oldSlug, 6), null);
  assert.equal(f.aliasQueries(), 0);
});

test("an inaccessible live number never falls back to an accessible alias", async () => {
  const live = { ...currentTask, id: 99, ...oldSlug, ticketNumber: "HTPR-6641" };
  const f = fixture({ tasks: [currentTask, live] });
  assert.equal(await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" }), null);
  assert.equal(await f.detail.findTaskNumberAlias(oldSlug, 6), null);
  assert.equal(f.aliasQueries(), 0);
});

test("a reused project/index blocks an alias even after the board prefix changes", async () => {
  const reused = { ...currentTask, id: 99, ...oldSlug, ticketNumber: "RENAMED-6641" };
  const f = fixture({ tasks: [currentTask, reused] });
  assert.equal(await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" }), null);
  assert.equal(await f.detail.findTaskNumberAlias(oldSlug, 6), null);
  assert.equal((await f.get({ ticket_number: "HTPR-6641" })).status, 404);
});

test("unknown old references remain not found", async () => {
  const f = fixture({ aliases: [] });
  assert.equal(await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" }), null);
  assert.equal(await f.detail.findTaskNumberAlias(oldSlug, 6), null);
  assert.equal((await f.get({ ticket_number: "HTPR-6641" })).status, 404);
});

test("access to the old board does not grant access to an alias destination", async () => {
  const f = fixture({ visibleProjects: [15], tasks: [{ ...currentTask, project: { ...currentTask.project, ownerId: 9 } }] });
  assert.equal(await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" }), null);
  assert.equal(await f.detail.findTaskNumberAlias(oldSlug, 6), null);
  assert.equal((await f.get({ ticket_number: "HTPR-6641" })).status, 404);
});

test("agent aliases require access to the current board, not the old one", async () => {
  for (const [visibleProjects, expected] of [[[20], 44769], [[15], null]]) {
    const f = fixture({ agentId: "agent-1", visibleProjects });
    const task = await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" }, "agent-1");
    assert.equal(task?.id ?? null, expected);
  }
});

for (const [name, task] of [
  ["deleted task", { ...currentTask, status: "Deleted" }],
  ["deleted destination board", { ...currentTask, project: { ...currentTask.project, status: "Deleted" } }],
]) {
  test(`${name} is not exposed through an alias`, async () => {
    const f = fixture({ tasks: [task] });
    if (task.status === "Deleted") {
      assert.equal(await f.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" }), null);
    }
    assert.equal(await f.detail.findTaskNumberAlias(oldSlug, 6), null);
  });
}

test("CLI get returns the current ticket number for an old reference scoped to its old board", async () => {
  const f = fixture();
  const response = await f.get({ ticket_number: "HTPR-6641", project_id: "15" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.tasks, [{ id: 44769, projectId: 20, ticketNumber: "NEW-6814" }]);
  const byIndex = await f.get({ unique_index: "6641", project_id: "15" });
  assert.deepEqual(byIndex.body.tasks, response.body.tasks);
});

test("CLI get fills missing aliases in a batch and deduplicates the current task", async () => {
  const live = { ...currentTask, id: 99, uniqueIndex: 2, ticketNumber: "NEW-2" };
  const f = fixture({ tasks: [currentTask, live] });
  const response = await f.get({ ticket_number: "NEW-2,HTPR-6641,NEW-6814" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.tasks.map(task => task.id).sort((a, b) => a - b), [99, 44769]);
});

test("CLI get returns a live task rather than the old-number alias", async () => {
  const live = { ...currentTask, id: 99, ...oldSlug, ticketNumber: "HTPR-6641" };
  const f = fixture({ tasks: [currentTask, live], visibleProjects: [15, 20] });
  const response = await f.get({ ticket_number: "HTPR-6641" });
  assert.deepEqual(response.body.tasks.map(task => task.id), [99]);
  assert.equal(f.aliasQueries(), 0);
});

test("web alias lookup checks the current board and the real page redirects server-side", async () => {
  const f = fixture();
  const task = await f.detail.findTaskNumberAlias(oldSlug, 6);
  assert.equal(task.projectId, 20);
  assert.equal(task.uniqueIndex, 6814);
  await assert.rejects(f.page({
    params: Promise.resolve({ slug: ["project-15", "6641"] }), searchParams: Promise.resolve({}),
  }), /REDIRECT \/detail\/project-20\/6814/);
});

test("the real detail page stays unavailable when the current task is inaccessible", async () => {
  const f = fixture({ tasks: [{ ...currentTask, project: { ...currentTask.project, ownerId: 9 } }] });
  const page = await f.page({
    params: Promise.resolve({ slug: ["project-15", "6641"] }), searchParams: Promise.resolve({}),
  });
  assert.equal(page.type, "Unauthorized");
});

test("multiple aliases to one task are deduplicated, different tasks remain ambiguous", async () => {
  const second = { ...currentTask, id: 99, projectId: 21 };
  const aliases = [
    { ...oldSlug, ticketNumber: "HTPR-6641", task: currentTask },
    { ...oldSlug, projectId: 16, ticketNumber: "HTPR-6641", task: currentTask },
  ];
  const same = fixture({ aliases });
  assert.equal((await same.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" })).id, 44769);
  aliases.push({ ...oldSlug, projectId: 17, ticketNumber: "HTPR-6641", task: second });
  const different = fixture({ tasks: [currentTask, second], aliases, visibleProjects: [20, 21] });
  await assert.rejects(different.resolver.findTaskByIdentifier({ id: 6 }, { ticket_number: "HTPR-6641" }), /ambiguous/);
  assert.equal((await different.get({ ticket_number: "HTPR-6641" })).status, 400);
});
