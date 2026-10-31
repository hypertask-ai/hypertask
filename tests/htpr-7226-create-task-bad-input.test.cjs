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

function loadPost() {
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const calls = { created: 0 };
  const stubs = {
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ({ user: { id: 1 } }),
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
    if (request === "@/lib/planLimits") return { isPlanLimitReachedError: () => false, isPlanLimitsEnabled: async () => false, assertTaskCountTransition: async () => {}, assertTicketRoom: async () => {}, assertProjectTicketRoom: async () => {}, assertBoardRoom: async () => {} };
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

const post = async (body) => {
  const { POST, calls } = loadPost();
  const res = await POST({ body: { project_id: 7, title: "t", ...body }, headers: { get: () => null } });
  return { status: res.status, body: await res.json(), calls };
};

for (const [name, body, field] of [
  ["a number description", { description: 5 }, "description"],
  ["an object description", { description: { text: "x" } }, "description"],
  ["a project id above int4", { project_id: 3000000000 }, "project_id"],
  ["a fractional section id", { section_id: 2.5 }, "section_id"],
  ["a parent id above int4", { parent_task_id: 1e12 }, "parent_task_id"],
  ["an assignee id above int4", { assignee: [1e12] }, "assignee"],
]) {
  test(`${name} is a 400 caller mistake, not a 500`, async () => {
    const { status, body: res, calls } = await post(body);
    assert.equal(status, 400, JSON.stringify(res));
    assert.equal(res.field, field);
    assert.equal(calls.created, 0);
  });
}

test("a null description creates the task with no description (was a 500)", async () => {
  const { status, calls } = await post({ description: null });
  assert.equal(status, 200);
  assert.equal(calls.created, 1);
  assert.equal(calls.data.description, "");
});

test("still allowed: valid ids and text description create the task", async () => {
  const { status, calls } = await post({ project_id: 2147483647, section_id: 5, assignee: [12], description: "hello" });
  assert.equal(status, 200);
  assert.equal(calls.created, 1);
  assert.match(calls.data.description, /hello/);
});

test("a blank description string is still refused", async () => {
  const { status, body: res } = await post({ description: "   " });
  assert.equal(status, 400);
  assert.equal(res.field, "description");
});
