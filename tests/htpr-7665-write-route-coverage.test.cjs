// HTPR-7665: every non-GET MCP handler must be role-guarded, on an allowlist with a reason, or refuse agent tokens before any write.
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeHandlers, GUARD_CALL, WRITE_GUARD_CALL, exists, read } = require("./helpers/mcp-write-handlers.cjs");

const OPS = "src/lib/mcp/operations";
const API = "src/app/api/mcp";

const NEWLY_GUARDED = [
  `POST ${OPS}/assignees/assign/operation.ts`,
  `PATCH ${OPS}/comments/[comment_id]/operation.ts`,
  `DELETE ${OPS}/comments/[comment_id]/operation.ts`,
  `DELETE ${API}/custom-fields/[fieldId]/route.ts`,
  `POST ${OPS}/custom-fields/operation.ts`,
  `POST ${OPS}/custom-fields/value/operation.ts`,
  `POST ${OPS}/decisions/operation.ts`,
  `POST ${OPS}/drafts/[draft_id]/publish/operation.ts`,
  `PATCH ${API}/flags/route.ts`,
  `POST ${API}/flags/reviews/route.ts`,
  `POST ${API}/manager-leases/route.ts`,
  `PUT ${OPS}/projects/[projectId]/instructions/operation.ts`,
  `POST ${OPS}/projects/[projectId]/labels/operation.ts`,
  `PUT ${OPS}/projects/[projectId]/playbook/operation.ts`,
  `POST ${OPS}/projects/archive/operation.ts`,
  `POST ${OPS}/reports/create/operation.ts`,
  `POST ${OPS}/reports/delete/operation.ts`,
  `POST ${OPS}/reports/update/operation.ts`,
  `POST ${OPS}/reports/status-update/operation.ts`,
  `POST ${OPS}/tasks/description-restore/operation.ts`,
  `POST ${API}/tasks/escalate/route.ts`,
  `POST ${API}/tasks/evidence/route.ts`,
  `POST ${OPS}/tasks/move/operation.ts`,
  `POST ${OPS}/tasks/waiting-on/operation.ts`,
  `POST ${OPS}/tasks/relations/operation.ts`,
  `DELETE ${OPS}/tasks/relations/operation.ts`,
  `POST ${API}/time/delete/route.ts`,
  `POST ${OPS}/time/log/operation.ts`,
  `POST ${OPS}/time/pause/operation.ts`,
  `POST ${OPS}/time/resume/operation.ts`,
  `POST ${OPS}/time/start/operation.ts`,
  `POST ${OPS}/time/stop/operation.ts`,
  `POST ${API}/time/update/route.ts`,
  `PATCH ${OPS}/view/[viewId]/operation.ts`,
  `DELETE ${OPS}/view/[viewId]/operation.ts`,
  `POST ${OPS}/view/operation.ts`,
  `POST ${OPS}/webhooks/operation.ts`,
  `DELETE ${OPS}/webhooks/operation.ts`,
  `POST ${OPS}/inbox/move/operation.ts`,
  `POST ${API}/chat/rooms/[roomId]/messages/route.ts`,
  `POST ${API}/webhooks/[id]/test/route.ts`,
  `POST ${OPS}/skills/operation.ts`,
  `POST ${OPS}/skills/import/operation.ts`,
  `DELETE ${OPS}/skills/[skill_id]/operation.ts`,
  `PATCH ${OPS}/skills/[skill_id]/operation.ts`,
  `POST ${API}/tasks/lease/claim/route.ts`,
  `POST ${API}/tasks/lease/heartbeat/route.ts`,
  `POST ${OPS}/view/[viewId]/apply/operation.ts`,
  `POST ${API}/tasks/session/route.ts`,
  `POST ${OPS}/tasks/follow/operation.ts`,
];

