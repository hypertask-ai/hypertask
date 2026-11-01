const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const FLAG_KEY = "htpr-7665-agent-read-role-guard";
const compiled = new Map();

function compile(relPath) {
  if (!compiled.has(relPath)) {
    compiled.set(relPath, ts.transpileModule(fs.readFileSync(path.join(root, relPath), "utf8"), {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText);
  }
  return compiled.get(relPath);
}

function load(relPath, mockRequire) {
  const mod = { exports: {} };
  new Function("module", "exports", "require", compile(relPath))(mod, mod.exports, mockRequire);
  return mod.exports;
}

class FakeResponse {
  constructor(body, status) {
    this.body = body;
    this.status = status;
    this.headers = new Headers();
  }
  async json() {
    return this.body;
  }
  static json(body, init) {
    return new FakeResponse(body, init?.status ?? 200);
  }
}

const nextServer = { NextResponse: FakeResponse, NextRequest: class {} };

function recorder(label, sink) {
  return new Proxy(function () {}, {
    get(_target, property) {
      if (property === "then" || property === "__esModule" || typeof property === "symbol") return undefined;
      return recorder(`${label}.${String(property)}`, sink);
    },
    apply() {
      sink.push(label);
      return undefined;
    },
    construct() {
      sink.push(`new ${label}`);
      return {};
    },
  });
}

const ROLE_ERROR = new Error("agent row unavailable");
const FLAG_ERROR = new Error("flag store unavailable");

function world({ agentId = "agent-1", ctxRole, dbRole, flag = "on" }) {
  const sideEffects = [];
  const guardResults = [];
  const counters = { agentReads: 0, flagReads: 0 };
  const warnings = [];
  const ctx = { user: { id: 7, email: "owner@example.invalid" }, agentId, teamScope: null, ...(ctxRole ? { agentRole: ctxRole } : {}) };
  const prisma = {
    agent: {
      findUnique: async () => {
        counters.agentReads += 1;
        if (dbRole === "throw") throw ROLE_ERROR;
        return { permissions: dbRole ? { role: dbRole } : {} };
      },
    },
  };
  const flags = {
    isFeatureEnabled: async (key, userId) => {
      if (key !== FLAG_KEY) return false;
      counters.flagReads += 1;
      assert.equal(userId, 7, "the flag is evaluated for the owner user id");
      if (flag === "throw") throw FLAG_ERROR;
      return flag === "on";
    },
  };
  const flagKeys = { HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG: FLAG_KEY };
  const scopes = load("src/lib/mcp/agents/scopes.ts", (request) => {
    if (request === "@/lib/prisma") return prisma;
    if (request === "next/server") return nextServer;
    throw new Error(`Unexpected scopes import: ${request}`);
  });
  const realGuard = load("src/lib/mcp/agents/readRoleGuard.ts", (request) => {
    if (request === "@/lib/mcp/agents/scopes") return scopes;
    if (request === "@/lib/flags") return flags;
    if (request === "@/lib/flags/keys") return flagKeys;
    throw new Error(`Unexpected guard import: ${request}`);
  });
  const guard = {
    ...realGuard,
    requireAgentWriteRole: async (...args) => {
      const result = await realGuard.requireAgentWriteRole(...args).catch((error) => {
        guardResults.push(error);
        throw error;
      });
      guardResults.push(result);
      return result;
    },
  };
  const auth = {
    validateMcpAuth: async () => ctx,
    checkMcpRateLimit: async () => null,
    createUnauthorizedResponse: () => ({ status: 401, body: { error: "unauthorized" } }),
    mcpUnauthorizedResponse: async () => ({ status: 401, body: { error: "unauthorized" } }),
    extractBearerToken: () => null,
  };
  const wrapper = require("./helpers/mcp-route-wrapper.cjs").loadRouteWrapper({
    "@/lib/mcp/auth": auth,
    "@/lib/aiFeedback/automatic": { queueRestFailure: () => {} },
    "@/lib/flags": flags,
    "@/lib/flags/keys": flagKeys,
  });
  const quiet = console.warn;
  return {
    ctx, sideEffects, guardResults, counters, warnings, scopes, guard, flags, flagKeys, prisma, auth, wrapper,
    muteWarnings: () => { console.warn = (...args) => warnings.push(args); },
    restoreWarnings: () => { console.warn = quiet; },
    mockRequire(extra = {}) {
      const mocks = {
        "@/lib/mcp/routeWrapper": wrapper,
        "next/server": nextServer,
        "@/lib/mcp/auth": auth,
        "@/lib/mcp/agents/scopes": scopes,
        "@/lib/mcp/agents/readRoleGuard": guard,
        zod: require("zod"),
        ...extra,
      };
      return (request) => (request in mocks ? mocks[request] : recorder(request, sideEffects));
    },
  };
}

function httpRequest(url, method, body) {
  return {
    method,
    url,
    nextUrl: new URL(url),
    headers: new Headers({ Authorization: `Bearer ${require("jsonwebtoken").sign({ userId: 7 }, "fixture")}`, "content-type": "application/json" }),
    json: async () => body ?? {},
    text: async () => JSON.stringify(body ?? {}),
    clone() { return this; },
  };
}

const READ_REFUSED = { agentId: "agent-read", ctxRole: "read", flag: "on" };
const SCENARIOS_STILL_ALLOWED = {
  "write agent": { agentId: "agent-write", ctxRole: "write", flag: "on" },
  "admin agent": { agentId: "agent-admin", ctxRole: "admin", flag: "on" },
  "agent with no stored role": { agentId: "agent-default", ctxRole: "write", dbRole: undefined, flag: "on" },
  "agent with no stored role and no carried role": { agentId: "agent-default", ctxRole: undefined, dbRole: undefined, flag: "on" },
  "human": { agentId: null, flag: "on" },
  "read agent with the flag off": { agentId: "agent-read", ctxRole: "read", flag: "off" },
  "read agent when the flag lookup fails": { agentId: "agent-read", ctxRole: "read", flag: "throw" },
};

const OPS = "src/lib/mcp/operations";
const API = "src/app/api/mcp";
const putAwayContext = (w) => ({
  "@/lib/mcp/tasks/putAwayTask": load("src/lib/mcp/tasks/putAwayTask.ts", w.mockRequire()),
});
const timeContext = (w) => ({
  "@/lib/mcp/operations/time/helpers": {
    resolveMcpTimeTask: async () => ({ ctx: w.ctx, task: { id: 1 }, body: { minutes: 5 }, response: null }),
    authenticateMcpTime: async () => ({ ctx: w.ctx, body: { entry_id: 1 }, response: null }),
  },
  "../_lib": {
    authenticateMcpTime: async () => ({ ctx: w.ctx, body: { entry_id: 1 }, response: null }),
    readEntryId: () => ({ entryId: 1, response: null }),
  },
});

const CASES = [
  { area: "7664 archive", name: "projects/archive", file: `${OPS}/projects/archive/operation.ts`, method: "POST", body: { project_id: 1, status: "Archive" } },
  { area: "7665 webhooks", name: "webhooks POST", file: `${OPS}/webhooks/operation.ts`, method: "POST", body: { url: "https://example.invalid/hook" } },
  { area: "7665 webhooks", name: "webhooks DELETE", file: `${OPS}/webhooks/operation.ts`, method: "DELETE" },
  { area: "7665 webhooks", name: "webhooks/{id}/test", file: `${API}/webhooks/[id]/test/route.ts`, method: "POST", params: { id: "1" } },
  { area: "7666 skills", name: "skills POST", file: `${OPS}/skills/operation.ts`, method: "POST", body: { name: "x" } },
  { area: "7666 skills", name: "skills PATCH", file: `${OPS}/skills/[skill_id]/operation.ts`, method: "PATCH", params: { skill_id: "1" }, body: { name: "x" } },
  { area: "7666 skills", name: "skills DELETE", file: `${OPS}/skills/[skill_id]/operation.ts`, method: "DELETE", params: { skill_id: "1" } },
  { area: "7666 skills", name: "skills import", file: `${OPS}/skills/import/operation.ts`, method: "POST", body: { markdown: "x" } },
  { area: "7667 playbook and instructions", name: "playbook PUT", file: `${OPS}/projects/[projectId]/playbook/operation.ts`, method: "PUT", params: { projectId: "1" } },
  { area: "7667 playbook and instructions", name: "instructions PUT", file: `${OPS}/projects/[projectId]/instructions/operation.ts`, method: "PUT", params: { projectId: "1" } },
  { area: "7668 labels and custom fields", name: "labels POST", file: `${OPS}/projects/[projectId]/labels/operation.ts`, method: "POST", params: { projectId: "1" }, body: { value: "x" } },
  { area: "7668 labels and custom fields", name: "custom-fields POST", file: `${OPS}/custom-fields/operation.ts`, method: "POST", body: { name: "x" } },
  { area: "7668 labels and custom fields", name: "custom-fields/value POST", file: `${OPS}/custom-fields/value/operation.ts`, method: "POST", body: {} },
  { area: "7668 labels and custom fields", name: "custom-fields/{fieldId} DELETE", file: `${API}/custom-fields/[fieldId]/route.ts`, method: "DELETE", params: { fieldId: "f" } },
  { area: "7669 views and reports", name: "view POST", file: `${OPS}/view/operation.ts`, method: "POST", body: { name: "x" } },
  { area: "7669 views and reports", name: "view PATCH", file: `${OPS}/view/[viewId]/operation.ts`, method: "PATCH", params: { viewId: "v" } },
  { area: "7669 views and reports", name: "view DELETE", file: `${OPS}/view/[viewId]/operation.ts`, method: "DELETE", params: { viewId: "v" } },
  { area: "7669 views and reports", name: "reports/create", file: `${OPS}/reports/create/operation.ts`, method: "POST", body: {} },
  { area: "7669 views and reports", name: "reports/update", file: `${OPS}/reports/update/operation.ts`, method: "POST", body: {} },
  { area: "7669 views and reports", name: "reports/delete", file: `${OPS}/reports/delete/operation.ts`, method: "POST", body: {} },
  { area: "7670 move, assignees, relations, description restore", name: "tasks/move", file: `${OPS}/tasks/move/operation.ts`, method: "POST", body: { task_id: 1, target_project_id: 2 } },
  { area: "7670 move, assignees, relations, description restore", name: "assignees/assign", file: `${OPS}/assignees/assign/operation.ts`, method: "POST", body: { task_id: 1 } },
  { area: "7670 move, assignees, relations, description restore", name: "relations POST", file: `${OPS}/tasks/relations/operation.ts`, method: "POST", body: {} },
  { area: "7670 move, assignees, relations, description restore", name: "relations DELETE", file: `${OPS}/tasks/relations/operation.ts`, method: "DELETE", body: {} },
  { area: "7670 move, assignees, relations, description restore", name: "description-restore", file: `${OPS}/tasks/description-restore/operation.ts`, method: "POST", body: {} },
  { area: "7671 comments, drafts publish, escalate, decisions", name: "comment PATCH", file: `${OPS}/comments/[comment_id]/operation.ts`, method: "PATCH", params: { comment_id: "1" }, body: { content: "x" } },
  { area: "7671 comments, drafts publish, escalate, decisions", name: "comment DELETE", file: `${OPS}/comments/[comment_id]/operation.ts`, method: "DELETE", params: { comment_id: "1" } },
  { area: "7671 comments, drafts publish, escalate, decisions", name: "drafts/{id}/publish", file: `${OPS}/drafts/[draft_id]/publish/operation.ts`, method: "POST", params: { draft_id: "1" } },
  { area: "7671 comments, drafts publish, escalate, decisions", name: "tasks/escalate", file: `${API}/tasks/escalate/route.ts`, method: "POST", body: {} },
  { area: "7671 comments, drafts publish, escalate, decisions", name: "decisions POST", file: `${OPS}/decisions/operation.ts`, method: "POST", body: {} },
  { area: "7672 time and evidence", name: "time/start", file: `${OPS}/time/start/operation.ts`, method: "POST", context: timeContext },
  { area: "7672 time and evidence", name: "time/stop", file: `${OPS}/time/stop/operation.ts`, method: "POST", context: timeContext },
  { area: "7672 time and evidence", name: "time/pause", file: `${OPS}/time/pause/operation.ts`, method: "POST", context: timeContext },
  { area: "7672 time and evidence", name: "time/resume", file: `${OPS}/time/resume/operation.ts`, method: "POST", context: timeContext },
  { area: "7672 time and evidence", name: "time/log", file: `${OPS}/time/log/operation.ts`, method: "POST", context: timeContext },
  { area: "7672 time and evidence", name: "time/delete", file: `${API}/time/delete/route.ts`, method: "POST", context: timeContext },
  { area: "7672 time and evidence", name: "time/update", file: `${API}/time/update/route.ts`, method: "POST", context: timeContext },
  { area: "7672 time and evidence", name: "tasks/evidence", file: `${API}/tasks/evidence/route.ts`, method: "POST", body: {} },
  { area: "also guarded", name: "inbox/move", file: `${OPS}/inbox/move/operation.ts`, method: "POST", body: {} },
  { area: "also guarded", name: "tasks/lease/claim", file: `${API}/tasks/lease/claim/route.ts`, method: "POST", body: {} },
  { area: "also guarded", name: "tasks/lease/heartbeat", file: `${API}/tasks/lease/heartbeat/route.ts`, method: "POST", body: {} },
  { area: "also guarded", name: "tasks/archive", file: `${OPS}/tasks/archive/operation.ts`, method: "POST", body: { task_id: 1 }, context: putAwayContext },
  { area: "also guarded", name: "tasks/delete", file: `${OPS}/tasks/delete/operation.ts`, method: "POST", body: { task_id: 1 }, context: putAwayContext },
  { area: "also guarded", name: "tasks/waiting-on", file: `${OPS}/tasks/waiting-on/operation.ts`, method: "POST", body: { taskId: 1, userId: null } },
  { area: "also guarded", name: "tasks/follow", file: `${OPS}/tasks/follow/operation.ts`, method: "POST", body: { action: "follow", taskId: 1 } },
  { area: "also guarded", name: "tasks/session", file: `${API}/tasks/session/route.ts`, method: "POST", body: {} },
  { area: "also guarded", name: "view/{id}/apply", file: `${OPS}/view/[viewId]/apply/operation.ts`, method: "POST", params: { viewId: "v" } },
  {
    area: "also guarded",
    name: "chat/rooms/{roomId}/messages",
    file: `${API}/chat/rooms/[roomId]/messages/route.ts`,
    method: "POST",
    agentOnly: true,
    params: { roomId: "room-1" },
    body: { text: "hi" },
    context: () => ({ "@/lib/agents/roomAccess": { loadAgentTokenRoom: async () => ({ id: "room-1" }) } }),
  },
];

function writeEffects(w) {
  return w.sideEffects.filter((effect) => !/rror|Crash/.test(effect));
}

function isRoleRefusal(response) {
  return response?.status === 403 && response?.body?.code === "insufficient_scope";
}

async function run(spec, scenario) {
  const w = world(scenario);
  const extra = spec.context ? spec.context(w) : {};
  const handler = load(spec.file, w.mockRequire(extra))[spec.method];
  assert.equal(typeof handler, "function", `${spec.file} exports ${spec.method}`);
  w.sideEffects.length = 0;
  const request = httpRequest("http://localhost/api/mcp/x", spec.method, spec.body);
  let response;
  let error = null;
  try {
    response = await handler(request, { params: Promise.resolve(spec.params ?? {}) });
  } catch (caught) {
    error = caught;
  }
  return { w, response, error };
}

for (const spec of CASES) {
  test(`${spec.area}: ${spec.name} now refuses a read agent with the flag on`, async () => {
    const { w, response, error } = await run(spec, READ_REFUSED);
    assert.equal(error, null);
    assert.ok(isRoleRefusal(response), `expected 403 insufficient_scope, got ${JSON.stringify(response)}`);
    assert.match(response.body.error, /role \('read'\) does not permit this action; requires 'write' or higher/);
    assert.deepEqual(writeEffects(w), [], "no write function or other module ran");
    assert.equal(w.guardResults.length, 1);
    assert.equal(w.counters.agentReads, 0, "the carried role means no extra agent query");
  });

  test(`${spec.area}: ${spec.name} refuses a read agent whose role comes from the agent row`, async () => {
    const { w, response } = await run(spec, { agentId: "agent-read", ctxRole: undefined, dbRole: "read", flag: "on" });
    assert.ok(isRoleRefusal(response));
    assert.deepEqual(writeEffects(w), []);
    assert.equal(w.counters.agentReads, 1);
  });

  for (const [label, scenario] of Object.entries(SCENARIOS_STILL_ALLOWED)) {
    if (spec.agentOnly && scenario.agentId === null) continue;
    test(`${spec.area}: ${spec.name} still allows a ${label}`, async () => {
      const { w, response } = await run(spec, scenario);
      assert.ok(!isRoleRefusal(response), `unexpected role refusal for ${label}`);
      assert.equal(w.guardResults.length, 1, "the handler calls the guard once");
      assert.equal(w.guardResults[0], null);
    });
  }

  test(`${spec.area}: ${spec.name} never runs when the role lookup fails`, async () => {
    const { w, response, error } = await run(spec, { agentId: "agent-read", ctxRole: undefined, dbRole: "throw", flag: "on" });
    assert.deepEqual(writeEffects(w), [], "no write ran");
    assert.ok(error === ROLE_ERROR || !response || response.status >= 400, "never reported as success");
    assert.ok(!(response && response.status < 300));
    assert.equal(w.guardResults[0], ROLE_ERROR);
  });
}

test("helper: no agent id returns immediately without reading the flag or the agent row", async () => {
  const w = world({ agentId: null });
  assert.equal(await w.guard.requireAgentWriteRole(w.ctx), null);
  assert.deepEqual(w.counters, { agentReads: 0, flagReads: 0 });
});

test("helper: a carried write or admin role skips the flag lookup and the agent query", async () => {
  for (const role of ["write", "admin"]) {
    const w = world({ ctxRole: role });
    assert.equal(await w.guard.requireAgentWriteRole(w.ctx), null);
    assert.deepEqual(w.counters, { agentReads: 0, flagReads: 0 });
  }
});

test("helper: flag off returns null before any role lookup", async () => {
  const w = world({ ctxRole: "read", flag: "off" });
  assert.equal(await w.guard.requireAgentWriteRole(w.ctx), null);
  assert.deepEqual(w.counters, { agentReads: 0, flagReads: 1 });
});

test("helper: a flag lookup error is logged and treated as off, so old behaviour stays", async () => {
  const w = world({ ctxRole: "read", flag: "throw" });
  w.muteWarnings();
  try {
    assert.equal(await w.guard.requireAgentWriteRole(w.ctx), null);
  } finally {
    w.restoreWarnings();
  }
  assert.equal(w.warnings.length, 1);
  assert.equal(w.counters.agentReads, 0);
});

test("helper: a role lookup error propagates and never defaults to write", async () => {
  const w = world({ ctxRole: undefined, dbRole: "throw", flag: "on" });
  await assert.rejects(w.guard.requireAgentWriteRole(w.ctx), ROLE_ERROR);
});

test("helper: the refusal body is the one requireRole returns", async () => {
  const w = world({ ctxRole: "read", flag: "on" });
  const fromGuard = await w.guard.requireAgentWriteRole(w.ctx);
  const fromRequireRole = await w.scopes.requireRole({ ...w.ctx, agentRole: undefined }, "write").catch(() => null);
  assert.equal(fromGuard.status, 403);
  assert.deepEqual(fromGuard.body, {
    success: false,
    error: "This agent's role ('read') does not permit this action; requires 'write' or higher.",
    code: "insufficient_scope",
  });
  assert.equal(fromRequireRole, null, "requireRole reads the stored role, which is write here");
  const stored = world({ ctxRole: undefined, dbRole: "read" });
  const reference = await stored.scopes.requireRole(stored.ctx, "write");
  assert.deepEqual(fromGuard.body, reference.body);
});

test("helper: an unknown stored role is treated like read, as requireRole does", async () => {
  const w = world({ ctxRole: undefined, dbRole: "READ", flag: "on" });
  assert.equal((await w.guard.requireAgentWriteRole(w.ctx)).status, 403);
});

test("existing requireRole call sites keep their behaviour with the flag off", async () => {
  const w = world({ ctxRole: undefined, dbRole: "read", flag: "off" });
  const refusal = await w.scopes.requireRole(w.ctx, "write");
  assert.equal(refusal.status, 403);
  assert.equal(w.counters.flagReads, 0);
});

const ALLOWED_FOR_READ_AGENTS = [
  { name: "hello", file: `${OPS}/hello/operation.ts`, method: "POST" },
  { name: "tasks/related", file: `${OPS}/tasks/related/operation.ts`, method: "POST" },
  { name: "time/status", file: `${OPS}/time/status/operation.ts`, method: "POST", context: timeContext },
  { name: "tasks/batch", file: `${API}/tasks/batch/route.ts`, method: "POST" },
  { name: "ai/improve", file: `${API}/ai/improve/route.ts`, method: "POST" },
  { name: "ai/task-writer", file: `${API}/ai/task-writer/route.ts`, method: "POST" },
  { name: "drafts POST", file: `${OPS}/drafts/operation.ts`, method: "POST" },
  { name: "drafts/{id} PATCH", file: `${OPS}/drafts/[draft_id]/operation.ts`, method: "PATCH", params: { draft_id: "1" } },
  { name: "drafts/{id} DELETE", file: `${OPS}/drafts/[draft_id]/operation.ts`, method: "DELETE", params: { draft_id: "1" } },
  { name: "inbox/seen", file: `${API}/inbox/seen/route.ts`, method: "POST" },
  { name: "inbox/archive", file: `${OPS}/inbox/archive/operation.ts`, method: "POST" },
  { name: "inbox/unarchive", file: `${OPS}/inbox/unarchive/operation.ts`, method: "POST" },
  { name: "tasks/card-actions", file: `${API}/tasks/card-actions/route.ts`, method: "POST" },
  { name: "agents/runs", file: `${OPS}/agents/[agentId]/operation.ts`, method: "POST", params: { agentId: "runs" } },
  { name: "agents/runs/{id}/activities", file: `${API}/agents/runs/[id]/activities/route.ts`, method: "POST", params: { id: "r" } },
  { name: "agents/runs/{id}/stop", file: `${API}/agents/runs/[id]/stop/route.ts`, method: "POST", params: { id: "r" } },
  { name: "agents/runtime-heartbeat", file: `${API}/agents/runtime-heartbeat/route.ts`, method: "POST" },
  { name: "chat/rooms/messages/{id}/handled", file: `${API}/chat/rooms/messages/[messageId]/handled/route.ts`, method: "POST", params: { messageId: "m" } },
  { name: "chat/activity", file: `${API}/chat/activity/route.ts`, method: "POST" },
  { name: "chat/sessions/{id}/messages", file: `${API}/chat/sessions/[sessionId]/messages/route.ts`, method: "POST", params: { sessionId: "s" } },
  { name: "cli-error", file: `${API}/cli-error/route.ts`, method: "POST" },
  { name: "feedback", file: `${API}/feedback/route.ts`, method: "POST" },
  { name: "tasks/lease/release", file: `${API}/tasks/lease/release/route.ts`, method: "POST" },
  { name: "token/refresh", file: `${API}/token/refresh/route.ts`, method: "POST" },
  { name: "token DELETE", file: `${API}/token/route.ts`, method: "DELETE" },
  { name: "decisions/{id} PATCH", file: `${OPS}/decisions/[id]/operation.ts`, method: "PATCH", params: { id: "d" } },
];

for (const spec of ALLOWED_FOR_READ_AGENTS) {
  test(`still allowed for a read agent with the flag on: ${spec.name} never reaches the guard and the flag is never read`, async () => {
    const { w, response } = await run(spec, READ_REFUSED);
    assert.ok(!isRoleRefusal(response));
    assert.equal(w.guardResults.length, 0);
    assert.equal(w.counters.flagReads, 0);
  });
}

const READ_HANDLERS = [
  { name: "task read", file: `${OPS}/tasks/operation.ts`, method: "GET" },
  { name: "task search", file: `${OPS}/tasks/search/operation.ts`, method: "GET" },
];

for (const spec of READ_HANDLERS) {
  test(`a read agent can still use ${spec.name} (inner operation of the MCP read tools)`, async () => {
    const { w, response } = await run(spec, READ_REFUSED);
    assert.ok(!isRoleRefusal(response));
    assert.equal(w.guardResults.length, 0);
    assert.equal(w.counters.flagReads, 0);
  });
}

test("a read agent can still do MCP JSON-RPC initialize and tools/list (the guard is not in the protocol layer)", async () => {
  const { loader } = require("./htpr-6927-fixtures.cjs");
  const readAgent = { user: { id: 7 }, agentId: "agent-read", agentRole: "read", teamScope: null };
  const load2 = loader({
    "@/lib/prisma": { __esModule: true, default: { featureFlag: { findUnique: async () => null }, agent: { findUnique: async () => ({ permissions: { role: "read" } }) } } },
    react: { cache: (fn) => fn },
    "./tools": { MCP_TOOLS: [] },
    "@/lib/mcp/auth": {
      extractBearerToken: (header) => header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null,
      validateMcpAuth: async () => readAgent,
    },
    "@/lib/aiFeedback/enabled": { aiFeedbackEnabled: async () => false },
    "@/lib/aiFeedback/automatic": { observeFeedbackTools: (tools) => tools, queueAiFeedback: () => {}, queueMcpAuthFailure: () => {} },
    "@/lib/aiFeedback/clientInfo": { rememberFeedbackClient: () => {} },
    "@/lib/telemetry/mcpSseAnalytics": { recordLegacyMcpRequest: () => {} },
    "./legacy-sse": { isLegacySseRequest: () => false },
  });
  const { mcpHandler } = load2("src/lib/mcp-server/handler.ts");
  const rpc = (id, method, params) => new Request("https://app.hypertask.ai/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer valid-token" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const init = await mcpHandler(rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "fixture", version: "1" } }));
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.protocolVersion, "2025-03-26");
});

