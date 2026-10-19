const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { loadRouteWrapper } = require("./helpers/mcp-route-wrapper.cjs");

const USER_TEXT = "Quarterly salary review for jane@example.com";

function prismaTimeout() {
  const error = new Error(`Invalid \`prisma.task.findMany()\` invocation: title contains "${USER_TEXT}"\nTimed out fetching a new connection from the connection pool.`);
  error.name = "PrismaClientKnownRequestError";
  error.code = "P2024";
  error.clientVersion = "6.19.0";
  error.meta = { modelName: "Task", connection_limit: 5, title: USER_TEXT };
  return error;
}

function harness() {
  const reports = [];
  const pending = [];
  const crashReport = load("src/lib/mcp/operationCrashReport.ts", {
    "@vercel/functions": { waitUntil: promise => pending.push(promise) },
    "@/lib/errors/reportError": { reportError: async report => { reports.push(report); } },
  });
  const wrapper = loadRouteWrapper({
    "./operationCrashReport": crashReport,
    "@/lib/aiFeedback/automatic": { queueRestFailure: () => {} },
    "@/lib/mcp/auth": {},
    "@/lib/mcp/readJsonBody": {},
    "@/lib/mcp/tasks/agentMutationLeaseAdoption": {},
    "./dbTiming": { createMcpDbTiming: () => ({}), mcpDbTimings: { run: (_, run) => run() }, mcpDbTimingHeader: () => "" },
  });
  return {
    reports,
    crashReport,
    wrapper,
    settled: async () => { await Promise.all(pending); },
  };
}

function mcpRequest(path) {
  const url = `https://app.hypertask.ai${path}`;
  return { url, method: "GET", headers: new Headers(), nextUrl: new URL(url) };
}

function loadTaskList(h, { findMany = async () => [], findTaskByIdentifier = async () => null }) {
  class TaskIdentifierAmbiguityError extends Error {}
  const { GET } = load("src/lib/mcp/operations/tasks/operation.ts", {
    "@/lib/tasks/sameBoardRelations": { stripForeignTaskRelations: value => value },
    "@/lib/mcp/operationCrashReport": h.crashReport,
    "@/lib/mcp/routeWrapper": h.wrapper,
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "@/lib/mcp/auth": {},
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/mcp/agents": {},
    "@/lib/agents/visibility": {},
    "@/lib/mcp/tasks/mappers": { taskMcpGetInclude: () => ({}), mapTaskToMcpGetResponse: task => task },
    "@/lib/mcp/tasks/resolveTask": { findTaskByIdentifier, TaskIdentifierAmbiguityError },
    "@/lib/mcp/pagination/cursor": {},
    "@/lib/prisma": { __esModule: true, default: { task: { findMany } } },
    "@/lib/mcp/listQuery": {},
    "@/lib/mcp/readListQuery": {},
    "@/lib/mcp/priorityFilter": {},
  });
  return { GET, TaskIdentifierAmbiguityError };
}

function withAuth(h) {
  h.wrapper.validateMcpRouteAuth = async () => ({ user: { id: 985, email: "qa@example.com" }, agentId: null });
  h.wrapper.checkMcpRouteRateLimit = async () => null;
}

test("a task list crash creates one PostHog exception with route and Prisma name, without user content", async () => {
  const h = harness();
  withAuth(h);
  const { GET } = loadTaskList(h, { findMany: async () => { throw prismaTimeout(); } });

  const response = await GET(mcpRequest("/api/mcp/tasks?ticket_number=HTPR-7334&status=open"));
  await h.settled();

  assert.equal(response.status, 500);
  assert.equal(h.reports.length, 1);
  const [report] = h.reports;
  assert.equal(report.source, "server");
  assert.equal(report.extra.route, "/api/mcp/tasks");
  assert.equal(report.extra.method, "GET");
  assert.equal(report.extra.errorName, "PrismaClientKnownRequestError");
  assert.equal(report.extra.prismaCode, "P2024");
  assert.equal(report.message, "MCP GET /api/mcp/tasks failed with PrismaClientKnownRequestError");
  const serialized = JSON.stringify({ ...report, extra: { ...report.extra, prismaMeta: undefined } });
  assert.doesNotMatch(serialized, /salary|jane@example\.com|HTPR-7334|qa@example\.com|985/);
  assert.match(report.stack, /^MCP GET \/api\/mcp\/tasks failed with PrismaClientKnownRequestError\n\s+at /);
});

