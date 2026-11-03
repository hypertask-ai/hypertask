const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-8354-section-name";
const PROJECT_ID = 15;
const BUGS = {
  id: 4389,
  section_title: "Bugs",
  projectId: PROJECT_ID,
  visibility: true,
  deleted: false,
  ranking: "A0014.9",
  isDone: null,
  autoAssignUserId: null,
  autoAssignAgentId: null,
};
const DOCS = { ...BUGS, id: 9190, section_title: "Docs", ranking: "A0026.2", isDone: true };

function harness({ flagOn = true, sections = [BUGS, DOCS] } = {}) {
  const prisma = {
    project: { findFirst: async () => ({ id: PROJECT_ID }) },
    section: {
      findMany: async () => sections,
      findFirst: async () => ({ id: BUGS.id, projectId: PROJECT_ID, deleted: false }),
    },
    task: { count: async () => 7 },
  };
  const mocks = {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ status: init.status ?? 200, body }) } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: null, teamScope: null }),
      checkMcpRouteRateLimit: async () => null,
    },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({ ownerId: 6 }) },
    "@/lib/realtime/server": { broadcastBoardChange: () => {} },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === FLAG && flagOn },
    "@/lib/mcp/sections/services": {
      createSection: async ({ title }) => ({
        success: true,
        section: { ...BUGS, id: 99, section_title: title, ranking: "A0300" },
      }),
      updateSection: async ({ title }) => ({
        success: true,
        section: { ...BUGS, section_title: title ?? BUGS.section_title },
      }),
      deleteSection: async () => ({ success: true, status: 200 }),
    },
  };
  const collection = load("src/lib/mcp/operations/projects/[projectId]/sections/operation.ts", mocks);
  const single = load("src/lib/mcp/operations/projects/[projectId]/sections/[sectionId]/operation.ts", mocks);
  const request = (body, search = "") => ({
    nextUrl: { searchParams: new URLSearchParams(search) },
    headers: new Headers(),
    json: async () => body ?? {},
  });
  const params = (extra = {}) => ({ params: Promise.resolve({ projectId: String(PROJECT_ID), ...extra }) });
  return { collection, single, request, params };
}

test("HTPR-8354 column names ship as a reversible bugfix for everyone", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-8354-section-name.ts");
  assert.equal(flag.key, FLAG);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("the sections list publishes .name beside section_title when the flag is on", async () => {
  const { collection, request, params } = harness({ flagOn: true });
  const res = await collection.GET(request(), params());
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.sections.map(({ name, section_title }) => [name, section_title]),
    [["Bugs", "Bugs"], ["Docs", "Docs"]],
  );
});

test("the sections list keeps today's shape when the flag is off", async () => {
  const { collection, request, params } = harness({ flagOn: false });
  const res = await collection.GET(request(), params());
  assert.equal(res.status, 200);
  for (const section of res.body.sections) {
    assert.equal(Object.hasOwn(section, "name"), false);
    assert.equal(section.section_title, section.id === BUGS.id ? "Bugs" : "Docs");
  }
});

test("a created column answers with its name too", async () => {
  for (const [flagOn, expected] of [[true, "Done"], [false, undefined]]) {
    const { collection, request, params } = harness({ flagOn });
    const res = await collection.POST(request({ title: "Done" }), params());
    assert.equal(res.status, 200);
    assert.equal(res.body.section.section_title, "Done");
    assert.equal(res.body.section.name, expected);
  }
});

test("a renamed or reordered column answers with its name too", async () => {
  for (const [flagOn, expected] of [[true, "Shipped"], [false, undefined]]) {
    const { single, request, params } = harness({ flagOn });
    const res = await single.PATCH(request({ title: "Shipped" }), params({ sectionId: String(BUGS.id) }));
    assert.equal(res.status, 200);
    assert.equal(res.body.section.section_title, "Shipped");
    assert.equal(res.body.section.name, expected);
    assert.equal(res.body.section.taskCount, 7);
  }
});