const NATIVE_FILE_DIR = "src/lib/ai/tools";

function nativeToolNames() {
  const source = fs.readFileSync(path.join(root, NATIVE_FILE_DIR, "index.ts"), "utf8");
  return [...source.matchAll(/^\s{4}(\w+): create\w+Tool\(context\)/gm)].map((match) => match[1]);
}

function nativeWorld(scenario) {
  const w = world({ ...scenario, dbRole: scenario.dbRole ?? scenario.ctxRole });
  const recorded = [];
  const gate = load("src/lib/ai/tools/readAgentGate.ts", (request) => {
    if (request === "@/lib/mcp/agents/readRoleGuard") return w.guard;
    throw new Error(`Unexpected gate import: ${request}`);
  });
  const execution = load("src/lib/ai/tools/execution.ts", (request) => {
    if (request === "@/lib/planLimits") return { isPlanLimitReachedError: () => false };
    if (request === "@/lib/ai/tools/readAgentGate") return gate;
    if (request === "@/lib/auth/agentScope") return { withAgentScopeRequest: (_request, runIt) => runIt(), prepareAgentScope: async () => {} };
    if (request === "@/lib/mcp/tasks/agentMutationLeaseAdoption") return { withAdoptedAgentMutationLease: async (_db, _actor, runIt) => runIt() };
    if (request === "@/lib/ai/chatStream/errors") return { errorMessage: (error) => String(error?.message ?? error) };
    return recorder(request, w.sideEffects);
  });
  const executed = [];
  const tools = Object.fromEntries(nativeToolNames().map((name) => [name, { execute: async (input) => { executed.push(name); return { success: true, ran: name, input }; } }]));
  const actor = scenario.agentId ? { agentId: scenario.agentId, userId: 7 } : null;
  execution.trackToolSetExecutions(tools, (entry) => recorded.push(entry), undefined, actor);
  return { w, tools, executed, recorded, gate };
}

