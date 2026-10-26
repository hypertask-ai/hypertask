const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { boardHygieneReport, normalizeLabel, titleCaseLabel } = load("src/lib/boardHygiene.ts", {});
const label = (id, value, taskCount = 0) => ({ id, value, taskCount, createdAt: new Date("2026-01-01") });

test("scratch-board report identifies all four issue types without changing the input", () => {
  const input = {
    untaggedOpenTickets: 10,
    columns: [],
    labels: [label("a", "multiprompt", 5), label("b", "Multiprompt", 1), label("c", "wazig")],
    publicViewFilters: [],
  };
  const before = structuredClone(input);
  assert.deepEqual(boardHygieneReport(input), {
    untaggedOpenTickets: 10,
    columns: [],
    staleAfterDays: 7,
    unusedTags: [{ id: "c", name: "wazig" }],
    duplicateGroups: [{ canonical: { id: "a", name: "multiprompt" }, labels: [
      { id: "a", name: "multiprompt" }, { id: "b", name: "Multiprompt" },
    ] }],
    missingViews: [{ id: "a", name: "multiprompt" }, { id: "b", name: "Multiprompt" }, { id: "c", name: "wazig" }],
    titleCaseChanges: [{ id: "a", name: "multiprompt", suggestedName: "Multiprompt" }, { id: "c", name: "wazig", suggestedName: "Wazig" }],
  });
  assert.deepEqual(input, before);
});

test("normalizes separators, plurals and nearby spelling while preserving short distinct names", () => {
  assert.equal(normalizeLabel(" Multi-prompts "), "multiprompt");
  const report = boardHygieneReport({ untaggedOpenTickets: 0, publicViewFilters: [], columns: [], labels: [
    label("a", "multiprompt"), label("b", "Multi-prompt"), label("c", "MultiPrompts"), label("d", "Multipromt"), label("e", "CI"), label("f", "UI"),
  ] });
  assert.deepEqual(report.duplicateGroups.map(group => group.labels.map(item => item.id)), [["a", "b", "c", "d"]]);
});

test("only a dedicated label view covers that label", () => {
  const report = boardHygieneReport({ untaggedOpenTickets: 0, columns: [], labels: [label("a", "Alpha"), label("b", "Beta")], publicViewFilters: [
    [{ type: "Labels", searchPayload: [{ id: "a" }] }],
    [{ type: "Labels", searchPayload: [{ id: "b" }] }, { type: "Assignees", searchPayload: [{ id: 985 }] }],
    null,
  ] });
  assert.deepEqual(report.missingViews, [{ id: "b", name: "Beta" }]);
});

test("canonical duplicate prefers usage, then oldest creation", () => {
  const old = { ...label("old", "Multiprompt", 4), createdAt: new Date("2020-01-01") };
  const recent = label("recent", "multiprompt", 4);
  const input = { untaggedOpenTickets: 0, publicViewFilters: [], columns: [], labels: [recent, old] };
  assert.equal(boardHygieneReport(input).duplicateGroups[0].canonical.id, "old");
  assert.equal(boardHygieneReport({ ...input, labels: [{ ...recent, taskCount: 5 }, old] }).duplicateGroups[0].canonical.id, "recent");
});

test("Title Case preserves specified acronyms and small words", () => {
  assert.equal(titleCaseLabel("  ci and the api of ht  "), "CI and the API of HT");
  assert.equal(titleCaseLabel("the ui and pr"), "The UI and PR");
});

test("board scope is checked before counts, only public views are loaded, and the read changes nothing", async () => {
  const calls = [];
  const scope = { teamId: "team", accessBinding: "binding" };
  const project = {
    id: 15,
    section: [
      { id: 1, section_title: "Todo", isDone: null },
      { id: 2, section_title: "Done", isDone: null },
      { id: 3, section_title: "Released", isDone: true },
      { id: 4, section_title: "Done", isDone: false },
    ],
    labels: [{ ...label("a", "alpha"), _count: { task: 2 } }],
    project_view: { allViews: [] },
  };
  let accessible = true;
  const { getBoardHygiene } = load("src/utils/controllers/projects/hygiene.ts", {
    "@/lib/prisma": { default: {
      project: { findFirst: async args => { calls.push(args); return accessible ? project : null; } },
      task: { count: async args => { calls.push(args); return 10; }, groupBy: async args => [{ sectionId: 1, _count: { _all: args.where.updatedAt ? 3 : 10 } }] },
    } },
    "./getAllIncludes": { getProjectWhere: (...args) => { assert.deepEqual(args, [985, "agent-id", scope]); return { ownerId: 985 }; } },
  });
  const report = await getBoardHygiene(15, 985, "agent-id", scope);
  assert.equal(report.untaggedOpenTickets, 10);
  assert.deepEqual(report.columns[0], { id: 1, title: "Todo", openTickets: 10, staleTickets: 3, wipLimit: null, overLimit: null });
  assert.deepEqual(report.titleCaseChanges, [{ id: "a", name: "alpha", suggestedName: "Alpha" }]);
  assert.deepEqual(calls[0].where, { id: 15, status: "Normal", ownerId: 985 });
  assert.deepEqual(calls[0].select.project_view.select.allViews.where, { visibility: "Public" });
  assert.deepEqual(calls[0].select.section.where, { deleted: false });
  assert.deepEqual(calls[1].where, { projectId: 15, status: "Normal", OR: [{ sectionId: { in: [1, 4] } }, { sectionId: null }], taskLabels: { none: {} } });
  accessible = false;
  calls.length = 0;
  assert.equal(await getBoardHygiene(15, 985, "agent-id", scope), null);
  assert.equal(calls.length, 1);
});