const EXISTING_GUARD_IN_IMPORTED_MODULE = {
  [`POST ${API}/ai/sessions/route.ts`]: `${API}/ai/sessions/_dependencies.ts`,
  [`PATCH ${API}/ai/sessions/[sessionId]/route.ts`]: `${API}/ai/sessions/_dependencies.ts`,
  [`DELETE ${API}/ai/sessions/[sessionId]/route.ts`]: `${API}/ai/sessions/_dependencies.ts`,
  [`POST ${OPS}/tasks/update/operation.ts`]: "src/lib/mcp/tasks/updateTask.ts",
  [`PATCH ${OPS}/agents/[agentId]/operation.ts`]: "src/lib/mcp/agents/delegatedAccess.ts",
};

const BOARD_ACCESS_REQUEST_GUARD = `POST ${OPS}/agents/board-access-requests/operation.ts`;

const ALLOWED_FOR_READ_AGENTS = {
  [`POST ${OPS}/hello/operation.ts`]: "reads the hello payload; POST only carries the body",
  [`POST ${OPS}/tasks/related/operation.ts`]: "related-task search, read through POST",
  [`POST ${OPS}/time/status/operation.ts`]: "timer status, read through POST",
  [`POST ${API}/tasks/batch/route.ts`]: "get branch reads; the update branch calls requireRole in batchTasks.ts",
  [`POST ${API}/ai/improve/route.ts`]: "returns generated html only; saves nothing besides usage accounting",
  [`POST ${API}/ai/task-writer/route.ts`]: "returns a draft only; saves nothing besides usage accounting",
  [`POST ${OPS}/agents/[agentId]/operation.ts`]: "only the id runs is accepted: the agent opens its own run record",
  [`POST ${API}/agents/runs/[id]/activities/route.ts`]: "writes activity onto the agent's own run",
  [`POST ${API}/agents/runs/[id]/stop/route.ts`]: "stops the agent's own run",
  [`POST ${API}/agents/runtime-heartbeat/route.ts`]: "the agent's own runtime heartbeat",
  [`POST ${API}/chat/activity/route.ts`]: "activity lines in the agent's own chat thread",
  [`POST ${API}/chat/rooms/messages/[messageId]/handled/route.ts`]: "marks the agent's own delivery as handled",
  [`POST ${API}/cli-error/route.ts`]: "client error telemetry",
  [`POST ${API}/feedback/route.ts`]: "feedback report",
  [`POST ${API}/inbox/seen/route.ts`]: "the caller's own inbox state",
  [`POST ${OPS}/inbox/archive/operation.ts`]: "the caller's own notifications and reminders",
  [`POST ${OPS}/inbox/unarchive/operation.ts`]: "the caller's own notifications and reminders",
  [`POST ${API}/tasks/card-actions/route.ts`]: "star refuses agents; inbox acts on the caller's own inbox",
  [`POST ${API}/tasks/lease/release/route.ts`]: "releases only the caller's own lease",
  [`POST ${API}/token/refresh/route.ts`]: "refreshes the caller's own token",
  [`DELETE ${API}/token/route.ts`]: "the agent revokes its own token",
  [`POST ${OPS}/drafts/operation.ts`]: "draft rows belong to the caller",
  [`PATCH ${OPS}/drafts/[draft_id]/operation.ts`]: "draft rows belong to the caller; publish is guarded",
  [`DELETE ${OPS}/drafts/[draft_id]/operation.ts`]: "draft rows belong to the caller",
  [`PATCH ${OPS}/decisions/[id]/operation.ts`]: "answer refuses agents; cancel needs the agent that created the decision",
};

