const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "src/lib/mcp/operations/tasks/create/operation.ts");
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const validators = jiti(path.join(root, "src/lib/mcp/tasks/validators.ts"));

function loadPost(ctx, agentsOnBoard) {
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const calls = { created: 0 };
  const stubs = {
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ctx,
      checkMcpRouteRateLimit: async () => null,
      readMcpRouteJsonBody: async (req) => ({ ok: true, body: req.body }),
    },
    "@/lib/mcp/tasks/validators": validators,
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: "X", teamId: 1 } }),
      getSectionForTask: async () => ({ section: { id: 5, section_title: "To do" } }),
      validateParentTask: async () => ({}),
      validateProjectMemberIds: async () => ({ invalidIds: [] }),
      createTask: async (data) => { calls.created += 1; calls.data = data; return { id: 1 }; },
      matchLabelIds: () => ({ ids: [], unresolved: [] }),
    },
    "@/lib/mcp/tasks/mappers": { mapTaskToDetail: (t) => t },
    "@/utils/controllers/agents/boardMembers": {
      isAgentOnBoard: async (projectId, agentId) => agentsOnBoard.includes(`${projectId}:${agentId}`),
    },
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/agents": { getMcpSessionAgentSummary: async () => null },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/prisma": { __esModule: true, default: {} },
  };
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request in stubs) return stubs[request];
    if (request.startsWith("@/")) return jiti(path.join(root, "src", request.slice(2)));
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    m._compile(js, file);
  } finally {
    Module._load = originalLoad;
  }
  return { POST: m.exports.POST, calls };
}

const post = async ({ ctx, agentsOnBoard = [], body = {} }) => {
  const { POST, calls } = loadPost(ctx, agentsOnBoard);
  const res = await POST({ body: { project_id: 7, title: "t", ...body }, headers: { get: () => null } });
  return { status: res.status, body: await res.json(), calls };
};

test("an agent that is not on the board gets a 403 naming the board membership, not a 500", async () => {
  const { status, body, calls } = await post({ ctx: { user: { id: 1 }, agentId: "agent-a" } });
  assert.equal(status, 403, JSON.stringify(body));
  assert.equal(body.field, "project_id");
  assert.match(body.message, /not a member of this board/);
  assert.equal(calls.created, 0);
});

test("a dry run by an agent that is not on the board is reported invalid", async () => {
  const { status, body } = await post({ ctx: { user: { id: 1 }, agentId: "agent-a" }, body: { dry_run: true } });
  assert.equal(status, 403);
  assert.equal(body.valid, false);
});

test("still allowed: an agent on the board creates the task as itself", async () => {
  const { status, calls } = await post({ ctx: { user: { id: 1 }, agentId: "agent-a" }, agentsOnBoard: ["7:agent-a"] });
  assert.equal(status, 200);
  assert.equal(calls.created, 1);
  assert.equal(calls.data.agentId, "agent-a");
});

test("still allowed: a person without an agent creates the task with no board-agent check", async () => {
  const { status, calls } = await post({ ctx: { user: { id: 1 } } });
  assert.equal(status, 200);
  assert.equal(calls.created, 1);
});
