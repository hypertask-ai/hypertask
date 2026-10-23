const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');

const user = { id: 42, email: 'scope@example.invalid' };
const teamScope = { teamId: 'team-a', accessBinding: 'owner:account-a:0' };
const agentScope = { withAgentScopeRequest: (_request, run) => run(), prepareAgentScope: async () => {} };

test('legacy cookie principals retain verified scope, reject unresolved agents, and preserve human and upload fallback paths', async () => {
  let signed = { id: user.id };
  let resolved = null;
  const calls = [];
  const { legacyTaskWriteSession } = load('src/lib/api/task-writes/route.ts', {
    '@/lib/auth/agentScope': agentScope,
    '@/lib/auth/session': { SESSION_COOKIE: 'ht_session', verifySession: () => signed },
    '@/lib/auth/getSessionUser': { getSessionUser: async headers => { calls.push(headers); return resolved; } },
  });
  const request = { headers: new Headers({ Cookie: 'better-auth.session_token=fixture' }), cookies: { ht_session: 'signed-fixture' } };
  assert.deepEqual(await legacyTaskWriteSession(request), { userId: user.id, teamScope: null, source: 'legacy', needsBridge: true });
  assert.equal(calls.length, 0);
  signed = { id: user.id, agentId: 'agent' };
  for (const scope of [teamScope, null]) {
    resolved = { userId: user.id, agentId: 'agent', teamScope: scope, agentTokenGeneration: 'generation', source: 'legacy', needsBridge: true };
    assert.equal(await legacyTaskWriteSession(request), resolved);
    assert.equal(calls.at(-1).get('cookie'), 'ht_session=signed-fixture');
  }
  resolved = null;
  const before = calls.length;
  assert.equal(await legacyTaskWriteSession(request, true), null);
  assert.equal(calls.length, before + 1, 'an invalid agent cookie cannot fall back to a human session');
  signed = null;
  resolved = { userId: user.id, teamScope: null, source: 'better-auth' };
  assert.equal(await legacyTaskWriteSession(request), null);
  assert.equal(await legacyTaskWriteSession(request, true), resolved);
  assert.equal(calls.at(-1), request.headers);
});

test('AI tool context refuses missing agent scope and preserves explicit bound, unbound and human scope', () => {
  const { createToolContext } = load('src/lib/ai/tools/context.ts', {
    '@/lib/mcp/agents/create': {}, '@/lib/mcp/agents/revoke': {},
    '@/lib/ai/bulkConfirmation': {}, '@/lib/ai/tools/metadata': {}, '@/lib/ai/tools/helpers': {},
    './taskAssignees': { createTaskAssigneeMutation: () => ({}) },
  });
  const args = [user, {}, () => {}, () => {}];
  assert.throws(() => createToolContext(...args, 'agent'), /Agent team scope is unavailable/);
  for (const scope of [teamScope, null]) {
    const context = createToolContext(...args, 'agent', undefined, undefined, false, undefined, false, scope);
    assert.equal(context.teamScope, scope);
    assert.equal(context.actingAgentId, 'agent');
  }
  assert.equal(createToolContext(...args).teamScope, null);
});

test('related-task tools forward the caller identity and verified scope instead of impersonating the human owner', async () => {
  const calls = [];
  const { createFindRelatedTasksTool } = load('src/lib/ai/tools/findRelatedTasks.ts', {
    ai: { tool: value => value },
    '@/lib/mcp/tasks/relatedTasks': { handleRelatedTasksGet: async (_request, ctx) => { calls.push(ctx); return Response.json({ success: true }); } },
    '@/lib/ai/tools/execution': { withToolErrors: fn => fn },
    '@/lib/ai/tools/helpers': { sanitizeForJson: value => value },
  });
  for (const [actingAgentId, scope] of [['agent', teamScope], ['agent', null], [null, null]]) {
    const tools = createFindRelatedTasksTool({ user, actingAgentId, teamScope: scope, sendStatus: () => {} });
    assert.deepEqual(await tools.hypertask_find_related_tasks.execute({ task_id: 150, limit: 10 }), { success: true });
    assert.deepEqual(calls.at(-1), { user, agentId: actingAgentId, teamScope: scope });
  }
});

test('probe handlers forward the authenticated scope and refuse missing authentication before probing', async () => {
  const calls = [];
  let ctx = { user, agentId: 'agent', teamScope };
  const { createTaskWriteProbeHandler } = load('src/lib/mcp/taskWriteProbe/probeHandler.ts', { '@/lib/auth/agentScope': agentScope });
  const GET = createTaskWriteProbeHandler({
    checkRateLimit: async () => null,
    validateAuth: async () => ctx,
    runProbe: async (...args) => { calls.push(args); return { status: 'healthy', rolledBack: true }; },
  });
  assert.equal((await GET(new NextRequest('http://localhost/probe'))).status, 200);
  assert.deepEqual(calls, [[user.id, { agentId: 'agent', teamScope }]]);
  ctx = { user, agentId: 'agent' };
  assert.equal((await GET(new NextRequest('http://localhost/probe'))).status, 401);
  ctx = null;
  assert.equal((await GET(new NextRequest('http://localhost/probe'))).status, 401);
  assert.equal(calls.length, 1);
});

test('activity replay refuses a scoped principal without an agent and retains the exact agent filter for allowed callers', async () => {
  const calls = [];
  const { authorizeIdempotencyReplay, IdempotencyAccessError } = load('src/lib/mcp/idempotency/authorizeReplay.ts', {
    '@/lib/prisma': { default: { agentRunActivity: { findFirst: async args => { calls.push(args); return args.where.run.agentId === 'agent' ? { id: 'activity' } : null; } } } },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: (_userId, _agentId, scope) => ({ teamId: scope.teamId }) },
  });
  const result = { activity: { id: 'activity' } };
  for (const agentId of [null, undefined]) {
    await assert.rejects(authorizeIdempotencyReplay(result, { userId: user.id, agentId, teamScope }), IdempotencyAccessError);
  }
  assert.equal(calls.length, 0);
  await authorizeIdempotencyReplay(result, { userId: user.id, agentId: 'agent', teamScope });
  assert.deepEqual(calls[0].where.run, { agentId: 'agent', task: { project: { teamId: teamScope.teamId } } });
  await assert.rejects(authorizeIdempotencyReplay(result, { userId: user.id, agentId: 'other', teamScope }), IdempotencyAccessError);
  await authorizeIdempotencyReplay(result, { userId: user.id, agentId: null, teamScope: null });
  assert.equal(calls.length, 2);
});
