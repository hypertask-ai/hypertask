const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest, NextResponse } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-8215-agent-archive-delete";

function fixture(options = {}) {
  const ctx = { user: { id: 7 }, agentId: "agent-owner", agentRole: "write", teamScope: null, agentTokenGeneration: 3, ...options.ctx };
  const flags = [], lookups = [], internal = [], leases = [], crashes = [];
  const stored = { id: 42, ticketNumber: "HTPR-42", projectId: 15, status: "Normal", archivedAt: null, permanentlyDeleteAt: null };
  const mocks = {
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flags.push({ key, userId });
      assert.equal(userId, 7);
      return options.flagEnabled !== false;
    } },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => options.readOnly
      ? NextResponse.json({ success: false, code: "insufficient_scope" }, { status: 403 })
      : null },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (_request, error) => { crashes.push(error); } },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (run) => run,
      checkMcpRouteRateLimit: async () => options.limited ? NextResponse.json({ success: false }, { status: 429 }) : null,
      validateMcpRouteAuth: async () => options.noAuth ? null : ctx,
      mcpRouteUnauthorizedResponse: async () => NextResponse.json({ success: false }, { status: 401 }),
      withMcpRouteMutationLease: async (_client, actor, run) => { leases.push(actor); return run(); },
    },
    "@/lib/mcp/tasks/resolveTask": {
      findTaskByIdentifier: async (user, identifier, agentId, include, teamScope) => {
        lookups.push({ user, identifier, agentId, include, teamScope });
        return options.offBoard ? null : { id: 42 };
      },
      taskIdentifierErrorResponse: () => null,
    },
    "@/lib/mcp/tasks/internalTaskWrite": {
      postInternalTaskWrite: async (writeCtx, path, body) => {
        internal.push({ writeCtx, path, body });
        return options.internal ?? { ok: true, status: 200, data: { success: true } };
      },
    },
    "@/lib/prisma": { default: { task: { findUnique: async ({ where, select }) => {
      assert.deepEqual(where, { id: 42 });
      assert.deepEqual(select, { id: true, ticketNumber: true, projectId: true, status: true, archivedAt: true, permanentlyDeleteAt: true });
      return { ...stored, ...options.stored };
    } } } },
  };
  const archive = load("src/lib/mcp/operations/tasks/archive/operation.ts", mocks).POST;
  const del = load("src/lib/mcp/operations/tasks/delete/operation.ts", mocks).POST;
  const request = (body, raw = false) => new NextRequest("http://mcp.test/api/mcp/tasks/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  const call = async (handler, body, raw) => {
    const response = await handler(request(body, raw));
    return { status: response.status, body: await response.json() };
  };
  return { ctx, flags, lookups, internal, leases, crashes, archive: (body, raw) => call(archive, body, raw), delete: (body, raw) => call(del, body, raw) };
}