const AGENT_TOKENS_REFUSED_BEFORE_ANY_WRITE = {
  [`POST ${API}/[...notFound]/route.ts`]: { reason: "404 stub", file: `${API}/[...notFound]/route.ts`, pattern: /status: 404/ },
  [`PUT ${API}/[...notFound]/route.ts`]: { reason: "404 stub", file: `${API}/[...notFound]/route.ts`, pattern: /status: 404/ },
  [`PATCH ${API}/[...notFound]/route.ts`]: { reason: "404 stub", file: `${API}/[...notFound]/route.ts`, pattern: /status: 404/ },
  [`DELETE ${API}/[...notFound]/route.ts`]: { reason: "404 stub", file: `${API}/[...notFound]/route.ts`, pattern: /status: 404/ },
  [`POST ${API}/factory/[operation]/route.ts`]: { reason: "404 stub", file: `${API}/factory/[operation]/route.ts`, pattern: /status: 404/ },
  [`POST ${API}/admin/agents/[agentId]/token/route.ts`]: { reason: "agents cannot rotate tokens", file: "src/lib/mcp/agents/rotateToken.ts", pattern: /Agents cannot rotate agent tokens/ },
  [`POST ${API}/admin/keys/route.ts`]: { reason: "management key or browser session only", file: `${API}/admin/keys/route.ts`, pattern: /validateManagementOrSessionAuth\(/ },
  [`DELETE ${API}/admin/keys/route.ts`]: { reason: "management key or browser session only", file: `${API}/admin/keys/route.ts`, pattern: /validateManagementOrSessionAuth\(/ },
  [`POST ${API}/admin/team-gateway-keys/route.ts`]: { reason: "management key or browser session only", file: `${API}/admin/team-gateway-keys/route.ts`, pattern: /validateManagementOrSessionAuth\(/ },
  [`POST ${OPS}/admin/agents/operation.ts`]: { reason: "delegates to the create handler, which refuses agents", file: "src/lib/mcp/agents/create.ts", pattern: /if \(ctx\.agentId\)/ },
  [`DELETE ${OPS}/admin/agents/operation.ts`]: { reason: "delegates to the revoke handler, which refuses agents", file: "src/lib/mcp/agents/revoke.ts", pattern: /if \(ctx\.agentId\)/ },
  [`POST ${OPS}/admin/tokens/operation.ts`]: { reason: "management key or browser session only", file: `${OPS}/admin/tokens/operation.ts`, pattern: /validateManagementOrSessionAuth\(/ },
  [`DELETE ${OPS}/admin/tokens/operation.ts`]: { reason: "management key or browser session only", file: `${OPS}/admin/tokens/operation.ts`, pattern: /validateManagementOrSessionAuth\(/ },
  [`POST ${API}/agents/create/route.ts`]: { reason: "agents cannot create agents", file: "src/lib/mcp/agents/create.ts", pattern: /if \(ctx\.agentId\)/ },
  [`POST ${OPS}/agents/create/operation.ts`]: { reason: "agents cannot create agents", file: "src/lib/mcp/agents/create.ts", pattern: /if \(ctx\.agentId\)/ },
  [`POST ${API}/agents/revoke/route.ts`]: { reason: "agents cannot revoke agents", file: "src/lib/mcp/agents/revoke.ts", pattern: /if \(ctx\.agentId\)/ },
  [`POST ${API}/agents/rotate-token/route.ts`]: { reason: "agents cannot rotate tokens", file: "src/lib/mcp/agents/rotateToken.ts", pattern: /Agents cannot rotate agent tokens/ },
  [`POST ${OPS}/agents/[agentId]/archive/operation.ts`]: { reason: "agents cannot archive agents", file: "src/lib/mcp/agents/lifecycleRequests.ts", pattern: /if \(ctx\.agentId\)/ },
  [`DELETE ${OPS}/agents/[agentId]/operation.ts`]: { reason: "agents cannot delete agents", file: "src/lib/mcp/agents/delete.ts", pattern: /Agents cannot delete agents/ },
  [`POST ${API}/agents/runs/[id]/activities/[activityId]/select/route.ts`]: { reason: "browser session only", file: `${API}/agents/runs/[id]/activities/[activityId]/select/route.ts`, pattern: /requires a browser session/ },
  [`POST ${API}/token/route.ts`]: { reason: "cookie session mints a token; no bearer auth", file: `${API}/token/route.ts`, pattern: /export async function POST/ },
  [`PATCH ${OPS}/user/profile/operation.ts`]: { reason: "human only", file: `${OPS}/user/profile/operation.ts`, pattern: /if \(ctx\.agentId\)/ },
};

const handlers = writeHandlers();
const byKey = new Map(handlers.map((handler) => [handler.key, handler]));

test("every non-GET MCP handler is guarded, allowlisted with a reason, or refuses agent tokens first", () => {
  const unclassified = handlers.filter((handler) => {
    if (GUARD_CALL.test(handler.text)) return false;
    if (handler.key in EXISTING_GUARD_IN_IMPORTED_MODULE) return false;
    if (handler.key === BOARD_ACCESS_REQUEST_GUARD) return false;
    if (handler.key in ALLOWED_FOR_READ_AGENTS) return false;
    if (handler.key in AGENT_TOKENS_REFUSED_BEFORE_ANY_WRITE) return false;
    return true;
  });
  assert.deepEqual(unclassified.map((handler) => handler.key), [], "call requireAgentWriteRole after authentication, or add the row to an explicit list with a reason");
});

test("the 49 handlers this fix guards still call requireAgentWriteRole", () => {
  assert.equal(new Set(NEWLY_GUARDED).size, NEWLY_GUARDED.length);
  for (const key of NEWLY_GUARDED) {
    const handler = byKey.get(key);
    assert.ok(handler, `${key} is not an exported handler`);
    assert.ok(WRITE_GUARD_CALL.test(handler.text), `${key} lost its requireAgentWriteRole call`);
  }
  const guardedNow = handlers.filter((handler) => WRITE_GUARD_CALL.test(handler.text)).map((handler) => handler.key).sort();
  assert.deepEqual(guardedNow, [...NEWLY_GUARDED].sort(), "a handler calls requireAgentWriteRole without being listed");
});

test("allowlist rows exist, carry a reason and are not also guarded by the new helper", () => {
  for (const [key, reason] of Object.entries(ALLOWED_FOR_READ_AGENTS)) {
    assert.ok(byKey.has(key), `stale allowlist row ${key}`);
    assert.ok(reason.length > 0, key);
    assert.ok(!WRITE_GUARD_CALL.test(byKey.get(key).text), `${key} is allowlisted but calls requireAgentWriteRole`);
  }
  for (const [key, entry] of Object.entries(AGENT_TOKENS_REFUSED_BEFORE_ANY_WRITE)) {
    assert.ok(byKey.has(key), `stale refused row ${key}`);
    assert.ok(entry.reason.length > 0, key);
    assert.ok(exists(entry.file), `${key}: evidence file missing`);
    assert.match(read(entry.file), entry.pattern, `${key}: refusal evidence not found in ${entry.file}`);
  }
  for (const [key, moduleFile] of Object.entries(EXISTING_GUARD_IN_IMPORTED_MODULE)) {
    assert.ok(byKey.has(key), `stale import-guard row ${key}`);
    assert.match(read(moduleFile), /\b(requireRole|getAgentRole)\(/, `${key}: ${moduleFile} has no role check`);
  }
});

test("no row sits on two lists", () => {
  const lists = [NEWLY_GUARDED, Object.keys(ALLOWED_FOR_READ_AGENTS), Object.keys(AGENT_TOKENS_REFUSED_BEFORE_ANY_WRITE), Object.keys(EXISTING_GUARD_IN_IMPORTED_MODULE), [BOARD_ACCESS_REQUEST_GUARD]];
  const all = lists.flat();
  assert.deepEqual(all.filter((key, index) => all.indexOf(key) !== index), []);
});

test("agents are refused at management endpoints centrally", () => {
  assert.match(read("src/lib/mcp/auth/session.ts"), /Agent tokens cannot access management endpoints/);
});

test("the guard is never applied to the unrelated GET handlers or the JSON-RPC endpoint", () => {
  for (const file of ["src/app/mcp/route.ts", "src/app/sse/route.ts", "src/app/message/route.ts"]) {
    assert.ok(!/requireAgentWriteRole/.test(read(file)), file);
  }
});

test("board access requests require a live write-role agent", () => {
  const handler = byKey.get(BOARD_ACCESS_REQUEST_GUARD);
  assert.ok(handler);
  assert.match(handler.text, /createBoardAccessRequest\(ctx, input\.data\)/);
  const service = read("src/lib/agents/boardAccessRequests/service.ts");
  assert.match(service, /const agent = await liveAgent\(db, ctx, true\)/);
  assert.match(service, /if \(write && !\["write", "admin"\]\.includes\(role\)\) throw new BoardAccessError\(403, "write_role_required"\)/);
});
