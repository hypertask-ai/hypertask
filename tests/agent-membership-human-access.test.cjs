const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { Prisma } = require("@prisma/client");
const { PGlite } = require("@electric-sql/pglite");
const { load } = require("./task-route-loader.cjs");

const userId = 2343;
const agent = { id: "qa-agent", userId, revokedAt: null };
const projects = [
  { id: 7049, ownerId: 985, members: [{ userId, agentId: agent.id, agent }], title: "Agent-only board" },
  { id: 7050, ownerId: 985, members: [{ userId, agentId: null, status: "Accepted" }], title: "Human board" },
  { id: 7051, ownerId: userId, members: [], title: "Owned board" },
  { id: 7052, ownerId: 985, members: [], title: "Private board" },
].map(project => ({ ...project, status: "Normal", teamId: "qa-team", googleAccount: { id: 1 },
  owner: { id: project.ownerId, displayName: "Board owner", agents: project.ownerId === userId ? [agent] : [] },
  members: project.members.map(member => ({ status: "Accepted", ...member, user: { id: member.userId, displayName: "Board member", agents: [agent] } })) }));
const tasks = projects.map(project => ({ id: project.id, projectId: project.id, project,
  title: project.title, uniqueIndex: 1, ticketNumber: `QA-${project.id}`, status: "Normal", deletedAt: null,
  dueDate: null, updatedAt: new Date(), pullRequests: [], agent: null, description_: null }));

function matches(row, where) {
  if (!row) return false;
  return Object.entries(where).every(([key, filter]) => {
    if (key === "OR") return filter.some(branch => matches(row, branch));
    if (key === "AND") return (Array.isArray(filter) ? filter : [filter]).every(branch => matches(row, branch));
    const value = row[key];
    if (filter === null || typeof filter !== "object") return value === filter;
    if ("some" in filter) return (value || []).some(item => matches(item, filter.some));
    if ("is" in filter) return matches(value, filter.is);
    if ("isNot" in filter) return value != null;
    if ("not" in filter) return value !== filter.not;
    if ("in" in filter) return filter.in.includes(value);
    if ("equals" in filter) return String(value).toLowerCase() === String(filter.equals).toLowerCase();
    if ("contains" in filter) return String(value).toLowerCase().includes(filter.contains.toLowerCase());
    return matches(value, filter);
  });
}