const HYBRID_INPUTS = {
  hypertask_agent_webhook: { read: { action: "get" }, write: { action: "configure" } },
  hypertask_task_description_history: { read: { action: "versions" }, write: { action: "restore" } },
  hypertask_board_config: { read: { action: "get_playbook" }, write: { action: "set_playbook" } },
  hypertask_section: { read: { action: "list" }, write: { action: "rename" } },
  hypertask_page_history: { read: { action: "versions" }, write: { action: "restore" } },
  hypertask_draft: { read: { action: "list" }, write: { action: "publish" } },
};

test("7673 native tools: the tool list has 88 tools and every one is classified", () => {
  const names = nativeToolNames();
  assert.equal(names.length, 88);
  const { gate } = nativeWorld(READ_REFUSED);
  const read = names.filter((name) => gate.NATIVE_READ_ONLY_TOOLS.has(name));
  const hybrid = names.filter((name) => gate.NATIVE_READ_ACTIONS.has(name));
  assert.equal(read.length, gate.NATIVE_READ_ONLY_TOOLS.size, "every read-only entry names a native tool");
  assert.deepEqual([...gate.NATIVE_READ_ACTIONS.keys()].sort(), Object.keys(HYBRID_INPUTS).sort());
  assert.equal(hybrid.length, Object.keys(HYBRID_INPUTS).length);
  assert.equal(names.length - read.length - hybrid.length, 46);
});

