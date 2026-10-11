const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "src/lib/mcp/operations/tasks/create/operation.ts");

function loadPost({ flagOn, knownLabelIds }) {
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  let created = 0;
  const json = (body, init) => ({ body, status: init && init.status });
  const stubs = {
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ({ user: { id: 1 } }),
      checkMcpRouteRateLimit: async () => null,
      readMcpRouteJsonBody: async (req) => ({ ok: true, body: req.body }),
    },
    "@/lib/mcp/tasks/validators": {
      validateCreateTaskBody: (body) => ({
        valid: true,
        data: { project_id: 7, title: "t", section_id: 5, labels: body.labels },
      }),
    },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: "X", teamId: 1 } }),
      getSectionForTask: async () => ({ section: { id: 5, section_title: "To do" } }),
      validateParentTask: async () => ({}),
      validateProjectMemberIds: async () => ({}),
      createTask: async () => { created += 1; return { id: 1 }; },
    },
    "@/lib/mcp/tasks/mappers": { mapTaskToDetail: (t) => t },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (s) => s },
    "@/lib/mcp/idempotency/idempotencyStore": {
      IdempotencyInProgressError: class extends Error {},
      normalizeIdempotencyKey: () => null,
      withIdempotency: async (_a, _b, _c, _d, fn) => fn(),
    },
    "@/lib/mcp/fieldError": {
      buildFieldError: (code, field, message) => ({ success: false, error: message, code, field }),
    },
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/agents": { getMcpSessionAgentSummary: async () => null },
    "@/lib/flags": { isFeatureEnabled: async () => flagOn },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        label: {
          findMany: async ({ where }) =>
            where.id.in.filter((id) => knownLabelIds.includes(id)).map((id) => ({ id })),
        },
      },
    },
    "next/server": { NextResponse: { json } },
  };
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request in stubs) return stubs[request];
    if (request.startsWith("@/lib/flags/definitions/")) {
      return { HTPR_7121_MCP_NOT_FOUND_DETAIL_FLAG: "htpr-7121-mcp-not-found-detail" };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    m._compile(js, file);
  } finally {
    Module._load = originalLoad;
  }
  return { POST: m.exports.POST, created: () => created };
}

const request = (labels) => ({ body: { labels }, headers: { get: () => null } });

test("unknown label ids return a 404 that names them (flag on)", async () => {
  const { POST, created } = loadPost({ flagOn: true, knownLabelIds: ["a"] });
  const res = await POST(request(["a", "zzz", "yyy"]));
  assert.equal(res.status, 404);
  assert.equal(res.body.field, "labels");
  assert.match(res.body.message, /Label\(s\) not found on board 7: zzz, yyy/);
  assert.doesNotMatch(res.body.message, /\ba,/);
  assert.equal(created(), 0);
});

test("known labels still create the ticket", async () => {
  const { POST, created } = loadPost({ flagOn: true, knownLabelIds: ["a", "b"] });
  const res = await POST(request(["a", "b"]));
  assert.equal(res.status, 200);
  assert.equal(created(), 1);
});

test("flag off keeps the old path (no pre-check)", async () => {
  const { POST, created } = loadPost({ flagOn: false, knownLabelIds: [] });
  const res = await POST(request(["zzz"]));
  assert.equal(res.status, 200);
  assert.equal(created(), 1);
});