function harness(viewerId = userId) {
  const calls = [];
  const db = {
    project: {
      findMany: async query => { calls.push(["projects", query]); const rows = projects.filter(p => matches(p, query.where || {}));
        return query.select && Object.keys(query.select).length === 1 && query.select.id ? rows.map(({ id }) => ({ id })) : rows; },
      findFirst: async query => { calls.push(["project", query]); return projects.find(p => matches(p, query.where || {})) || null; },
    },
    task: {
      findFirst: async query => { calls.push(["task", query]); return tasks.find(t => matches(t, query.where || {})) || null; },
      findMany: async query => { calls.push(["tasks", query]); return tasks.filter(t => matches(t, query.where || {})); },
    },
    user: { findFirst: async () => ({ id: 332, displayName: "HyperAI" }) },
    $queryRaw: async (strings, ...values) => {
      calls.push(["comments-sql"]);
      const query = Prisma.sql(strings, ...values);
      if (query.text.includes("WITH authorized_task AS")) {
        // Execute the production authorization CTE, not a reimplementation of its predicate.
        const prefix = query.text.split(",\n    task_row AS")[0];
        const count = Math.max(...[...prefix.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
        const result = await sql.query(`${prefix} SELECT id FROM authorized_task`, query.values.slice(0, count));
        return result.rows.map(row => ({ id: row.id, text: "private comment" }));
      }
      return [{ id: 1, text: "private comment" }];
    },
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/agents/publicAgent": { publicAgentSelect: {}, sanitizeAgentCredentials: value => value },
    "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({}), accessibleAgentMembershipWhere: () => ({}) },
    "@/lib/cycles": {},
    "@/utils/controllers/notifications/visibleInboxScope": { visibleUserInboxWhere: () => ({}) },
    "@/lib/realtime/server": {},
    "@/lib/pullRequests/taskPullRequests": {},
    "@/utils/controllers/projects/findPrefixAliasTasks": {},
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: viewerId, source: "better-auth" }) },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async () => ({ id: viewerId }) },
    "@/lib/api/task-writes/route": { withTaskWriteFlag: handler => handler,
      taskWriteRoute: ({ operation, prepare }) => async (request, session = { userId: viewerId }) =>
        operation(await request.json(), prepare ? await prepare(session) : session) },
    "@/lib/aiModelOptions": { aiModelDefinitions: [], aiImageModelDefinitions: [] },
    "@/utils/controllers/agents/boardMembers": { getBoardAgentMembers: async () => [] },
    "../search/document": { turbopufferFetchMentionTasks: async (_query, ids) => {
      calls.push(["search", ids]); return tasks.filter(t => ids.includes(t.projectId)).map(t => ({ id: t.id, project_id: t.projectId, name: t.title, type: "task" }));
    } },
    "@/utils/controllers/search/document": { turbopufferFetchMentionTasks: async (_query, ids) => tasks.filter(t => ids.includes(t.projectId)) },
    "@/utils/controllers/search/query": { turbopufferGetSuggestions: async (_query, ids) => {
      calls.push(["search", ids]); return tasks.filter(t => ids.includes(t.projectId));
    } },
    "@/lib/agentRuns/service": { listTaskAgentRunActivities: async () => [] },
    "@/utils/controllers/tasks/markRead": { getTaskReadStateLastReadAt: async () => null },
    "./readReceipts": { filterCommentReadReceipts: async value => value, omitCommentSeen: value => value },
    "@/lib/ai/teamBillingSnapshotSelect": { teamBillingSnapshotSelect: {} },
    "@/utils/helperFunctions/Views/BoardFilterSanitizer": { sanitizeProjectBoardFilters: value => value },
    "@/lib/calendarSync/access": {},
    "./attachWaitingOnUsers": {},
    "./attachOpenBlockingTasks": {},
    "@/lib/calendarSync/taskRange": {},
    "server-only": {},
    react: { cache: fn => fn },
  };
  const loadModule = file => load(file, mocks);
  async function request(file, query, typed = false, method = "GET") {
    const handler = loadModule(file);
    if (typed) {
      const response = await handler.GET({ headers: new Headers(), query });
      return { status: response.status, body: await response.json() };
    }
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
    await handler.default({ method, headers: {}, query, body: query }, res);
    return { status: res.statusCode, body: res.body };
  }
  return { loadModule, request, calls, mocks };
}

let sql;
before(async () => {
  sql = new PGlite();
  await sql.exec(`CREATE TYPE "Status" AS ENUM ('Normal', 'Archive', 'Deleted');
    CREATE TABLE "Project" (id int, "ownerId" int, status "Status");
    CREATE TABLE "Task" (id int, "projectId" int, "uniqueIndex" int, status "Status");
    CREATE TABLE "Member" ("projectId" int, "userId" int, "agentId" text);`);
  for (const project of projects) {
    await sql.query('INSERT INTO "Project" VALUES ($1, $2, $3)', [project.id, project.ownerId, project.status]);
    await sql.query('INSERT INTO "Task" VALUES ($1, $1, 1, $2)', [project.id, project.status]);
    for (const member of project.members) {
      await sql.query('INSERT INTO "Member" VALUES ($1, $2, $3)', [project.id, member.userId, member.agentId]);
    }
  }
});
after(async () => { await sql.close(); });

for (const typed of [false, true]) {
  for (const [projectId, status] of [[7049, 404], [7050, 200], [7051, 200], [7052, 404]]) {
    test(`${typed ? "typed" : "legacy"} task detail: board ${projectId} returns ${status}`, async () => {
      const h = harness();
      const response = await h.request(typed ? "src/lib/api/task-writes/task-read.ts" : "src/pages/api/tasks/getTask.ts",
        { project: `project-${projectId}`, uniqueIndex: "1" }, typed);
      assert.equal(response.status, status);
      if (status === 200) assert.equal(response.body.projectId, projectId);
      else assert.equal(response.body, null);
    });
  }
  for (const searchQuery of [undefined, "board"]) {
    test(`${typed ? "typed" : "legacy"} unscheduled discovery excludes agent-only and private boards (${searchQuery})`, async () => {
      const h = harness();
      const response = await h.request(typed ? "src/lib/api/task-writes/unscheduled-read.ts" : "src/pages/api/tasks/getUnscheduled.ts",
        { searchQuery }, typed);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.map(task => task.projectId), [7050, 7051]);
    });
  }
  for (const param of ["all", "board"]) {
    for (const [projectId, status] of [[7049, 404], [7050, 200], [7051, 200], [7052, 404]]) {
      test(`${typed ? "typed" : "legacy"} mention search (${param}): board ${projectId} returns ${status}`, async () => {
        const h = harness();
        const response = await h.request(typed ? "src/lib/api/task-writes/search-by-param.ts" : "src/pages/api/tasks/searchByParam.ts",
          { param, projectId: String(projectId) }, typed);
        assert.equal(response.status, status);
        if (status === 200) {
          assert.ok(response.body.some(item => item.type === "task"));
          assert.ok(!response.body.some(item => item.project_id === 7049 || item.id === 7049));
        } else {
          assert.deepEqual(response.body, []);
          assert.ok(!h.calls.some(([kind]) => ["tasks", "search"].includes(kind)));
          const roster = h.calls.find(([kind]) => kind === "project");
          assert.ok(roster && !matches(projects[0], roster[1].where));
        }
      });
    }
  }
}

