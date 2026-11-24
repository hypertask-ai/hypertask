const test = require("node:test"), assert = require("node:assert/strict"), { loadModule } = require("./helpers/loadModule.cjs");
const movedTask = { id: 5000, projectId: 13734, uniqueIndex: 12, ticketNumber: "DEST-12", title: "Moved release task", description: "", section: "Todo", sectionId: 77, status: "Normal", createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-20T00:00:00Z"), pullRequests: [], assignees: [], taskLabels: [], subTasks: [], savedContent: [], relatedToTasks: [], relatedFromTasks: [], project: { id: 13734, title: "Dest", status: "Normal", ownerId: 6, members: [], uniqueIdentifier: "DEST" } };
const reusedLive = { ...movedTask, id: 6000, projectId: 2060, uniqueIndex: 3148, ticketNumber: "SOFT-3148", project: { id: 2060, title: "Soft", status: "Normal", ownerId: 6, members: [], uniqueIdentifier: "SOFT" } };
function matches(row, where) {
  if (!row || !where) return Boolean(row);
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return v.some((c) => matches(row, c));
    if (k === "AND") return (Array.isArray(v) ? v : [v]).every((c) => matches(row, c));
    if (k === "project") return (!v.visible || v.visible.includes(row.projectId)) && matches(row.project, { ...v, visible: undefined });
    if (k === "task") return matches(row.task, v);
    if (v && typeof v === "object") {
      if (v.in) return v.in.includes(row[k]);
      if (Object.hasOwn(v, "equals")) return v.mode === "insensitive" ? String(row[k] ?? "").toLowerCase() === String(v.equals).toLowerCase() : row[k] === v.equals;
      if (v.contains) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      if (v.not) return row[k] !== v.not;
    }
    return row[k] === v;
  });
}
function harness({ visibleProjects = [2060, 13734], tasks = [movedTask], aliases } = {}) {
  aliases ??= [{ id: 1, projectId: 2060, uniqueIndex: 3148, ticketNumber: "SOFT-3148", taskId: 5000, createdAt: new Date("2026-11-22T00:00:00Z"), task: movedTask }];
  const projects = [{ id: 2060, uniqueIdentifier: "SOFT", status: "Normal", issuedUniqueIndex: 0 }, { id: 13734, uniqueIdentifier: "DEST", status: "Normal", issuedUniqueIndex: 0 }];
  const prisma = {
    project: { findMany: async ({ where }) => projects.filter((p) => (!where?.visible || where.visible.includes(p.id)) && (!where?.uniqueIdentifier || matches(p, { uniqueIdentifier: where.uniqueIdentifier }))), findUnique: async ({ where }) => projects.find((p) => p.id === where.id) ?? null, updateMany: async () => ({ count: 1 }) },
    task: { findMany: async ({ where }) => tasks.filter((t) => matches(t, where)), findFirst: async ({ where }) => tasks.find((t) => matches(t, where)) ?? null, count: async ({ where }) => tasks.filter((t) => matches(t, where)).length, aggregate: async ({ where }) => ({ _max: { uniqueIndex: tasks.filter((t) => t.projectId === where.projectId).reduce((m, t) => Math.max(m, t.uniqueIndex), null) } }) },
    taskNumberAlias: { findMany: async ({ where }) => aliases.filter((a) => matches(a, where)), findFirst: async ({ where }) => aliases.find((a) => matches(a, where)) ?? null, findUnique: async ({ where }) => aliases.find((a) => a.projectId === where.projectId_uniqueIndex.projectId && a.uniqueIndex === where.projectId_uniqueIndex.uniqueIndex) ?? null, aggregate: async ({ where }) => ({ _max: { uniqueIndex: aliases.filter((a) => a.projectId === where.projectId).reduce((m, a) => Math.max(m, a.uniqueIndex), null) } }) },
    projectPrefixAlias: { findMany: async () => [] }, comment: { count: async () => 0, findMany: async () => [] }, taskRelations: { findMany: async () => [] }, $queryRaw: async () => [],
  };
  class NextResponse { static json(body, init = {}) { return { body, status: init.status ?? 200, headers: new Headers(), json: async () => body }; } }
  const stubs = {
    "next/server": { NextResponse }, "@/lib/prisma": { default: prisma },
    "@/lib/flags": { HTPR_6868_TICKET_PREFIX_FLAG: "htpr-6868-ticket-prefix", isFeatureEnabled: async (k) => k === "htpr-6868-ticket-prefix" },
    "@/lib/auth/agentScope": { recordAgentBoardScopeMiss: () => {}, agentScopeEnforced: () => true }, "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (_r, e) => { throw e; } },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (h) => h, validateMcpRouteAuth: async () => ({ user: { id: 6, email: "u@t.io" }, agentId: null, teamScope: null }), checkMcpRouteRateLimit: async () => null, mcpRouteUnauthorizedResponse: async () => NextResponse.json({}, { status: 401 }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({ visible: visibleProjects }), intersectProjectTeamScope: (w) => w, projectContentAccessWhere: () => ({ visible: visibleProjects }) },
    "@/lib/mcp/tasks/mappers": { taskMcpGetInclude: () => ({}), mapTaskToMcpGetResponse: (t) => ({ id: t.id, projectId: t.projectId, ticketNumber: t.ticketNumber, title: t.title, description: "", section: t.section, labels: [], assignees: [], sub_tasks: [], savedContent: [] }) },
    "@/lib/mcp/agents": { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => undefined },
    "@/lib/agents/visibility": { isAgentVisibleToUser: () => false, accessibleAgentMembershipWhere: () => ({}), boardAgentVisibilityWhere: () => ({}), accessibleAgentWhere: () => ({}) },
    "@/lib/agents/publicAgent": { projectPublicAgent: (a) => a, publicAgentSelect: {}, sanitizeAgentCredentials: (x) => x, resolvePublicAgentDisplayName: () => null },
    "@/utils/controllers/notifications/visibleInboxScope": { visibleUserInboxWhere: () => ({}) }, "@/lib/pullRequests/taskPullRequests": { refreshTaskPullRequests: async (_id, prs) => prs ?? [] },
    "@/lib/pullRequests/githubPullRequests": { derivePullRequestDisplayState: () => "open", parseGithubPullRequestUrl: () => null }, "@/lib/mcp/tasks/extractPrLinks": { extractPrLinks: () => [] },
    "@/lib/mcp/tasks/relatedTaskContext": { relatedTaskContextSelect: () => ({}), mapRelatedTaskContext: async (t) => t, loadTaskAgentActivities: async () => [] },
    "@/utils/controllers/search/document": { turbopufferSearchTaskIds: async () => [] }, "@/lib/search/serverOperators": { parseSearchWithChipNames: async (q) => ({ text: q, filters: {} }) },
    "@/lib/search/rankedWhere": {}, "@/lib/mcp/tasks/updateTask": {}, "@/utils/controllers/getMemberAndOwnerForBoard": {}, "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@vercel/functions": { waitUntil: () => {} }, "@/lib/realtime/server": {}, "@/lib/cycles": { CYCLE_WINDOW_SIZE: 3 },
  };
  const resolver = loadModule("src/lib/mcp/tasks/resolveTask.ts", stubs);
  stubs["@/lib/mcp/tasks/resolveTask"] = resolver;
  stubs["@/utils/controllers/taskDetail/load"] = loadModule("src/utils/controllers/taskDetail/load.ts", stubs);
  const page = loadModule("src/app/detail/[...slug]/page.tsx", { ...stubs, "./TaskDetailComp": {}, "@/lib/auth/serverUser": { requireServerCookieUser: async () => ({ id: 6 }) }, "next/navigation": { redirect: (u) => { throw new Error(`REDIRECT ${u}`); } }, "@/lib/contexts/TaskDetail/TaskProvider": {}, "@/lib/contexts/TaskDetail/FollowersProvider": {}, "@/utils/helperFunctions/TaskDetail": {}, "@/utils/controllers/users/fetch_preferences": { fetchUserPreferenceController: async () => ({}) }, "@/utils/controllers/tasks/markRead": {}, "@/utils/controllers/comments/readReceipts": {}, "@/lib/agentRuns/service": {}, "@/app/api/ai/_lib/taskSummaryFreshness": {}, "../../unauthorized/page": { default: "Unauthorized" } }).default;
  return { prisma, resolver, page, req: (q) => ({ nextUrl: { searchParams: new URLSearchParams(q) } }), getTask: loadModule("src/utils/controllers/tasks/getTask.ts", stubs).default, mcpGet: loadModule("src/lib/mcp/operations/tasks/operation.ts", stubs).GET, mcpSearch: loadModule("src/lib/mcp/operations/tasks/search/operation.ts", stubs).GET, mcpContext: loadModule("src/lib/mcp/operations/tasks/context/operation.ts", stubs).GET, batch: loadModule("src/lib/mcp/tasks/batchTasks.ts", stubs).handleBatchBody, findTasks: loadModule("src/lib/mcp/tasks/fields/findTasks.ts", stubs).findTasksByIdentifier, nextIndex: loadModule("src/utils/controllers/tasks/getNextUniqueTaskIndex.ts", stubs).getNextUniqueTaskIndex, taskParser: loadModule("src/lib/mcp-server/utils/task-parser.ts", {}) };
}
test("old key and old board+number resolve on every path and refuse inaccessible destination boards", async () => {
  const ok = harness({ visibleProjects: [2060, 13734] }), no = harness({ visibleProjects: [2060] }), ctx = { user: { id: 6, email: "u@t.io" }, agentId: null, teamScope: null };
  assert.deepEqual([(await ok.getTask("project-2060", "3148", { id: 6 })).json.id, (await ok.getTask("project-2060", "SOFT-3148", { id: 6 })).json.id, (await no.getTask("project-2060", "3148", { id: 6 })).status], [5000, 5000, 404]);
  assert.deepEqual([(await ok.mcpGet(ok.req({ ticket_number: "SOFT-3148" }))).body.tasks[0].id, (await ok.mcpGet(ok.req({ project_id: "2060", unique_index: "3148" }))).body.tasks[0].id, (await no.mcpGet(no.req({ ticket_number: "SOFT-3148" }))).status], [5000, 5000, 404]);
  assert.deepEqual([(await ok.mcpSearch(ok.req({ q: "SOFT-3148" }))).body.tasks[0].id, (await ok.mcpSearch(ok.req({ q: "SOFT-3148", project_id: "2060" }))).body.tasks[0].id, (await no.mcpSearch(no.req({ q: "SOFT-3148" }))).body.tasks.length], [5000, 5000, 0]);
  assert.deepEqual([(await ok.mcpContext(ok.req({ ticket_number: "SOFT-3148" }))).body.task.id, (await ok.mcpContext(ok.req({ project_id: "2060", unique_index: "3148" }))).body.task.id, (await ok.mcpContext(ok.req({ task_id: "5000", project_id: "2060" }))).body.task.id, (await ok.mcpContext(ok.req({ task_id: "5000", project_id: "9999" }))).status, (await no.mcpContext(no.req({ ticket_number: "SOFT-3148" }))).status], [5000, 5000, 5000, 404, 404]);
  assert.deepEqual([(await ok.batch({}, ctx, { op: "get", ticket_numbers: ["SOFT-3148"] })).body.tasks[0].id, (await ok.batch({}, ctx, { op: "get", identifiers: [{ project_id: 2060, unique_index: 3148 }] })).body.tasks[0].id, (await no.batch({}, ctx, { op: "get", ticket_numbers: ["SOFT-3148"] })).body.notFound, (await ok.findTasks({ id: 6 }, { ticket_number: "SOFT-3148" }))[0].id], [5000, 5000, ["SOFT-3148"], 5000]);
  await assert.rejects(ok.page({ params: Promise.resolve({ slug: ["project-2060", "3148"] }), searchParams: Promise.resolve({}) }), /REDIRECT \/detail\/project-13734\/12/);
  await assert.rejects(ok.page({ params: Promise.resolve({ slug: ["project-2060", "SOFT-3148"] }), searchParams: Promise.resolve({}) }), /REDIRECT \/detail\/project-13734\/12/);
  assert.equal((await no.page({ params: Promise.resolve({ slug: ["project-2060", "3148"] }), searchParams: Promise.resolve({}) })).type, "Unauthorized");
  assert.deepEqual([(await ok.resolver.findTaskByStringIdentifier({ id: 6 }, "https://app.hypertask.ai/detail/project-2060/3148")).id, (await ok.resolver.findTaskByStringIdentifier({ id: 6 }, "SOFT-3148")).id, await ok.resolver.resolveTaskIdOnly({ ticket_number: "SOFT-3148" }), await ok.resolver.resolveTaskIdOnly({ project_id: 2060, unique_index: 3148 }), ok.taskParser.parseTaskReference("MY_BOARD-3148").ticketNumber], [5000, 5000, 5000, 5000, "MY_BOARD-3148"]);
});
test("fresh number after move, live-wins collision notice with access check, and dry-run backfill", async () => {
  const fresh = harness({ tasks: [movedTask] }), col = harness({ visibleProjects: [2060, 13734], tasks: [movedTask, reusedLive] });
  assert.equal(await fresh.nextIndex(2060, fresh.prisma), 3149);
  const getRes = await col.mcpGet(col.req({ ticket_number: "SOFT-3148" }));
  assert.deepEqual([getRes.body.tasks[0].id, getRes.body.reusedKeyCollisions[0].movedTaskId, (await col.getTask("project-2060", "3148", { id: 6 })).json.reusedKeyCollision.movedTaskId, (await harness({ visibleProjects: [2060], tasks: [movedTask, reusedLive] }).mcpGet(col.req({ ticket_number: "SOFT-3148" }))).body.reusedKeyCollisions], [6000, 5000, 5000, undefined]);
  const { run } = await import("../scripts/htpr-9634-backfill-move-aliases.mjs"), queries = [];
  const moved = { taskId: 5000, fromProjectId: 2060, fromPrefix: "SOFT", commentText: "" };
  const db = { query: async (sql, params) => { queries.push({ sql, params }); if (sql.includes("WHERE (a.\"ticketNumber\"")) return { rows: [{ id: 1 }] }; if (sql.includes("TaskMove")) return { rows: [moved] }; return { rows: [], rowCount: 1 }; } };
  const mapping = [{ projectId: 2060, uniqueIndex: 3148, ticketNumber: "SOFT-3148", taskId: 5000 }];
  assert.deepEqual(
    [await run(db, {}, () => {}), queries.length, await run(db, { apply: true, mapping }, () => {}), await run({ query: async (sql) => (sql.includes("TaskMove") ? { rows: [{ ...moved, commentText: "Moved SOFT-3148" }] } : { rows: [], rowCount: 1 }) }, {}, () => {})],
    [{ blanks: 1, moveGaps: 1, needsMapping: 1, candidates: 0, updated: 0, inserted: 0 }, 2, { blanks: 1, moveGaps: 1, needsMapping: 1, candidates: 1, updated: 1, inserted: 1 }, { blanks: 0, moveGaps: 1, needsMapping: 0, candidates: 1, updated: 0, inserted: 0 }],
  );
});
