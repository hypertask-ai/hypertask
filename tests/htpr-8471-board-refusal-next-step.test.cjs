const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-8471-board-refusal-next-step";

class StubResponse {
  constructor(body, status) {
    this.body = body;
    this.status = status;
  }
  static json(body, init) {
    return new StubResponse(body, init?.status ?? 200);
  }
  async json() {
    return this.body;
  }
}

function loadCreateRoute({ flagOn }) {
  const calls = { created: 0, flagChecks: [] };
  const route = load("src/lib/mcp/operations/tasks/create/operation.ts", {
    "next/server": { NextResponse: StubResponse },
    "@/lib/agents/writing": { AgentWritingError: class extends Error {} },
    "@/lib/agents/writingEnforcement": { enforceAgentWriting: async () => {} },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/planLimits": {
      isPlanLimitReachedError: () => false,
      isPlanLimitsEnabled: async () => false,
      planLimitResponse: () => null,
    },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: "agent-uuid" }),
      checkMcpRouteRateLimit: async () => null,
      readMcpRouteJsonBody: async (request) => ({ ok: true, body: request.body }),
    },
    "@/lib/mcp/tasks/validators": {
      validateCreateTaskBody: () => ({
        valid: true,
        data: { project_id: 11514, title: "CI idea", section_id: 5 },
      }),
    },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: "HYCI", teamId: 1 } }),
      getSectionForTask: async () => ({ section: { id: 5, section_title: "Backlog" } }),
      validateParentTask: async () => ({}),
      validateProjectMemberIds: async () => ({ invalidIds: [] }),
      createTask: async () => {
        calls.created += 1;
        return { id: 1 };
      },
      matchLabelIds: () => ({ ids: [], unresolved: [] }),
    },
    "@/lib/mcp/tasks/mappers": { mapTaskToDetail: (task) => task },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (html) => html },
    "@/lib/mcp/idempotency/idempotencyStore": {
      IdempotencyAccessError: class extends Error {},
      IdempotencyInProgressError: class extends Error {},
      normalizeIdempotencyKey: () => null,
      withIdempotency: async (_a, _b, _c, _d, fn) => fn(),
    },
    "@/lib/mcp/fieldError": {
      buildFieldError: (code, field, message) => ({ success: false, error: message, code, field }),
    },
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async () => false },
    "@/lib/mcp/agents": { getMcpSessionAgentSummary: async () => null },
    "@/lib/mcp/operationContext": { getMcpOperationContext: () => undefined },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => {
        calls.flagChecks.push(key);
        return flagOn;
      },
    },
    "@/lib/flags/definitions/htpr-7121-mcp-not-found-detail": { HTPR_7121_MCP_NOT_FOUND_DETAIL_FLAG: "htpr-7121-mcp-not-found-detail" },
    "@/lib/flags/definitions/htpr-8471-board-refusal-next-step": { HTPR_8471_BOARD_REFUSAL_NEXT_STEP_FLAG: FLAG },
    "@/lib/prisma": { default: { label: { findMany: async () => [] } } },
  });
  return { POST: route.POST, calls };
}

const request = () => ({ body: { title: "CI idea" }, headers: { get: () => null } });

test("the flag is a client-safe bugfix definition that keeps the everyone default", () => {
  const definitions = require("./helpers/flag-files.cjs");
  const definition = definitions.load("src/lib/flags/definitions/htpr-8471-board-refusal-next-step.ts");
  assert.equal(definition.HTPR_8471_BOARD_REFUSAL_NEXT_STEP_FLAG, FLAG);
  assert.equal(definition.default.key, FLAG);
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.defaultMode, undefined);
  assert.equal(definition.default.releaseRisk.risk, "small");
  assert.equal(definition.default.releaseRisk.highRisk, undefined);
});

test("a non-member agent is told the request tool and the board it must request", async () => {
  const { POST, calls } = loadCreateRoute({ flagOn: true });
  const response = await POST(request());
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "forbidden");
  assert.equal(response.body.field, "project_id");
  assert.match(response.body.message, /hypertask_request_board_access/);
  assert.match(response.body.message, /project_id 11514/);
  assert.match(response.body.message, /Inbox/);
  assert.doesNotMatch(response.body.message, /Ask the board owner to add it/);
  assert.equal(calls.created, 0);
  assert.deepEqual(calls.flagChecks, [FLAG]);
});

test("flag off restores the old refusal word for word", async () => {
  const { POST, calls } = loadCreateRoute({ flagOn: false });
  const response = await POST(request());
  assert.equal(response.status, 403);
  assert.equal(response.body.message, "This agent is not a member of this board. Ask the board owner to add it.");
  assert.equal(calls.created, 0);
});