for (const kind of ["archive", "delete"]) {
  test(`${kind}: flag off answers 404 before any lookup or write`, async () => {
    const f = fixture({ flagEnabled: false });
    const res = await f[kind]({ task_id: 42 });
    assert.deepEqual(res, { status: 404, body: { success: false, error: `Task ${kind} is not enabled` } });
    assert.deepEqual(f.flags, [{ key: FLAG, userId: 7 }]);
    assert.deepEqual(f.lookups, []);
    assert.deepEqual(f.internal, []);
  });

  test(`${kind}: read-only agent is refused before the flag, lookup or write`, async () => {
    const f = fixture({ readOnly: true });
    const res = await f[kind]({ task_id: 42 });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "insufficient_scope");
    assert.deepEqual(f.flags, []);
    assert.deepEqual(f.lookups, []);
    assert.deepEqual(f.internal, []);
  });

  test(`${kind}: unauthenticated and rate limited calls write nothing`, async () => {
    assert.equal((await fixture({ noAuth: true })[kind]({ task_id: 42 })).status, 401);
    const limited = fixture({ limited: true });
    assert.equal((await limited[kind]({ task_id: 42 })).status, 429);
    assert.deepEqual(limited.internal, []);
  });

  test(`${kind}: a ticket outside the agent's board scope answers 404 and writes nothing`, async () => {
    const f = fixture({ offBoard: true, ctx: { teamScope: { teamId: "team-1" } } });
    const res = await f[kind]({ task_id: 42 });
    assert.deepEqual(res, { status: 404, body: { success: false, error: "Task not found or access denied" } });
    assert.equal(f.lookups[0].agentId, "agent-owner");
    assert.deepEqual(f.lookups[0].teamScope, { teamId: "team-1" });
    assert.deepEqual(f.internal, []);
  });

  test(`${kind}: invalid identifiers answer 400 before the lookup`, async () => {
    const f = fixture();
    for (const body of [{}, { task_id: "42" }, { task_id: 0 }, { task_id: 1.5 }, { task_id: 2 ** 40 }, { task_id: 42, ticket_number: "HTPR-42" }, { unique_index: 3 }, { ticket_number: " " }]) {
      const res = await f[kind](body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.success, false);
    }
    assert.equal((await f[kind]("{not json", true)).status, 400);
    assert.deepEqual(f.lookups, []);
    assert.deepEqual(f.internal, []);
  });

  test(`${kind}: ticket number and project index identifiers reach the scoped lookup`, async () => {
    const f = fixture();
    await f[kind]({ ticket_number: " HTPR-42 " });
    await f[kind]({ project_id: 15, unique_index: 42 });
    assert.deepEqual(f.lookups.map((lookup) => lookup.identifier), [
      { task_id: undefined, ticket_number: "HTPR-42", unique_index: undefined, project_id: undefined },
      { task_id: undefined, ticket_number: undefined, unique_index: 42, project_id: 15 },
    ]);
  });

  test(`${kind}: an internal 4xx is passed through and a 5xx becomes a 502`, async () => {
    const refused = fixture({ internal: { ok: false, status: 403, data: { message: "You cannot change this ticket" } } });
    assert.deepEqual(await refused[kind]({ task_id: 42 }), { status: 403, body: { success: false, error: "You cannot change this ticket" } });
    const broken = fixture({ internal: { ok: false, status: 500, data: { message: "db down" } } });
    assert.deepEqual(await broken[kind]({ task_id: 42 }), { status: 502, body: { success: false, error: `Task ${kind} failed` } });
  });
}

test("write agent archives: same app route, Archive status, receipt from the stored task", async () => {
  const f = fixture({ stored: { status: "Archive", archivedAt: "2026-10-30T10:00:00.000Z" } });
  const res = await f.archive({ task_id: 42 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, task: { id: 42, ticketNumber: "HTPR-42", projectId: 15, status: "Archive", archivedAt: "2026-10-30T10:00:00.000Z", permanentlyDeleteAt: null } });
  assert.equal(f.internal.length, 1);
  assert.equal(f.internal[0].path, "/api/tasks/(un)archive");
  assert.deepEqual(f.internal[0].body, { taskId: 42, status: "Archive" });
  assert.equal(f.internal[0].writeCtx, f.ctx);
  assert.deepEqual(f.leases, [{ agentId: "agent-owner", userId: 7 }]);
});

test("write agent deletes: same Trash route, receipt carries permanentlyDeleteAt", async () => {
  const f = fixture({ stored: { status: "Deleted", permanentlyDeleteAt: "2026-11-29T10:00:00.000Z" } });
  const res = await f.delete({ ticket_number: "HTPR-42" });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.status, "Deleted");
  assert.equal(res.body.task.permanentlyDeleteAt, "2026-11-29T10:00:00.000Z");
  assert.equal(f.internal[0].path, "/api/queues/tasks/taskDeleteReminder");
  assert.deepEqual(f.internal[0].body, { taskId: 42 });
});

test("a human session (no agent) still archives and deletes", async () => {
  const f = fixture({ ctx: { agentId: null, agentRole: undefined } });
  assert.equal((await f.archive({ task_id: 42 })).status, 200);
  assert.equal((await f.delete({ task_id: 42 })).status, 200);
  assert.deepEqual(f.leases, [{ agentId: null, userId: 7 }, { agentId: null, userId: 7 }]);
});
