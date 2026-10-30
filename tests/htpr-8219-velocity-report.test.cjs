const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-8219-velocity-report";
const REPORT = { projectId: 15, range: "30d", points: [{ day: "2026-10-29", done: 3 }] };

function request(query = "") {
  return { nextUrl: { searchParams: new URLSearchParams(query) } };
}

function world({ enabled = true, authed = true, report = REPORT, args = [] } = {}) {
  const flags = [];
  const { GET } = load("src/lib/mcp/operations/reports/velocity/operation.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (handler) => handler },
    "@/lib/mcp/auth": {
      validateMcpAuth: async () => (authed ? { user: { id: 6 }, agentId: null, teamScope: null } : null),
      checkMcpRateLimit: async () => null,
    },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/flags": {
      isFeatureEnabled: async (key, userId) => {
        flags.push({ key, userId });
        return enabled;
      },
    },
    "@/utils/controllers/reports/velocityReport": {
      loadVelocityReport: async (input) => {
        args.push(input);
        return report;
      },
    },
  });
  return { GET, flags, args };
}

test("flag is an Everyone-default improvement with a release risk", () => {
  const { default: definition, HTPR_8219_VELOCITY_REPORT_FLAG } = load(
    "src/lib/flags/definitions/htpr-8219-velocity-report.ts",
    {},
  );
  assert.equal(HTPR_8219_VELOCITY_REPORT_FLAG, FLAG);
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(require("../e2e/smoke/production-flag-modes.json").modes[FLAG], "EVERYONE");
});

test("with the flag on the agent door returns the board numbers", async () => {
  const { GET, args } = world();
  const response = await GET(request("project_id=15&range=30d"));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, report: REPORT });
  assert.deepEqual(args, [{
    projectId: 15,
    userId: 6,
    actingUserId: 6,
    actingAgentId: null,
    teamScope: null,
    rangeKey: "30d",
  }]);
});

test("with the flag off the door is absent and no report is read", async () => {
  const { GET, flags, args } = world({ enabled: false });
  const response = await GET(request("project_id=15"));
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { success: false, error: "Not found" });
  assert.deepEqual(args, []);
  assert.deepEqual(flags, [{ key: FLAG, userId: 6 }]);
});

test("the flag is read for the signed-in user before any board work", async () => {
  const { GET, flags } = world();
  await GET(request("project_id=15"));
  assert.deepEqual(flags, [{ key: FLAG, userId: 6 }]);
});

test("an unsigned request is refused before the flag is read", async () => {
  const { GET, flags } = world({ authed: false });
  const response = await GET(request("project_id=15"));
  assert.equal(response.status, 401);
  assert.deepEqual(flags, []);
});

test("a missing project_id is a field error, not a crash", async () => {
  const { GET, args } = world();
  const response = await GET(request(""));
  assert.equal(response.status, 400);
  assert.equal(args.length, 0);
});

test("a board the caller cannot see is refused as not found", async () => {
  const { GET } = world({ report: null });
  const response = await GET(request("project_id=99"));
  assert.equal(response.status, 404);
});