for (const [projectId, status] of [[7049, 404], [7050, 200], [7051, 200], [7052, 404]]) {
  test(`comments API: board ${projectId} returns ${status} before reading private content`, async () => {
    const h = harness();
    const response = await h.request("src/pages/api/comments/getByTask.ts", { taskId: String(projectId) });
    assert.equal(response.status, status);
    assert.equal(h.calls.some(([kind]) => kind === "comments-sql"), status === 200);
  });
  test(`SSR comments SQL: board ${projectId} has the same human scope as task detail`, async () => {
    const h = harness();
    const rows = await h.loadModule("src/utils/controllers/taskDetail/load.ts").fetchCommentsForSlug({ projectId, uniqueIndex: 1 }, userId);
    assert.equal(rows.length, status === 200 ? 1 : 0);
  });
}

test("global search suggestions send only canonical human board IDs to the search provider", async () => {
  const h = harness();
  const response = await h.request("src/pages/api/search/query.ts", { searchQuery: "board" }, false, "POST");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.map(task => task.projectId), [7050, 7051]);
  assert.deepEqual(h.calls.find(([kind]) => kind === "search")[1], [7050, 7051]);
});

test("minimal listing, saved-content and calendar discovery do not inherit an agent row", async () => {
  const h = harness();
  const minimal = h.loadModule("src/utils/controllers/projects/getAllMinimal.ts").extraMinimalProjectWhere(userId);
  assert.deepEqual(projects.filter(project => matches(project, minimal)).map(p => p.id), [7050, 7051]);
  const ids = await h.loadModule("src/utils/controllers/savedContent/helper.ts").fetchProjectIds(userId);
  assert.deepEqual(ids, [7050, 7051]);
  const calendar = await h.loadModule("src/utils/controllers/tasks/calendarReadModel.ts").getCalendarAccessibleProjectIds(userId);
  assert.deepEqual(calendar, [7050, 7051]);
});

test("board lookup and route metadata match the human task-detail scope", async () => {
  const h = harness();
  const getById = h.loadModule("src/utils/controllers/projects/getById.ts").default;
  const metadata = h.loadModule("src/lib/boardRouteMetadata.ts").getProjectForValidation;
  assert.equal(await getById(7049, userId), null);
  assert.equal((await metadata(userId, "7049")).success, false);
  assert.equal((await getById(7050, userId)).id, 7050);
  assert.equal((await metadata(userId, "7050")).success, true);
});

test("authenticated owned active agent keeps canonical task and board access without giving its human owner access", async () => {
  const h = harness();
  const resolve = h.loadModule("src/lib/mcp/tasks/resolveTask.ts").findTaskByIdentifier;
  assert.equal(await resolve({ id: userId }, { task_id: 7049 }), null);
  assert.equal((await resolve({ id: userId }, { task_id: 7049 }, agent.id)).id, 7049);
  assert.equal(await resolve({ id: 985 }, { task_id: 7049 }, agent.id), null, "cannot borrow another user's agent even as board owner");
  const helpers = h.loadModule("src/utils/controllers/projects/getAllIncludes.ts");
  assert.equal(matches(projects[0], helpers.projectContentAccessWhere(userId)), false);
  assert.equal(matches(projects[0], helpers.projectContentAccessWhere(userId, agent.id)), true);
  assert.equal(matches(projects[0], helpers.getProjectListingWhere(userId, agent.id)), true);
  assert.equal(matches(projects[1], helpers.getProjectListingWhere(userId, agent.id)), false, "agent discovery stays explicit-board-only");
  const revoked = { ...projects[0], members: [{ ...projects[0].members[0], agent: { ...agent, revokedAt: new Date() } }] };
  assert.equal(matches(revoked, helpers.projectContentAccessWhere(userId, agent.id)), false);
});

