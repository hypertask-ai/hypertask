const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "src/lib/mcp/operations/tasks/create/operation.ts");
const definitionFile = path.join(root, "src/lib/flags/definitions/htpr-8471-board-refusal-next-step.ts");
const FLAG = "htpr-8471-board-refusal-next-step";

function loadPost({ flagOn }) {
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  let created = 0;
  let flagTouched = 0;
  const json = (body, init) => ({ body, status: init && init.status });
  const stubs = {
    "@/lib/agents/writing": { AgentWritingError: class extends Error {} },
    "@/lib/agents/writingEnforcement": { enforceAgentWriting: async () => {} },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: "agent-uuid" }),
      checkMcpRouteRateLimit: async () => null,
      readMcpRouteJsonBody: async (req) => ({ ok: true, body: req.body }),
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
      validateProjectMemberIds: async () => ({}),
      createTask: async () => { created += 1; return { id: 1 }; },
      matchLabelIds: () => ({ ids: [], unresolved: [] }),
    },
    "@/lib/mcp/tasks/mappers": { mapTaskToDetail: (t) => t },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (s) => s },
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
        if (key === FLAG) flagTouched += 1;
        return flagOn;
      },
    },
    "@/lib/prisma": { __esModule: true, default: { label: { findMany: async () => [] } } },
    "next/server": { NextResponse: { json } },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/planLimits") return { isPlanLimitReachedError: () => false, isPlanLimitsEnabled: async () => false, assertTaskCountTransition: async () => {}, assertTicketRoom: async () => {}, assertProjectRoom: async () => {}, assertBoardRoom: async () => {} };
    if (request in stubs) return stubs[request];
    if (request.startsWith("@/lib/flags/definitions/")) {
      return { HTPR_7121_MCP_NOT_FOUND_DETAIL_FLAG: "htpr-7121-mcp-not-found-detail", HTPR_8471_BOARD_REFUSAL_NEXT_STEP_FLAG: FLAG };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  try {
    m._compile(js, file);
  } finally {
    Module._load = originalLoad;
  }
  return { POST: m.exports.POST, created: () => created, flagTouched: () => flagTouched };
}

const request = () => ({ body: { title: "CI idea" }, headers: { get: () => null } });

test("the flag is a client-safe bugfix definition that defaults to everyone", () => {
  const source = fs.readFileSync(definitionFile, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(definitionFile, module);
  m.filename = definitionFile;
  m.paths = Module._nodeModulePaths(path.dirname(definitionFile));
  m._compile(js, definitionFile);
  const definition = m.exports.default;
  assert.equal(m.exports.HTPR_8471_BOARD_REFUSAL_NEXT_STEP_FLAG, FLAG);
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, undefined);
  assert.ok(definition.description.length > 20);
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(definition.releaseRisk.highRisk, undefined);
});

test("a non-member agent is told the request tool and the board id it must request", async () => {
  const { POST, created, flagTouched } = loadPost({ flagOn: true });
  const res = await POST(request());
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "forbidden");
  assert.equal(res.body.field, "project_id");
  assert.match(res.body.message, /hypertask_request_board_access/);
  assert.match(res.body.message, /project_id 11514/);
  assert.match(res.body.message, /Inbox/);
  assert.doesNotMatch(res.body.message, /Ask the board owner to add it/);
  assert.equal(created(), 0);
  assert.equal(flagTouched(), 1);
});

test("flag off restores the old refusal word for word", async () => {
  const { POST, created } = loadPost({ flagOn: false });
  const res = await POST(request());
  assert.equal(res.status, 403);
  assert.equal(res.body.message, "This agent is not a member of this board. Ask the board owner to add it.");
  assert.equal(created(), 0);
});