test("health report distinguishes absent work limits from actual excess", () => {
  const report = boardHygieneReport({ untaggedOpenTickets: 0, publicViewFilters: [], labels: [], columns: [
    { id: 1, title: "In Progress", openTickets: 7, staleTickets: 2, wipLimit: null },
    { id: 2, title: "Review", openTickets: 7, staleTickets: 0, wipLimit: 4 },
  ] });
  assert.deepEqual(report.columns.map(column => column.overLimit), [null, 3]);
});

test("MCP project service exposes the report action as a GET", async () => {
  const { ProjectService } = load("src/lib/mcp-server/lib/services/project.service.ts", {});
  const requests = [];
  const service = new ProjectService({ makeRequest: async (endpoint, options) => { requests.push({ endpoint, method: options.method }); return { success: true, report: { untaggedOpenTickets: 10 } }; } });
  assert.deepEqual(await service.manageBoardConfig({ action: "get_hygiene", project_id: 15 }), { success: true, report: { untaggedOpenTickets: 10 } });
  assert.deepEqual(requests, [{ endpoint: "/mcp/projects/15/manifest?include=hygiene", method: "GET" }]);
});

test("manifest report is opt-in and retains existing board access checks", async () => {
  const { NextRequest } = require("next/server");
  let auth = { user: { id: 985 }, agentId: "agent", teamScope: null };
  let accessible = true;
  let reportReads = 0;
  const { GET } = load("src/lib/mcp/operations/projects/[projectId]/manifest/operation.ts", {
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: handler => handler, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => auth },
    "@/lib/prisma": { default: { project: { findFirst: async () => accessible ? { id: 15, title: "Board", section: [] } : null } } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({ ownerId: 985 }) },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => assert.fail("unexpected error") },
    "@/utils/controllers/projects/hygiene": { getBoardHygiene: async (...args) => { reportReads++; assert.deepEqual(args, [15, 985, "agent", null]); return { untaggedOpenTickets: 10 }; } },
  });
  const read = query => GET(new NextRequest("https://app.hypertask.ai/api/mcp/projects/15/manifest" + query), { params: Promise.resolve({ projectId: "15" }) });
  assert.equal((await read("")).status, 200);
  assert.equal(reportReads, 0);
  assert.deepEqual((await (await read("?include=hygiene")).json()).report, { untaggedOpenTickets: 10 });
  accessible = false;
  assert.equal((await read("?include=hygiene")).status, 404);
  auth = null;
  assert.equal((await read("?include=hygiene")).status, 401);
  assert.equal(reportReads, 1);
});

test("native AI board configuration reads the same scoped report", async () => {
  const { createBoardConfigTool } = load("src/lib/ai/tools/boardConfig.ts", {
    "ai": { tool: definition => definition },
    "@/app/api/ai/_lib/planGate": {},
    "@/app/api/ai/_lib/customInstructions": { assertProjectAccess: async () => {} },
    "@/lib/prisma": { default: {} },
    "@prisma/client": {},
    "@/lib/aiModelOptions": {},
    "@/lib/ai/tools/execution": { withToolErrors: execute => execute },
    "@/lib/ai/tools/helpers": { sanitizeForJson: value => value },
    "@/utils/controllers/projects/getAllIncludes": {},
    "@/utils/controllers/projects/hygiene": { getBoardHygiene: async (...args) => { assert.deepEqual(args, [15, 985, "agent", null]); return { untaggedOpenTickets: 10 }; } },
  });
  const tool = createBoardConfigTool({ user: { id: 985 }, actingAgentId: "agent", teamScope: null, sendStatus: () => {} }).hypertask_board_config;
  const input = tool.inputSchema.parse({ action: "get_hygiene", project_id: 15 });
  assert.deepEqual(await tool.execute(input), { success: true, projectId: 15, report: { untaggedOpenTickets: 10 } });
});