for (const agentId of [null, agent.id]) {
  test(`MCP comments preserve authenticated-agent access, not agent-owner human access (${agentId})`, async () => {
    const h = harness();
    Object.assign(h.mocks, {
      "@/lib/mcp/routeWrapper": {
        wrapMcpRoute: operation => operation,
        checkMcpRouteRateLimit: async () => null,
        validateMcpRouteAuth: async () => ({ user: { id: userId }, agentId }),
      },
      "@/lib/mcp/agents": { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => null },
      "@/lib/mcp/tasks/services": {},
      "@/utils/controllers/urls/extractUrlsFromContent": {},
      "@/utils/controllers/comments/processMentions": {},
      "@/utils/controllers/comments/createCommentService": {},
      "@/utils/controllers/comments/agentInvocationCorrelation": {},
      "@/utils/helperFunctions/sanitizeRichHtml": {},
      "@/utils/helperFunctions/multiPages": {},
      "@/lib/mcp/normalizeBlockHtml": {},
      "@/utils/helperFunctions/markdownToHtml": {},
      "@/lib/mcp/fieldError": {},
      "@/lib/mcp/tasks/validators": {},
      "@/lib/mcp/comments/activityMetadata": {},
      "@/lib/mcp/agents/scopes": {},
      "@/lib/mcp/idempotency/idempotencyStore": {},
      "@/lib/mcp/boards/links": {},
      "@/lib/mcp/comments/reactionResponse": { mapMcpCommentReaction: value => value },
      "@/lib/mcp/readListQuery": { readListQuery: () => ({}) },
      "@/lib/mcp/listQuery": {},
    });
    h.mocks["@/lib/agents/publicAgent"].overlayDurableAgentDisplayName = value => value;
    h.mocks["@/lib/prisma"].default.comment = {
      count: async () => { h.calls.push(["comment-count"]); return 1; },
      findMany: async () => [{ id: 1, text: "private comment", createdAt: new Date(), attachments: [], reactions: [] }],
    };
    const response = await h.loadModule("src/lib/mcp/operations/comments/operation.ts").GET({
      nextUrl: { searchParams: new URLSearchParams({ task_id: "7049" }) },
    });
    assert.equal(response.status, agentId ? 200 : 404);
    assert.equal(h.calls.some(([kind]) => kind === "comment-count"), Boolean(agentId));
    if (agentId) assert.equal((await response.json()).comments[0].text, "private comment");
  });
}

test("remaining legacy human member predicates reject agent-only rows without changing human status rules", () => {
  const fs = require("node:fs");
  const ts = require("typescript");
  const files = [
    "src/utils/controllers/teams/getAllSidebar.ts", "src/utils/controllers/teams/getAllSidebarOptimized.ts",
    "src/utils/controllers/tasks/calendarReadModel.ts", "src/utils/controllers/reminders/invokeReminder.ts",
    "src/utils/controllers/members/share.ts", "src/lib/serverActions/index.ts",
    ...["src/pages/api/projects/views", "src/lib/api/project-writes/views"].flatMap(directory =>
      ["create-view", "update-view", "unsaved-view", "reset-to-default"].map(name => `${directory}/${name}.ts`)),
  ];
  let predicates = 0;
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === "members" && ts.isObjectLiteralExpression(node.initializer)) {
        const some = node.initializer.properties.find(property => property.name?.getText(source) === "some");
        if (some && ts.isPropertyAssignment(some) && ts.isObjectLiteralExpression(some.initializer)) {
          const compiled = ts.transpileModule(`return (${some.initializer.getText(source)});`, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
          }).outputText;
          const predicate = new Function("userId", "user", "currentUser", "reminder", compiled)(userId, { id: userId }, { id: userId }, { userId });
          assert.equal(matches(projects[0].members[0], predicate), false, file);
          assert.equal(matches(projects[1].members[0], predicate), true, file);
          predicates++;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(predicates > 0, "must exercise actual source predicates, not an empty scan");
});