test("7673 native tools: no read tool of the HyperAI read-only list is lost", () => {
  const source = fs.readFileSync(path.join(root, "src/app/api/ai/_lib/hyperAiTools.ts"), "utf8");
  const metadata = fs.readFileSync(path.join(root, "src/lib/mcp-server/config/tool-metadata.ts"), "utf8");
  const nameOf = {};
  for (const match of metadata.matchAll(/^\s{2}([A-Z_0-9]+): \{\s*\n\s*name: buildToolName\('(\w+)'\)/gm)) nameOf[match[1]] = `hypertask_${match[2]}`;
  const block = source.slice(source.indexOf("const READ_ONLY_TOOLS"), source.indexOf("const HYBRID_READ_ACTIONS"));
  const hyperAiReadOnly = [...block.matchAll(/TOOL_METADATA\.(\w+)\.name/g)].map((match) => nameOf[match[1]]);
  assert.ok(hyperAiReadOnly.length >= 29 && hyperAiReadOnly.every(Boolean));
  const { gate } = nativeWorld(READ_REFUSED);
  const native = new Set(nativeToolNames());
  const lost = hyperAiReadOnly.filter((name) => native.has(name) && !gate.NATIVE_READ_ONLY_TOOLS.has(name));
  assert.deepEqual(lost, []);
  const onlyMcpNames = hyperAiReadOnly.filter((name) => !native.has(name));
  assert.deepEqual(onlyMcpNames.sort(), ["hypertask_hello", "hypertask_rag_retrieval", "hypertask_search_help_docs"]);
  for (const name of ["rag_retrieval", "search_help_docs"]) assert.ok(gate.NATIVE_READ_ONLY_TOOLS.has(name));
});

test("7673 native tools: the read-only set holds exactly the tools that cannot write", () => {
  const { gate } = nativeWorld(READ_REFUSED);
  const writeWords = new Set(["create", "update", "delete", "set", "assign", "unassign", "move", "archive", "unarchive", "start", "stop", "pause", "resume", "log", "mint", "revoke", "import", "switch", "attach", "add", "link", "decision", "rename", "ask", "configure"]);
  const writeNamed = [...gate.NATIVE_READ_ONLY_TOOLS].filter((name) => name.split("_").some((word) => writeWords.has(word)));
  assert.deepEqual(writeNamed, []);
});

test("7673 native tools: a read agent with the flag on is refused every write tool and keeps every read tool", async () => {
  const n = nativeWorld(READ_REFUSED);
  const refused = [];
  for (const [name, tool] of Object.entries(n.tools)) {
    const hybrid = HYBRID_INPUTS[name];
    if (hybrid) {
      const read = await tool.execute(hybrid.read);
      assert.equal(read.success, true, `${name} read action stays allowed`);
      const write = await tool.execute(hybrid.write);
      assert.equal(write.code, "insufficient_scope", `${name} write action refused`);
      refused.push(`${name}:${hybrid.write.action}`);
      continue;
    }
    const result = await tool.execute({});
    if (n.gate.NATIVE_READ_ONLY_TOOLS.has(name)) assert.equal(result.success, true, `${name} stays allowed`);
    else {
      assert.equal(result.success, false);
      assert.equal(result.code, "insufficient_scope");
      assert.match(result.error, /role \('read'\) does not permit this action; requires 'write' or higher/);
      refused.push(name);
    }
  }
  assert.equal(refused.length, 46 + Object.keys(HYBRID_INPUTS).length);
  assert.ok(!n.executed.some((name) => refused.includes(name) && !HYBRID_INPUTS[name]), "no refused tool ran");
  assert.ok(n.recorded.some((entry) => entry.result?.code === "insufficient_scope"), "the refusal is recorded as the tool result");
  assert.equal(n.w.counters.agentReads, refused.length, "only the refused calls read the agent row; read tools read nothing");
});

test("7673 native tools: the refused tool list is the reviewed one", () => {
  const { gate } = nativeWorld(READ_REFUSED);
  const refused = nativeToolNames().filter((name) => !gate.NATIVE_READ_ONLY_TOOLS.has(name) && !gate.NATIVE_READ_ACTIONS.has(name));
  assert.deepEqual(refused, [
    "hypertask_create_agent", "hypertask_revoke_agent", "hypertask_mint_token", "hypertask_revoke_token", "hypertask_ask_agent",
    "hypertask_update_profile", "hypertask_project_admin", "hypertask_create_board", "hypertask_rename_board",
    "hypertask_set_custom_field_value", "hypertask_link_tasks", "hypertask_move_task_to_inbox", "hypertask_create_task",
    "hypertask_create_page", "hypertask_update_page", "hypertask_create_report", "hypertask_update_report",
    "hypertask_delete_report", "hypertask_create_label", "hypertask_update_task", "hypertask_add_comment",
    "hypertask_decision_request", "hypertask_attach_files", "hypertask_update_comment", "hypertask_delete_comment",
    "hypertask_assign_user", "hypertask_follow_task", "hypertask_unassign_user", "hypertask_clear_task_blocker", "hypertask_move_task_between_boards", "hypertask_inbox_archive",
    "hypertask_inbox_unarchive", "hypertask_create_view", "hypertask_update_view", "hypertask_switch_view",
    "hypertask_delete_view", "hypertask_create_skill", "hypertask_update_skill", "hypertask_delete_skill",
    "hypertask_import_skills", "hypertask_start_timer", "hypertask_stop_timer", "hypertask_pause_timer",
    "hypertask_resume_timer", "hypertask_log_time", "hypertask_settings",
  ]);
});

for (const [label, scenario] of Object.entries(SCENARIOS_STILL_ALLOWED)) {
  test(`7673 native tools: a ${label} still runs write tools`, async () => {
    const n = nativeWorld(scenario);
    n.w.muteWarnings();
    try {
      for (const name of ["hypertask_create_task", "hypertask_update_task", "hypertask_add_comment", "hypertask_section", "hypertask_project_admin"]) {
        const result = await n.tools[name].execute({ action: "create" });
        assert.equal(result.success, true, `${name} runs`);
        assert.equal(result.code, undefined);
      }
    } finally {
      n.w.restoreWarnings();
    }
    assert.equal(n.executed.length, 5);
  });
}

test("7673 native tools: a role lookup error stops the tool instead of running it", async () => {
  const n = nativeWorld({ agentId: "agent-read", ctxRole: undefined, dbRole: "throw", flag: "on" });
  await assert.rejects(n.tools.hypertask_create_task.execute({}), ROLE_ERROR);
  assert.deepEqual(n.executed, []);
});

test("7673 native tools: read tools never touch the flag or the agent row", async () => {
  const n = nativeWorld({ agentId: "agent-read", ctxRole: undefined, dbRole: "read", flag: "on" });
  await n.tools.hypertask_search_tasks.execute({});
  await n.tools.hypertask_section.execute({ action: "list" });
  assert.deepEqual(n.w.counters, { agentReads: 0, flagReads: 0 });
});

test("the flag is defined as a high-risk access kill switch defaulting to Owner and QA", () => {
  const definition = load("src/lib/flags/definitions/htpr-7665-agent-read-role-guard.ts", (request) => {
    if (request === "../definitions") return {};
    throw new Error(`Unexpected definition import: ${request}`);
  });
  assert.equal(definition.HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG, FLAG_KEY);
  assert.equal(definition.default.key, FLAG_KEY);
  assert.equal(definition.default.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.default.releaseRisk.highRisk, "access");
});
