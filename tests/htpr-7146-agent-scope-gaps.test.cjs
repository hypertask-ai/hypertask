const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { fixture, matches, hydrate } = require('./helpers/agent-board-scope.cjs');

const request = (url, method = 'GET', body, headers = {}) => new NextRequest(`http://localhost${url}`, {
  method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const response = () => ({ statusCode: 0, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} });
const cases = [
  ['ENFORCE', 'outside'], ['ENFORCE', 'granted'], ['ENFORCE', 'human'],
  ['ENFORCE', 'invited'], ['WATCH', 'outside'], ['WATCH', 'granted'], ['WATCH', 'invited'],
];
function actor(mode, kind, board = 15) {
  const f = fixture();
  f.state.enforce = mode === 'ENFORCE';
  f.agent.permissions.role = 'admin';
  if (kind === 'human') f.state.ctx.agentId = null;
  if (kind === 'outside') f.projects.find(p => p.id === board).members = [];
  if (kind === 'invited') f.projects.find(p => p.id === board).members[0].status = 'Invited';
  return f;
}
function miss(f, mode, kind, board, action) {
  assert.equal(f.state.events.some(e => e.properties.projectId === board && e.properties.action === action), mode === 'WATCH' && ['outside', 'invited'].includes(kind));
}

for (const [mode, kind] of cases) {
  test(`agent board edits ${mode} ${kind}: touched and returned boards use Accepted grants`, async () => {
    const f = actor(mode, kind);
    const target = { id: 'target-agent', userId: f.user.id, members: f.projects.filter(project => project.id !== 15).map(project => ({ projectId: project.id, project })) };
    const originalFind = f.prisma.agent.findFirst;
    f.prisma.agent.findFirst = async args => args.where.id === target.id ? hydrate(target, args) : originalFind(args);
    f.prisma.member.deleteMany = async ({ where }) => { target.members = target.members.filter(row => !where.projectId.in.includes(row.projectId)); f.writes.push('remove'); return { count: 1 }; };
    f.prisma.member.createMany = async ({ data }) => { target.members.push(...data.map(row => ({ projectId: row.projectId, project: f.projects.find(project => project.id === row.projectId) }))); f.writes.push('add'); return { count: data.length }; };
    const patch = f.load('src/lib/mcp/operations/agents/[agentId]/operation.ts', {
      '@/lib/agents/visibility': {}, '@/lib/agents/runtimeState': {},
      '@/lib/mcp/managementKeyTeamScope': {},
      '@/utils/controllers/agents/boardMembers': { getAccessibleAgentBoard: async id => f.projects.find(project => project.id === id) },
      '@/lib/agentRuns/service': {}, '@/lib/mcp/agents/get': {}, '@/lib/mcp/agents/delete': {},
      './lifecycle': {},
    }).PATCH;
    const run = (operation = 'add') => patch(request('/api/mcp/agents/target-agent', 'PATCH', { [`${operation}_project_ids`]: [15] }), { params: Promise.resolve({ agentId: target.id }) });
    if (kind === 'outside' || kind === 'invited' && mode === 'ENFORCE') {
      assert.equal((await run()).status, 403);
      assert.equal((await run('remove')).status, 403);
      assert.deepEqual(f.writes, []);
    } else {
      const response = await run();
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(result.agent.project_ids, kind === 'human' || mode === 'WATCH' ? [15, 2128, 4060] : [15, 4060]);
      assert.deepEqual(f.writes, ['add']);
      const removed = await run('remove');
      assert.equal(removed.status, 200);
      assert.deepEqual((await removed.json()).agent.project_ids, kind === 'human' || mode === 'WATCH' ? [2128, 4060] : [4060]);
      assert.deepEqual(f.writes, ['add', 'remove']);
      if (mode === 'WATCH') assert.ok(f.state.events.some(e => e.properties.projectId === 2128 && e.properties.action === 'read'));
    }
    if (mode === 'ENFORCE') assert.deepEqual(f.state.events, []);
  });

  test(`flags GET/PATCH ${mode} ${kind}: titles and approval are board scoped before locks`, async () => {
    const f = actor(mode, kind);
    const key = 'htpr-7146-agent-scope-enforce';
    f.tasks[0].uniqueIndex = 7146;
    let lockCount = 0;
    f.prisma.$queryRaw = async () => { lockCount++; return [{ id: 123 }]; };
    f.prisma.$executeRaw = async () => 0;
    f.prisma.agent.findUniqueOrThrow = async () => ({ displayName: 'Runner' });
    f.prisma.featureFlag = {
      findMany: async () => [], findUnique: async () => ({ key, mode: 'OFF' }),
      upsert: async () => { f.writes.push('flag'); return { key, mode: 'OFF', updatedAt: null, releasedAt: null, keep: false, removalTaskId: null }; },
    };
    f.prisma.featureFlagChange = { findMany: async () => [] };
    const comment = { id: 123, taskId: 150, editedAt: null, text: `Question: Switch ${key} to Off?`, task: f.tasks[0] };
    f.prisma.comment = { findFirst: async args => matches(comment, { ...args.where, reactions: undefined }) ? hydrate(comment, args) : null };
    const flags = f.load('src/lib/flags.ts', { '@/lib/flags/modeCache': { withFlagModeInvalidation: run => run() } });
    const route = f.load('src/app/api/mcp/flags/route.ts', {
      '@/lib/flags': { ...flags, isFeatureFlagOwnerUserId: async () => true, isFeatureEnabled: async () => false },
      '@/lib/realtime/server': { broadcastFeatureFlagsChange: async () => {} },
    });
    const get = await route.GET(request(`/api/mcp/flags?key=${key}`));
    if (kind === 'human') {
      assert.equal(get.status, 403);
      const rows = await flags.listFeatureFlagModes({ includeTicketTitles: true, principal: { userId: f.user.id } });
      assert.equal(rows.find(row => row.key === key).ticketTitle, 'Task 15');
      return;
    }
    assert.equal(get.status, 200);
    const allowed = mode === 'WATCH' || kind === 'granted';
    assert.equal((await get.json()).flag.ticketTitle, allowed ? 'Task 15' : null);
    const patch = await route.PATCH(request('/api/mcp/flags', 'PATCH', { key, mode: 'OFF', reason: 'https://app.hypertask.ai/detail/project-15/7146#comment-123' }));
    assert.equal(patch.status, allowed ? 200 : 403);
    assert.equal(lockCount, allowed ? 2 : 0);
    assert.equal(f.writes.length, allowed ? 1 : 0);
    if (allowed) assert.equal((await patch.json()).flag.ticketTitle, 'Task 15');
    miss(f, mode, kind, 15, 'read');
    miss(f, mode, kind, 15, 'write');
    comment.task = f.tasks[2];
    const foreign = await route.PATCH(request('/api/mcp/flags', 'PATCH', { key, mode: 'OFF', reason: 'https://app.hypertask.ai/detail/project-15/7146#comment-123' }));
    assert.equal(foreign.status, 403);
    assert.equal(lockCount, allowed ? 2 : 0, 'a foreign comment must be refused before locks');
    assert.equal(f.writes.length, allowed ? 1 : 0);
  });

  test(`write probe ${mode} ${kind}: fixture lookup and locked revalidation carry principal`, async () => {
    const f = actor(mode, kind);
    const probe = f.load('src/lib/taskCardActions/writeProbe.ts', { './writeLocks': {} });
    const project = f.projects[0];
    project.name = probe.probeProjectName(f.user.id);
    project.status = 'Archive';
    Object.assign(f.tasks[0], { title: probe.PROBE_TASK_TITLE, status: 'Archive' });
    let locks = 0;
    const runProbe = (userId, options) => probe.runTaskWriteProbe(userId, {
      ...options, verifyRollback: async () => null,
      lock: async (_id, run) => { locks++; return run({
        task: { ...f.prisma.task, updateMany: async () => ({ count: 1 }) },
        savedContent: { create: async () => ({}), findUnique: async () => ({ id: 'throwaway' }) },
      }); },
    });
    const get = f.load('src/lib/mcp/taskWriteProbe/probeHandler.ts').createTaskWriteProbeHandler({
      checkRateLimit: async () => null, validateAuth: async () => f.state.ctx, runProbe,
    });
    const result = await get(request('/api/ops/task-write-probe'));
    const allowed = mode === 'WATCH' || ['human', 'granted'].includes(kind);
    assert.equal(result.status, allowed ? 200 : 503);
    assert.equal(locks, allowed ? 1 : 0);
    const body = await result.json();
    assert.equal(body.probe.lockedTaskId, allowed ? 150 : undefined);
    miss(f, mode, kind, 15, 'write');
  });

  test(`team board replay ${mode} ${kind}: principal key and fresh authorization`, async () => {
    const f = actor(mode, kind);
    const cache = new Map();
    const store = f.load('src/lib/mcp/idempotency/idempotencyStore.ts', { '@/lib/redis': { getRedis: async () => ({
      get: async key => cache.get(key) ?? null,
      set: async (key, value, _ex, _ttl, nx) => { if (nx && cache.has(key)) return null; cache.set(key, value); return 'OK'; },
      del: async key => cache.delete(key),
    }) } });
    const body = { title: 'Created', sections: [{ title: 'Todo' }] };
    f.prisma.member_Team = { findFirst: async () => ({ id: 1 }) };
    const route = f.load('src/lib/mcp/operations/teams/[teamId]/boards/operation.ts', {
      '@/lib/mcp/idempotency/idempotencyStore': store,
      '@/lib/mcp/agents/scopes': { requireRole: async () => null, getAgentRole: async () => 'admin' },
    }).POST;
    const dependencies = { createBoardFromManifest: async () => { f.writes.push('create'); return { board: { id: 15 }, sections: [], labels: [], tasks: [] }; } };
    const invoke = () => route(request('/api/mcp/teams/team/boards', 'POST', body, { 'Idempotency-Key': 'scope-key' }), { params: Promise.resolve({ teamId: 'team' }) }, dependencies);
    assert.equal((await invoke()).status, 200);
    const replay = await invoke();
    const allowed = mode === 'WATCH' || ['granted', 'human'].includes(kind);
    assert.equal(replay.status, allowed ? 200 : 403);
    if (allowed) assert.equal((await replay.json()).idempotent_replayed, true);
    assert.deepEqual(f.writes, ['create']);
    miss(f, mode, kind, 15, 'read');
    f.user.agents.push({ ...f.agent, id: 'second-agent' });
    f.state.ctx.agentId = 'second-agent';
    const other = await invoke();
    assert.equal(other.status, 200);
    assert.equal((await other.json()).idempotent_replayed, mode === 'WATCH' ? true : undefined);
    assert.deepEqual(f.writes, mode === 'WATCH' ? ['create'] : ['create', 'create']);
    assert.notEqual(store.createIdempotencyRedisKey('create_board', 6, 'key', body, 'a'), store.createIdempotencyRedisKey('create_board', 6, 'key', body, 'b'));
  });
}

test('board creation atomically creates an Accepted membership before manifest tasks use the board', async () => {
  const f = fixture();
  let membership;
  const board = { id: 900, title: 'Created', name: 'project-900', uniqueIdentifier: 'NEW', teamId: 'team', owner: f.user, team: { title: 'Team' } };
  f.prisma.project.findUniqueOrThrow = async () => board;
  f.prisma.section.findMany = async () => [{ id: 1, section_title: 'Todo', ranking: 'a' }];
  f.prisma.label = { create: async () => ({}) };
  const create = f.load('src/lib/mcp/boards/createBoardFromManifest.ts', {
    '@/utils/controllers/projects/boardQuota': { assertBoardQuota: async () => {} },
    '@/utils/controllers/projects/createProjectWithStableName': { createProjectWithStableName: async data => { membership = data.members.create; return board; } },
    '@/utils/controllers/projects/create': { createProjectViewAndCreateDefault: async () => {}, updateUniqueIdentifier: async () => {} },
    '@/lib/telemetry/savedWork': { enqueueBoardCreated: async () => null, processAnalyticsIntentSoon: () => {} },
    '@/lib/mcp/tasks/services': { createTask: async () => { assert.deepEqual(membership, { userId: 6, agentId: f.agent.id, status: 'Accepted' }); return { id: 1, title: 'New', projectId: 900, uniqueIndex: 1 }; } },
  }).createBoardFromManifest;
  const result = await create({ teamId: 'team', googleAccountId: 'account', userId: 6, userEmail: f.user.email, creation: { method: 'agent', channel: 'api', agentId: f.agent.id }, manifest: { title: 'Created', sections: [{ title: 'Todo' }], labels: [], tasks: [{ title: 'New', sectionIndex: 0, labelNames: [] }] } });
  assert.equal(result.board.id, 900);
  assert.deepEqual(membership, { userId: 6, agentId: f.agent.id, status: 'Accepted' });
  const project = { ...board, members: [{ ...membership, agent: f.agent }] };
  assert.ok(matches(project, f.access.projectContentAccessWhere(6, f.agent.id)));
});

test('write probe rechecks revoked grants inside its lock before writing', async () => {
  const f = fixture();
  const probe = f.load('src/lib/taskCardActions/writeProbe.ts', { './writeLocks': {} });
  Object.assign(f.projects[0], { name: probe.probeProjectName(6), status: 'Archive' });
  Object.assign(f.tasks[0], { title: probe.PROBE_TASK_TITLE, status: 'Archive' });
  const result = await f.run({ url: '/api/ops/task-write-probe' }, () => probe.runTaskWriteProbe(6, {
    agentId: f.agent.id, lock: async (_id, run) => { f.projects[0].members = []; return run(f.prisma); },
  }));
  assert.equal(result.status, 'inconclusive');
  assert.deepEqual(f.writes, []);
});

test('native tool execution adapter initializes WATCH for a dynamically selected agent', async () => {
  const f = actor('WATCH', 'outside');
  const execution = f.load('src/lib/ai/tools/execution.ts', {
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': { withAdoptedAgentMutationLease: async (_db, _actor, run) => run() },
    '@/lib/ai/chatStream/errors': { errorMessage: error => error.message },
    '@/app/api/ai/chat/stream/bulkTools': {},
  });
  const tools = execution.trackToolSetExecutions({ scoped: { execute: async () => {
    assert.equal(f.scope.agentScopeEnforced(), false);
    return f.prisma.project.findFirst({ where: { id: 15, ...f.access.projectContentAccessWhere(6, f.agent.id) } });
  } } }, () => {}, undefined, { userId: 6, agentId: f.agent.id });
  assert.equal((await tools.scoped.execute()).id, 15);
  assert.equal(f.state.flagReads, 1);
});

test('chat team context adapter initializes WATCH for an internal session agent', async () => {
  const f = actor('WATCH', 'outside');
  f.projects[0].members = [{ agentId: f.agent.id, agent: f.agent, status: 'Invited', userId: 6 }];
  f.prisma.chatSession = { findFirst: async () => ({ agentId: f.agent.id, projectId: null }) };
  f.prisma.team.findMany = async () => [];
  const resolve = f.load('src/app/api/ai/_lib/chatTeamContext.ts').resolveChatTeamContext;
  const result = await resolve({ userId: 6, sessionId: 'agent-session' });
  assert.equal(result.teamId, 'team');
  assert.equal(f.state.flagReads, 1);
});

test('Pages comment adapter prepares a body agent and preserves production board access in WATCH', async () => {
  const f = actor('WATCH', 'outside');
  const handler = f.load('src/pages/api/comments/create.ts', {
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6, agentId: f.agent.id }) },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => {
      assert.equal(f.scope.agentScopeEnforced(), false);
      return f.prisma.task.findFirst({ where: { id: 150, project: f.access.projectContentAccessWhere(6, f.agent.id) } });
    } },
  }).default;
  const res = response();
  await handler({ url: '/api/comments/create', method: 'POST', headers: {}, body: { text: 'Test', creatorId: 6, taskId: 150, ownerId: 6, agentId: f.agent.id } }, res);
  assert.equal(res.body.id, 150);
  assert.equal(f.state.flagReads, 1);
});

