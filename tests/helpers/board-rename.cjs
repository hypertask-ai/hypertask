const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTs(file, stubs) {
  const source = ts.transpileModule(read(file), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", source)(
    mod, mod.exports, (request) => {
      if (request === "@/lib/mcp/routeWrapper") return require("./mcp-route-wrapper.cjs").loadRouteWrapper(stubs);
      assert.ok(request in stubs, `Unexpected import: ${request}`);
      return stubs[request];
    },
  );
  return mod.exports;
}

const access = loadTs("src/utils/controllers/projects/getAllIncludes.ts", {
  "@prisma/client": {},
  "@/lib/agents/publicAgent": {},
  "@/lib/cycles": {},
  "@/lib/agents/visibility": {},
  "@/utils/controllers/notifications/visibleInboxScope": {},
});

function matches(value, where) {
  if (value == null) return false;
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((branch) => matches(value, branch));
    if (key === "AND") return (Array.isArray(expected) ? expected : [expected]).every((branch) => matches(value, branch));
    const actual = value[key];
    if (expected && typeof expected === "object") {
      if ("not" in expected) return actual !== expected.not;
      if ("some" in expected) return (actual ?? []).some((row) => matches(row, expected.some));
      return matches(actual, expected);
    }
    return actual === expected;
  });
}

function harness({ ownerId = 99, ownerAgents = [], members = [], status = "Normal", missing = false, auth = { user: { id: 6 }, agentId: null }, rateLimited = null, loseAccess = false } = {}) {
  const updates = [];
  const broadcasts = [];
  const board = { id: 15, title: "Old name", name: "project-15", ownerId, owner: { id: ownerId, agents: ownerAgents }, members, status, tasks: [], sorting_mode: "Manual", uniqueIdentifier: "HTPR" };
  const prisma = {
    project: {
      findFirst: async ({ where }) => !missing && matches(board, where) ? board : null,
      update: async (args) => {
        if (loseAccess || !matches(board, args.where)) throw { code: "P2025" };
        updates.push(args);
        for (const [key, value] of Object.entries(args.data)) {
          if (value !== undefined) board[key] = value;
        }
        return board;
      },
    },
  };
  const controller = loadTs("src/utils/controllers/projects/update.ts", {
    "@/lib/prisma": prisma,
    "@/lib/flags": {},
    "@vercel/functions": {},
    "../turbopuffer/turbopufferHelper": {},
    "@/lib/projectPrefix": {},
    "./getAllIncludes": access,
  }).default;
  const userRecord = { loadSessionUserRecord: async (id) => ({ id }) };
  const realtime = { broadcastBoardChange: async (...args) => { broadcasts.push(args); } };
  const route = loadTs("src/lib/mcp/operations/projects/[projectId]/operation.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/mcp/auth": {
      validateMcpAuth: async () => auth,
      checkMcpRateLimit: async () => rateLimited,
    },
    "@/lib/auth/sessionUserRecord": userRecord,
    "@/utils/controllers/projects/update": controller,
    "@/lib/realtime/server": realtime,
  });
  const patch = (title, projectId = "15", rawBody) => route.PATCH(
    new Request(`http://localhost/api/mcp/projects/${projectId}`, {
      method: "PATCH",
      body: rawBody ?? JSON.stringify({ title }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ projectId }) },
  );
  return { patch, controller, updates, broadcasts, board, route, userRecord, realtime };
}

const humanMember = (role = "Member", overrides = {}) => ({ userId: 6, agentId: null, role, ...overrides });
const agentMember = (overrides = {}) => ({
  userId: 6,
  agentId: "agent-owned",
  role: "Member",
  agent: { userId: 6, revokedAt: null },
  ...overrides,
});

module.exports = { read, loadTs, harness, humanMember, agentMember };
