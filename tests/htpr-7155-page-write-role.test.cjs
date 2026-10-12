// HTPR-7155: read-only agents must not create, update, archive or restore task pages.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(relPath, mockRequire) {
  const source = fs.readFileSync(path.join(root, relPath), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, mockRequire);
  return mod.exports;
}

const nextServer = {
  NextResponse: {
    json: (body, init) => ({ status: init?.status ?? 200, body }),
  },
};

function harness({ agentId, role }) {
  const calls = [];
  const record = (name, value) => (...args) => {
    calls.push(name);
    return value;
  };
  const prisma = {
    agent: { findUnique: async () => ({ permissions: role ? { role } : {} }) },
  };
  const scopes = load("src/lib/mcp/agents/scopes.ts", (request) => {
    if (request === "@/lib/prisma") return prisma;
    if (request === "next/server") return nextServer;
    throw new Error(`Unexpected scopes import: ${request}`);
  });
  const rateLimited = { status: 429, body: { reached: "rate-limit" } };
  const mockRequire = (request) => {
    if (request === "next/server") return nextServer;
    if (request === "@/lib/mcp/agents/scopes") return scopes;
    if (request === "@/lib/mcp/auth") {
      return {
        validateMcpAuth: async () => ({ user: { id: 7 }, agentId }),
        checkMcpRateLimit: async () => {
          calls.push("checkMcpRateLimit");
          return rateLimited;
        },
      };
    }
    // Every other dependency (page service, helpers, idempotency) records any call.
    return new Proxy({}, { get: (_t, name) => record(`${request}#${String(name)}`, undefined) });
  };
  return { calls, mockRequire };
}

const request = { json: async () => ({ id: 1, task_id: 1, content: "x" }) };
const operations = ["create", "update", "archive", "restore"];

for (const op of operations) {
  const rel = `src/lib/mcp/operations/pages/${op}/operation.ts`;

  test(`${op}: a read-only agent gets 403 before anything else runs`, async () => {
    const { calls, mockRequire } = harness({ agentId: "agent-read", role: "read" });
    const { POST } = load(rel, mockRequire);
    const response = await POST(request);
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "insufficient_scope");
    assert.deepEqual(calls, [], `no page work may run, saw: ${calls.join(", ")}`);
  });

  test(`${op}: a write agent passes the role guard`, async () => {
    const { calls, mockRequire } = harness({ agentId: "agent-write", role: "write" });
    const { POST } = load(rel, mockRequire);
    const response = await POST(request);
    assert.equal(response.status, 429);
    assert.deepEqual(calls, ["checkMcpRateLimit"]);
  });

  test(`${op}: an agent with no stored role keeps write access`, async () => {
    const { mockRequire } = harness({ agentId: "agent-default", role: null });
    const { POST } = load(rel, mockRequire);
    assert.equal((await POST(request)).status, 429);
  });

  test(`${op}: a plain user token is not role-checked`, async () => {
    const { mockRequire } = harness({ agentId: null, role: "read" });
    const { POST } = load(rel, mockRequire);
    assert.equal((await POST(request)).status, 429);
  });
}