test("a task list 400 for an ambiguous ticket number creates no exception", async () => {
  const h = harness();
  withAuth(h);
  let ambiguity;
  const { GET, TaskIdentifierAmbiguityError } = loadTaskList(h, { findTaskByIdentifier: async () => { throw ambiguity; } });
  ambiguity = new TaskIdentifierAmbiguityError("Ticket number matches several tasks");

  const response = await GET(mcpRequest("/api/mcp/tasks?ticket_number=HTPR-7334"));
  await h.settled();

  assert.equal(response.status, 400);
  assert.equal(h.reports.length, 0);
});

test("the route wrapper reports a bare 500 once and stays quiet on 4xx and deliberate 503", async () => {
  const h = harness();
  const answer = status => h.wrapper.wrapMcpRoute(async () => new Response(null, { status }));

  assert.equal((await answer(400)(mcpRequest("/api/mcp/boards/42"))).status, 400);
  assert.equal((await answer(404)(mcpRequest("/api/mcp/boards/42"))).status, 404);
  assert.equal((await answer(503)(mcpRequest("/api/mcp/boards/42"))).status, 503);
  await h.settled();
  assert.equal(h.reports.length, 0);

  assert.equal((await answer(500)(mcpRequest("/api/mcp/boards/42/sections/7"))).status, 500);
  await h.settled();
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].extra.route, "/api/mcp/boards/:id/sections/:id");
  assert.equal(h.reports[0].extra.errorName, "McpServerErrorWithoutCause");
});

test("an operation that reports its own crash is not reported again by the wrapper", async () => {
  const h = harness();
  const route = h.wrapper.wrapMcpRoute(async request => {
    h.crashReport.reportMcpOperationCrash(request, prismaTimeout());
    return new Response(null, { status: 500 });
  });

  await route(mcpRequest("/api/mcp/tasks/HTPR-7334/relations"));
  await h.settled();

  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].extra.errorName, "PrismaClientKnownRequestError");
  assert.equal(h.reports[0].extra.route, "/api/mcp/tasks/:id/relations");
});

test("with the route wrapper flag on, the proxied request still reports a crash exactly once", async () => {
  const jwt = require("jsonwebtoken");
  const previous = process.env.HTPR_6926_TEST_FLAG;
  process.env.HTPR_6926_TEST_FLAG = "on";
  try {
    const h = harness();
    let received;
    const route = h.wrapper.wrapMcpRoute(async request => {
      received = request;
      h.crashReport.reportMcpOperationCrash(request, prismaTimeout());
      return new Response(null, { status: 500 });
    });
    const request = mcpRequest("/api/mcp/comments");
    request.headers.set("Authorization", `Bearer ${jwt.sign({ userId: 985 }, "test-secret")}`);

    assert.equal((await route(request)).status, 500);
    await h.settled();

    assert.notEqual(received, request);
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].extra.errorName, "PrismaClientKnownRequestError");
  } finally {
    if (previous === undefined) delete process.env.HTPR_6926_TEST_FLAG;
    else process.env.HTPR_6926_TEST_FLAG = previous;
  }
});

test("a failing reporter only logs and never throws into the operation", async () => {
  const pending = [];
  const crashReport = load("src/lib/mcp/operationCrashReport.ts", {
    "@vercel/functions": { waitUntil: promise => pending.push(promise) },
    "@/lib/errors/reportError": { reportError: async () => { throw new Error("PostHog down"); } },
  });
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args[0]);
  try {
    crashReport.reportMcpOperationCrash(mcpRequest("/api/mcp/tasks"), prismaTimeout());
    await Promise.all(pending);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, ["[MCP] crash report failed"]);
});