test('Pages delete-reminder adapter preserves WATCH access for a signed agent outside the target board', async () => {
  const f = actor('WATCH', 'outside');
  f.prisma.$transaction = async () => f.tasks[0];
  const handler = f.load('src/pages/api/queues/tasks/taskDeleteReminder.ts', {
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6, agentId: f.agent.id }) },
    '@/lib/auth/session': { SESSION_COOKIE: 'ht_session', verifySession: () => ({ id: 6, agentId: f.agent.id }) },
    '@/lib/constants': { default: { TaskDeletePrefixKey: 'delete-' } },
    '../taskDeleteQueue': { scheduleTaskDeleteJob: async () => {} },
  }).default;
  const res = response();
  await handler({ url: '/api/queues/tasks/taskDeleteReminder', method: 'POST', headers: {}, cookies: {}, body: { taskId: 150, agentId: f.agent.id } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, 150);
  assert.equal(f.state.flagReads, 1);
});

test('proposal adapter prepares its session agent before checking the target board in WATCH', async () => {
  const f = actor('WATCH', 'outside');
  const proposal = { id: 'proposal', status: 'PENDING', targetProjectId: 15, targetSectionId: 15, ticketTitle: 'New' };
  f.prisma.chatTicketProposal = { findFirst: async () => proposal, findUnique: async () => proposal, updateMany: async () => ({ count: 1 }) };
  let checked = false;
  const route = f.load('src/app/api/agent-chat/[sessionId]/proposals/[proposalId]/route.ts', {
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6 }) },
    '@/lib/agents/chatAccess': { sidebarChatProjectId: () => undefined, loadUserAgentChatSession: async () => ({ ok: true, agentId: f.agent.id, session: { id: 'session', agent: f.agent } }) },
    '@/lib/flags': { isFeatureEnabled: async () => true },
    '@/lib/mcp/agents/scopes': { getAgentRole: async () => 'write' },
    '@/lib/agents/chatTicketProposal': { chatTicketProposalSelect: {}, serializeChatTicketProposal: row => row },
    '@/utils/controllers/tasks/createTaskCore': {},
    '@/lib/mcp/tasks/services': { validateProjectAccess: async (_project, userId, agentId) => {
      checked = true;
      assert.equal(f.scope.agentScopeEnforced(), false);
      const project = await f.prisma.project.findFirst({ where: { id: 15, ...f.access.projectContentAccessWhere(userId, agentId) } });
      assert.equal(project.id, 15);
      return { project };
    } },
    '@/lib/realtime/server': { broadcast: async () => {}, userChannel: () => 'user' },
  });
  const result = await route.POST(request('/api/agent-chat/session/proposals/proposal', 'POST', { action: 'confirm' }), { params: Promise.resolve({ sessionId: 'session', proposalId: 'proposal' }) });
  assert.equal(result.status, 400);
  assert.equal(checked, true);
  assert.equal(f.state.flagReads, 1);
});

test('mention adapter prepares the internal bridge body agent even with an owner-only signed cookie', async () => {
  const f = actor('WATCH', 'outside');
  f.projects[0].members.push({ userId: 6, agentId: f.agent.id, agent: f.agent, status: 'Invited' });
  const handler = f.load('src/pages/api/comments/createMention.ts', {
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6 }) },
    '@/utils/controllers/notifications/shouldNotify': { shouldNotify: async () => false },
    '@/utils/controllers/FCM': {},
    '@/utils/controllers/notifications/creation-service/check-reminder_create-notification': {},
  }).default;
  const res = response();
  await handler({ url: '/api/comments/createMention', method: 'POST', headers: {}, body: { taskId: 150, projectId: 15, userId: 99, fromAgentId: f.agent.id } }, res);
  assert.equal(f.state.flagReads, 1);
  assert.ok(f.state.events.some(e => e.properties.projectId === 15));
  assert.notEqual(res.statusCode, 500);
});

test('shared task-write adapter prepares a production body agent on a human-owned request', async () => {
  const f = actor('WATCH', 'outside');
  const { taskWriteRoute } = f.load('src/lib/api/task-writes/route.ts', {
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6 }) },
  });
  const { z } = require('zod');
  const route = taskWriteRoute({ schema: z.any(), validationMessage: 'Invalid', operation: async () => {
    assert.equal(f.scope.agentScopeEnforced(), false);
    const board = await f.prisma.project.findFirst({ where: { id: 15, ...f.access.taskWriteAccessWhere(6, f.agent.id) } });
    return Response.json({ id: board.id });
  } });
  const result = await route(request('/api/section/resetRanks', 'POST', { agentId: f.agent.id }));
  assert.equal((await result.json()).id, 15);
});

test('bound MCP adapter prepares WATCH even when the operation reuses an authenticated principal directly', async () => {
  const f = actor('WATCH', 'outside');
  const wrapper = f.load('src/lib/mcp/routeWrapper.ts', {
    '@/lib/aiFeedback/automatic': { queueRestFailure: () => {} },
    './operationContext': { getMcpOperationContext: () => ({ auth: f.state.ctx }) },
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': {},
    './operationCrashReport': { reportUnexplainedMcpServerError: () => {} },
  });
  const result = await wrapper.wrapMcpRoute(async () => {
    assert.equal(f.scope.agentScopeEnforced(), false);
    return f.prisma.project.findFirst({ where: { id: 15, ...f.access.projectContentAccessWhere(6, f.agent.id) } });
  })(request('/api/mcp/projects'));
  assert.equal(result.id, 15);
});
